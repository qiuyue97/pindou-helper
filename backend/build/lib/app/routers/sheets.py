"""图纸识别（VIP）。

两段式，因为用户必须先确认网格才值得付识别的代价：

    POST /sheets                   上传 + 同步检测，秒级以内，返回初始框和吸附靶点
    POST /sheets/{id}/recognise    用户确认几何后起后台线程

路由只认 `app.sheet.pipeline`，不直接碰 cv2 / sklearn。
"""

import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.colour import load_palette
from app.config import Settings, get_settings
from app.db import get_session, get_sessionmaker
from app.deps import require_vip
from app.fastgpt import read_upload, save_upload
from app.fastgpt import recognise as fastgpt_recognise
from app.imaging import sniff_image
from app.models import Sheet, User
from app.schemas import (
    CellPatchIn,
    ClassPatchIn,
    PriorIn,
    RecogniseIn,
    SheetGuessOut,
    SheetOut,
    SheetSummary,
)
from app.sheet import pipeline
from app.sheet.decide import ClassRecord
from app.sheet.matrix import apply_cell_patch, apply_class_patch, tally
from app.sheet.reconcile import CountRow, reconcile
from app.text_parse import code_key, parse_lines

log = logging.getLogger("pindou.sheets")

router = APIRouter(tags=["sheets"])

_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/bmp"}

#: 同时在跑的识别数，第一次用到时按配置建。
_gate: threading.Semaphore | None = None
_gate_lock = threading.Lock()


def _own(sheet_id: int, user: User, session: Session) -> Sheet:
    """取自己的那张图。不区分「不存在」和「不是你的」——否则能靠状态码枚举 id。"""
    s = session.get(Sheet, sheet_id)
    if s is None or s.user_id != user.id:
        raise HTTPException(status_code=404, detail="没有这张图纸")
    return s


def _semaphore(settings: Settings) -> threading.Semaphore:
    """同时在跑的识别数。CV 是 CPU 密集的，放开会拖垮 API 响应。"""
    global _gate
    with _gate_lock:
        if _gate is None:
            _gate = threading.Semaphore(max(1, settings.sheet_concurrency))
    return _gate


def _row(s: Sheet) -> SheetOut:
    return SheetOut(
        id=s.id, status=s.status, width=s.width, height=s.height,
        rect=s.rect or [], rows=s.rows, cols=s.cols, has_blanks=s.has_blanks,
        palette=s.palette, snap_x=s.snap_x or [], snap_y=s.snap_y or [],
        labels=s.labels or [], classes=s.classes or [], counts=s.counts or [],
        overrides=s.overrides or {}, prior=s.prior or {},
        engine=s.engine, structured=s.structured, error=s.error, seen=s.seen,
        tally=tally(s.labels or [], s.classes or [], s.overrides or {},
                    s.rows, s.cols),
        created_at=s.created_at, finished_at=s.finished_at,
    )


@router.post("/sheets", response_model=SheetGuessOut, status_code=201)
async def create_sheet(
    file: UploadFile = File(...),
    user: User = Depends(require_vip),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> SheetGuessOut:
    """收一张图，同步跑一次点阵检测，返回初始猜测。

    一次只收一张：角点拖拽的界面天然是单图。
    """
    data = await file.read()
    if len(data) > settings.upload_max_bytes:
        raise HTTPException(
            status_code=422,
            detail=f"不能超过 {settings.upload_max_bytes // 1024 // 1024} MB",
        )
    # 按内容判类型。浏览器报的 content_type 是从后缀推的，后缀错它就跟着错。
    sniffed = sniff_image(data)
    if sniffed is None or sniffed[1] not in _IMAGE_TYPES:
        got = sniffed[1] if sniffed else (file.content_type or "未知")
        raise HTTPException(status_code=422, detail=f"不支持的图片格式: {got}")

    try:
        im = pipeline.decode_image(data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    h, w = im.shape[:2]

    guess = pipeline.detect(data)
    stored = save_upload(settings.upload_dir, user.id,
                         file.filename or "sheet.png", data)

    sheet = Sheet(
        user_id=user.id, status="ready", image=stored, width=w, height=h,
        # 检测不到点阵不是失败：给整图的框、空的吸附靶点，用户自己拖框填行列数。
        # 下游只吃 (rect, rows, cols, has_blanks)，手动和自动之后完全一样。
        rect=guess.rect if guess else [0.0, 0.0, float(w), float(h)],
        rows=guess.rows if guess else 0,
        cols=guess.cols if guess else 0,
        snap_x=guess.snap_x if guess else [],
        snap_y=guess.snap_y if guess else [],
    )
    session.add(sheet)
    session.commit()

    return SheetGuessOut(
        id=sheet.id, width=w, height=h, rect=sheet.rect,
        rows=sheet.rows, cols=sheet.cols,
        snap_x=sheet.snap_x, snap_y=sheet.snap_y,
        source="lattice" if guess else "manual",
    )


@router.get("/sheets/{sheet_id}/image")
def get_sheet_image(
    sheet_id: int,
    user: User = Depends(require_vip),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> Response:
    """原图。网格确认和前端裁格子都取它，所以要原尺寸、不做任何处理。"""
    sheet = _own(sheet_id, user, session)
    try:
        data = read_upload(settings.upload_dir, sheet.image)
    except (OSError, ValueError):
        raise HTTPException(status_code=404, detail="图片已不存在") from None
    return Response(content=data, media_type="image/png")


def _fetch_prior(name: str, data: bytes, settings: Settings):
    """跑一遍现有的「拼豆图纸AI抽取」，把它的色号+数量当先验。

    先验把答案空间从 221 个色号收窄到这张图真正用到的四十来个，剩下的错误大多住
    在那里。但它是关于这张图的一个说法，不是对它的权威——它不改任何一格的答案，
    只在两份证据不一致时让那个色号整体标紫。

    返回 `(prior, model)`。抽不出来返回 `({}, "")`。
    """
    if not settings.fastgpt_configured:
        return {}, ""
    result = fastgpt_recognise([(name, data)], settings)
    if not result.is_extraction:
        return {}, result.model
    prior = {p.code: p.qty for p in parse_lines(result.bead_list)
             if p.status == "ok" and p.code and p.qty}
    return prior, result.model


def _run(sheet_id: int, data: bytes, name: str, geom: pipeline.Geometry,
         settings: Settings) -> None:
    """后台线程。用自己的 session——请求那个早就关了。"""
    maker = get_sessionmaker()

    def update(**fields) -> None:
        with maker() as session:
            s = session.get(Sheet, sheet_id)
            if s is None:
                return
            for k, v in fields.items():
                setattr(s, k, v)
            session.commit()

    update(status="running")
    with _semaphore(settings):
        try:
            # CV 和 AI 抽取并行：CV 不需要等先验才能开始，先验只在定案那一步筛答案。
            with ThreadPoolExecutor(max_workers=2) as pool:
                fut_prior = pool.submit(_fetch_prior, name, data, settings)
                fut_cv = pool.submit(
                    pipeline.analyse, data, geom,
                    token=settings.mineru_token,
                    timeout=settings.mineru_timeout,
                )
                analysis = fut_cv.result()
                try:
                    prior, _model = fut_prior.result()
                except Exception as exc:  # noqa: BLE001
                    # 图例读不到不是「全都对不上」，只是没有第二份证据。
                    log.info("图纸 %s 的 AI 先验取不到：%s", sheet_id, exc)
                    prior = {}

            # 先验比 CV 晚到，所以定案单独一步。这里**绝不能**改成整条重跑
            # pipeline.recognise —— 那会再发一次 MinerU 请求，花第二份配额和钱，
            # 还要重新采样、重新聚类。finalise 是纯计算。
            res = pipeline.finalise(analysis, prior or None)
        except Exception as exc:  # noqa: BLE001 — 线程里任何异常都必须落库
            log.warning("图纸识别失败 sheet=%s: %s", sheet_id, exc)
            update(status="failed",
                   error=str(exc)[:300] if isinstance(exc, ValueError) else "识别失败",
                   finished_at=datetime.now(UTC))
            return

        update(status="done", labels=res.labels, classes=res.classes,
               counts=res.counts, prior=prior, engine=res.engine,
               structured=res.structured, error="",
               finished_at=datetime.now(UTC))
        log.info("图纸识别完成 sheet=%s engine=%s 类数=%d",
                 sheet_id, res.engine, len(res.classes))


@router.post("/sheets/{sheet_id}/recognise", response_model=SheetOut,
             status_code=202)
def start_recognise(
    sheet_id: int,
    body: RecogniseIn,
    user: User = Depends(require_vip),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> SheetOut:
    sheet = _own(sheet_id, user, session)
    if sheet.status in ("pending", "running"):
        raise HTTPException(status_code=409, detail="这张图正在识别中")
    if body.rows * body.cols > settings.sheet_max_cells:
        raise HTTPException(
            status_code=422,
            detail=f"{body.rows}x{body.cols} 共 {body.rows * body.cols} 格，"
                   f"超过上限 {settings.sheet_max_cells}",
        )
    try:
        data = read_upload(settings.upload_dir, sheet.image)
    except (OSError, ValueError):
        raise HTTPException(status_code=404, detail="图片已不存在") from None

    sheet.rect = list(body.rect)
    sheet.rows, sheet.cols = body.rows, body.cols
    sheet.has_blanks, sheet.palette = body.has_blanks, body.palette
    sheet.status = "pending"
    sheet.error = ""
    # 重新识别会作废之前的人工修正：类的编号变了，overrides 的坐标虽然还在，
    # 但它指向的类已经不是原来那个。留着比清掉更让人困惑。
    sheet.overrides = {}
    session.commit()

    geom = pipeline.Geometry(rect=list(body.rect), rows=body.rows,
                             cols=body.cols, has_blanks=body.has_blanks,
                             palette=body.palette)
    threading.Thread(
        target=_run,
        args=(sheet.id, data, os.path.basename(sheet.image), geom, settings),
        daemon=True, name=f"sheet-{sheet.id}",
    ).start()
    session.refresh(sheet)
    return _row(sheet)


@router.get("/sheets/{sheet_id}", response_model=SheetOut)
def get_sheet(sheet_id: int, user: User = Depends(require_vip),
              session: Session = Depends(get_session)) -> SheetOut:
    return _row(_own(sheet_id, user, session))


@router.get("/sheets", response_model=SheetSummary)
def list_sheets(user: User = Depends(require_vip),
                session: Session = Depends(get_session)) -> SheetSummary:
    rows = session.scalars(
        select(Sheet).where(Sheet.user_id == user.id)
        .order_by(Sheet.id.desc()).limit(20)
    ).all()
    return SheetSummary(
        sheets=[_row(s) for s in rows],
        running=sum(1 for s in rows if s.status in ("pending", "running")),
    )


@router.delete("/sheets/{sheet_id}", status_code=204)
def delete_sheet(sheet_id: int, user: User = Depends(require_vip),
                 session: Session = Depends(get_session),
                 settings: Settings = Depends(get_settings)) -> Response:
    sheet = _own(sheet_id, user, session)
    try:
        os.remove(os.path.join(settings.upload_dir, sheet.image))
    except OSError:
        pass  # 文件早就没了不是错误，记录照删
    session.delete(sheet)
    session.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------- 三级编辑 --
#
#   上层：改整类的色号   -> classes[k].code，一次生效几十上百格
#   上层：改基准数量     -> prior[code]，重新对账、重算紫色告警
#   格子：改单格/多选     -> overrides，稀疏，只存改过的
#
# override 覆盖 class：用户手工挑出来的那几格是他的决定，后来的整类修改不该冲掉它。


def _check_codes(codes, palette: str) -> None:
    """用户填进来的色号必须在色卡里。

    色卡是权威。放一个不存在的色号进去，「按图扣减」那边会在最后一步才报错，
    到那时用户已经改了几十格。
    """
    valid = set(load_palette(palette).codes)
    bad = sorted({c for c in codes if c and c not in valid})
    if bad:
        raise HTTPException(
            status_code=422,
            detail=f"色卡 {palette} 里没有这些色号: {', '.join(bad)}",
        )


def _recount(sheet: Sheet) -> None:
    """按当前的 classes / overrides / prior 重算对账表。

    每次编辑都要重算，因为三种编辑都会动到对账的两边：改整类和改格子改变「本图
    数量」，改基准改变「AI 数量」。不重算的话紫色告警会停在上一次的状态上，
    那比不显示更糟——用户会以为已经对上了。

    `reconcile` 只认类的格子数，看不到逐格覆盖。所以这里先让它算出「先验 vs 类」
    的骨架，再用 `tally`（它是看得到覆盖的）把本图数量改写成真实值，最后按新数量
    重判紫色。
    """
    recs = [ClassRecord(**c) for c in (sheet.classes or [])]
    rows = reconcile(recs, sheet.prior or None)

    counted = tally(sheet.labels or [], sheet.classes or [],
                    sheet.overrides or {}, sheet.rows, sheet.cols)
    by_code = {r.code: r for r in rows}
    for code, n in counted.items():
        if code in by_code:
            by_code[code].sheet = n
        else:
            # 只在覆盖里出现过的色号：它没有任何类，但确实占着格子
            rows.append(CountRow(code=code, sheet=n,
                                 prior=(sheet.prior or {}).get(code)))

    # 数量被改写过了，紫色要按新数量重判——只在真有第二份证据时才判
    if sheet.prior:
        for row in rows:
            if row.prior != row.sheet:
                row.level = "count"
            elif row.level == "count":
                row.level = "ok"       # 用户把基准改对了，紫色该消失

    rows.sort(key=lambda r: code_key(r.code))
    sheet.counts = [asdict(r) for r in rows]

    # 类的 level 同步回去——前端的卡片排序读它
    by_k = {r.klass: r for r in recs}
    sheet.classes = [{**c, "level": by_k[c["klass"]].level}
                     if c["klass"] in by_k else c
                     for c in (sheet.classes or [])]


def _edited(sheet: Sheet, session: Session) -> SheetOut:
    _recount(sheet)
    session.commit()
    return _row(sheet)


@router.patch("/sheets/{sheet_id}/classes", response_model=SheetOut)
def patch_classes(sheet_id: int, body: ClassPatchIn,
                  user: User = Depends(require_vip),
                  session: Session = Depends(get_session)) -> SheetOut:
    """改整类的色号。一次生效这一类的全部格子。"""
    sheet = _own(sheet_id, user, session)
    _check_codes([p.code for p in body.patches], sheet.palette)
    try:
        sheet.classes = apply_class_patch(
            sheet.classes or [], [p.model_dump() for p in body.patches])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    return _edited(sheet, session)


@router.patch("/sheets/{sheet_id}/cells", response_model=SheetOut)
def patch_cells(sheet_id: int, body: CellPatchIn,
                user: User = Depends(require_vip),
                session: Session = Depends(get_session)) -> SheetOut:
    """改单格或多选的几格。`code` 为空表示撤销这一格的人工修正。"""
    sheet = _own(sheet_id, user, session)
    _check_codes([p.code for p in body.patches], sheet.palette)
    try:
        sheet.overrides = apply_cell_patch(
            sheet.overrides or {}, [p.model_dump() for p in body.patches],
            sheet.rows, sheet.cols)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    return _edited(sheet, session)


@router.patch("/sheets/{sheet_id}/prior", response_model=SheetOut)
def patch_prior(sheet_id: int, body: PriorIn,
                user: User = Depends(require_vip),
                session: Session = Depends(get_session)) -> SheetOut:
    """改基准表的数量。改的是 AI 的说法，不是本图的事实。

    本图数量是数出来的，改不了——要让它变，只能去改格子。
    """
    sheet = _own(sheet_id, user, session)
    _check_codes(list(body.prior), sheet.palette)
    sheet.prior = {c: n for c, n in body.prior.items() if n > 0}
    return _edited(sheet, session)


@router.post("/sheets/{sheet_id}/seen", response_model=SheetOut)
def mark_seen(sheet_id: int, user: User = Depends(require_vip),
              session: Session = Depends(get_session)) -> SheetOut:
    sheet = _own(sheet_id, user, session)
    sheet.seen = True
    session.commit()
    return _row(sheet)
