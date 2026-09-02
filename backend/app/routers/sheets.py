"""图纸识别（VIP）。

两段式，因为用户必须先确认网格才值得付识别的代价：

    POST /sheets                   上传 + 同步检测，秒级以内，返回初始框和吸附靶点
    POST /sheets/{id}/recognise    用户确认几何后起后台线程

路由只认 `app.sheet.pipeline`，不直接碰 cv2 / sklearn。
"""

import logging
import os

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import get_session
from app.deps import require_vip
from app.fastgpt import read_upload, save_upload
from app.imaging import sniff_image
from app.models import Sheet, User
from app.schemas import SheetGuessOut
from app.sheet import pipeline

log = logging.getLogger("pindou.sheets")

router = APIRouter(tags=["sheets"])

_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/bmp"}


def _own(sheet_id: int, user: User, session: Session) -> Sheet:
    """取自己的那张图。不区分「不存在」和「不是你的」——否则能靠状态码枚举 id。"""
    s = session.get(Sheet, sheet_id)
    if s is None or s.user_id != user.id:
        raise HTTPException(status_code=404, detail="没有这张图纸")
    return s


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
