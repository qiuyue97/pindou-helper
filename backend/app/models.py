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
