from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _now() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    threshold: Mapped[int] = mapped_column(Integer, default=500)
    # server_default matters: rows that already exist when this column is added
    # need a value, and the migration in db.py relies on the same default.
    is_vip: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("0"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class InventoryItem(Base):
    __tablename__ = "inventory_items"
    __table_args__ = (UniqueConstraint("user_id", "code"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    code: Mapped[str] = mapped_column(String(16))
    quantity: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Operation(Base):
    __tablename__ = "operations"
    __table_args__ = (UniqueConstraint("user_id", "seq"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(20))
    payload: Mapped[dict] = mapped_column(JSON)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    voided: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UserColor(Base):
    __tablename__ = "user_colors"
    __table_args__ = (UniqueConstraint("user_id", "code"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    code: Mapped[str] = mapped_column(String(16))
    hex: Mapped[str] = mapped_column(String(6))
    source: Mapped[str] = mapped_column(String(10))  # "override" | "custom"
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class PatternJob(Base):
    """一次图纸识别任务。

    识别是后台线程跑的，用户关掉弹窗、切页面都不影响；结果落在这里，前台靠轮询
    发现它完成，再在「按图扣减」按钮上点红点。
    """

    __tablename__ = "pattern_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    #: pending | running | done | failed
    status: Mapped[str] = mapped_column(String(10), default="pending", index=True)
    #: 本地留存的原图相对路径，供用户回看
    images: Mapped[list] = mapped_column(JSON, default=list)
    #: 每张图的下场：[{index, filename, status, error, notes}]。识别是分批并行跑的，
    #: 一张图出问题不该拖垮整批，所以成败要落到具体哪张图上。
    items: Mapped[list] = mapped_column(JSON, default=list)
    #: 识别出的 "色号, 数量" 清单，可直接粘进按图扣减
    bead_list: Mapped[str] = mapped_column(Text, default="")
    md_table: Mapped[str] = mapped_column(Text, default="")
    note: Mapped[str] = mapped_column(Text, default="")
    model: Mapped[str] = mapped_column(String(64), default="")
    error: Mapped[str] = mapped_column(Text, default="")
    #: 插件是否真的抽到了色号统计区域。false 表示图里没有可提取的内容，
    #: 此时 bead_list 为空，note 里是模型解释原因的那句话。
    #: server_default 给 1：这一列出现之前的记录都是真抽出来的。
    extracted: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("1"))
    #: 用户是否已经看过结果——红点就是它取反
    seen: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("0"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)


class Sheet(Base):
    """一次图纸识别。

    和 PatternJob 分开是刻意的：那个是「多图批量 + markdown 表 + 逐图成败」，
    这个是「单图 + 网格几何 + 逐格编辑」，字段几乎不重叠。塞进一张表会让两边的
    列都变成「看情况才有意义」。
    """

    __tablename__ = "sheets"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    #: pending | ready | running | done | failed
    #: ready = 检测完了等用户确认几何；done 包含「什么都没读出来」这种正常产出
    status: Mapped[str] = mapped_column(String(10), default="pending", index=True)

    #: 用户给这张图纸起的名字。空 = 没起过，列表里显示 #id。
    #: 起名是给人看的，不参与任何计算，所以随便改、随便空。
    name: Mapped[str] = mapped_column(String(80), default="")
    #: 列表里的排序位。小的在前；同位按 id 倒序（新的在前）。
    #:
    #: 默认 0 意味着**没排过序的一律并列第一**，于是自然退化成「按 id 倒序」
    #: ——正好是加这个字段之前的行为。排过一次之后位置就是 0..n-1，新传的图纸
    #: 仍然是 0，和当时的第一名并列，靠 id 更大排在它前面，照样落在最上面。
    position: Mapped[int] = mapped_column(Integer, default=0, index=True)

    #: 原图相对路径，落在持久卷上。前端裁格子和画网格都取它。
    image: Mapped[str] = mapped_column(String(255), default="")
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)

    #: 用户确认后的几何。下游 pipeline 只吃这四个数，所以自动检测和手动拖框
    #: 之后走的是完全相同的代码。
    rect: Mapped[list] = mapped_column(JSON, default=list)   # [x0, y0, x1, y1]
    rows: Mapped[int] = mapped_column(Integer, default=0)
    cols: Mapped[int] = mapped_column(Integer, default=0)
    #: 白豆和空格在像素上分不开，没有阈值能可靠区分，所以这个只能由用户回答
    has_blanks: Mapped[bool] = mapped_column(Boolean, default=False)
    palette: Mapped[str] = mapped_column(String(4), default="221")

    #: 检测出的吸附靶点，前端拖角时用。检测失败就是空的，用户自己拖。
    snap_x: Mapped[list] = mapped_column(JSON, default=list)
    snap_y: Mapped[list] = mapped_column(JSON, default=list)

    #: rows*cols 个 int，每格属于哪个颜色类；-1 = 空格
    labels: Mapped[list] = mapped_column(JSON, default=list)
    #: ClassRecord.as_dict() 的列表
    classes: Mapped[list] = mapped_column(JSON, default=list)
    #: 对账表的行（CountRow）
    counts: Mapped[list] = mapped_column(JSON, default=list)
    #: {"12,34": "H15"} 稀疏的逐格人工修正
    overrides: Mapped[dict] = mapped_column(JSON, default=dict)
    #: {"H15": 37} AI 抽取的图例，用户可改。它是关于这张图的一个说法，不是权威。
    prior: Mapped[dict] = mapped_column(JSON, default=dict)

    #: 识别到哪一步了，给用户看的一句话（「正在读色号 2/5 页」）。
    #: 只在 running 期间有意义，纯展示，不参与任何计算。
    step: Mapped[str] = mapped_column(String(64), default="")
    #: 0-100。同样只是展示——真实耗时全压在 OCR 那一段，所以这是**分段权重**，
    #: 不是线性时间。宁可让它在 OCR 那一档慢慢爬，也别让它冲到 99 再卡住。
    progress: Mapped[int] = mapped_column(Integer, default=0)

    #: "mineru/vlm" | "colour-only"
    engine: Mapped[str] = mapped_column(String(32), default="")
    #: 这张图的填充色到底是不是分立的几十个类。false 时整张走颜色兜底。
    structured: Mapped[bool] = mapped_column(Boolean, default=True)
    error: Mapped[str] = mapped_column(Text, default="")
    seen: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )
