"""拼豆图纸识别（VIP）。

识别可能要很久，所以接口只负责**收图 + 建任务 + 起线程**，立刻返回。前台该干嘛
干嘛，甚至可以关掉弹窗；识别完了结果落库，前台轮询发现有未读的完成任务，就在
「按图扣减」按钮上点红点。
"""

import logging
import os
import threading
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import get_session, get_sessionmaker
from app.deps import require_vip
from app.fastgpt import FastGPTError, read_upload, recognise, save_upload
from app.imaging import sniff_image
from app.models import PatternJob, User
from app.schemas import PatternImageOut, PatternJobOut, PatternJobSummary

log = logging.getLogger("pindou.patterns")

router = APIRouter(tags=["patterns"])

_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"}


def _row(job: PatternJob) -> PatternJobOut:
    return PatternJobOut(
        id=job.id,
        status=job.status,
        bead_list=job.bead_list,
        md_table=job.md_table,
        note=job.note,
        model=job.model,
        error=job.error,
        extracted=job.extracted,
        seen=job.seen,
        image_count=len(job.images or []),
        items=[PatternImageOut(**it) for it in (job.items or [])],
        created_at=job.created_at,
        finished_at=job.finished_at,
    )


def _run_job(job_id: int, images: list[tuple[str, bytes]], settings: Settings) -> None:
    """后台线程。用自己的 session——请求那个早就关了。"""
    maker = get_sessionmaker()

    def update(**fields) -> None:
        with maker() as session:
            job = session.get(PatternJob, job_id)
            if job is None:
                return
            for k, v in fields.items():
                setattr(job, k, v)
            session.commit()

    # 建任务时就记下了被门口挡掉的那几张（格式不对、太大），识别结果要并进来，
    # 而不是覆盖掉——用户得看到完整的一份"每张图怎么样了"。
    with maker() as session:
        job = session.get(PatternJob, job_id)
        rejected = list(job.items or []) if job else []

    def merged(outcomes) -> list[dict]:
        """把"门口挡掉的"和"识别过的"合成一份完整名单。

        两套下标必须分清：`index` 是用户上传时的顺序，只用来排序显示；
        `image_index` 是这张图在 job.images 里的位置，也就是取原图那个接口的参数。
        被挡掉的图没有存原图，所以它的 image_index 是 None，前端据此不给点。
        """
        taken = {r["index"] for r in rejected}
        upload_pos = [i for i in range(len(rejected) + len(images)) if i not in taken]
        out = [{**r, "image_index": None} for r in rejected]
        for o in outcomes:
            out.append({
                "index": upload_pos[o.index] if o.index < len(upload_pos) else o.index,
                "image_index": o.index,
                "filename": o.filename, "status": o.status,
                "error": o.error, "notes": o.notes,
            })
        return sorted(out, key=lambda r: r["index"])

    update(status="running")
    try:
        result = recognise(images, settings)
    except Exception as exc:  # noqa: BLE001 - 线程里任何异常都必须落库，不能吞掉
        log.warning("图纸识别失败 job=%s: %s", job_id, exc)
        update(
            status="failed",
            # 网关的原始报错可能带 key，只留类型和简短说明。
            error=str(exc)[:300] if isinstance(exc, (FastGPTError, ValueError)) else "识别失败",
            finished_at=datetime.now(UTC),
        )
        return

    if not result.is_extraction:
        # 图里没有色号统计区域。这不是失败——模型在 nl_response 里说明了原因——
        # 但也没有任何可扣减的东西，所以要跟正常结果区分开。
        log.info("图纸识别无可提取内容 job=%s", job_id)
    items = merged(result.outcomes)
    failed = [it for it in items if it["status"] != "ok"]
    update(
        status="done",
        extracted=result.is_extraction,
        bead_list=result.bead_list,
        md_table=result.md_table,
        note=result.nl_response,
        model=result.model,
        items=items,
        # 部分失败不是整体失败：能认的都认了，把认不了的那几张说清楚。
        error=(f"{len(failed)}/{len(items)} 张未能识别" if failed else ""),
        finished_at=datetime.now(UTC),
    )
    log.info(
        "图纸识别完成 job=%s model=%s ok=%d/%d",
        job_id, result.model, len(items) - len(failed), len(items),
    )


@router.post("/patterns", response_model=PatternJobOut, status_code=202)
async def create_pattern_job(
    files: list[UploadFile] = File(...),
    user: User = Depends(require_vip),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> PatternJobOut:
    if not settings.fastgpt_configured:
        raise HTTPException(status_code=503, detail="识别服务暂时不可用，请稍后再试")
    if not files:
        raise HTTPException(status_code=422, detail="请至少上传一张图片")
    if len(files) > settings.upload_max_files:
        raise HTTPException(
            status_code=422, detail=f"最多上传 {settings.upload_max_files} 张"
        )

    # 逐图校验。一张不合格就把整批打回，等于让用户为一张废图重传另外十九张；
    # 不合格的单独记下来，能用的照常识别。
    payloads: list[tuple[str, bytes]] = []
    rejected: list[PatternImageOut] = []
    for i, f in enumerate(files):
        name = f.filename or "image.png"
        data = await f.read()
        if len(data) > settings.upload_max_bytes:
            rejected.append(PatternImageOut(
                index=i, filename=name, status="failed",
                error=f"不能超过 {settings.upload_max_bytes // 1024 // 1024} MB",
            ))
            continue
        # 浏览器报的 content_type 是从后缀推出来的，后缀错它就跟着错，所以格式
        # 校验以内容为准；后面的上传和落盘也都按嗅探结果走，不再看文件名。
        sniffed = sniff_image(data)
        if sniffed is None or sniffed[1] not in _IMAGE_TYPES:
            got = sniffed[1] if sniffed else (f.content_type or "未知")
            rejected.append(PatternImageOut(
                index=i, filename=name, status="failed",
                error=f"不支持的图片格式: {got}",
            ))
            continue
        payloads.append((name, data))

    if not payloads:
        detail = rejected[0].error if len(rejected) == 1 else "没有一张图片可以识别"
        raise HTTPException(status_code=422, detail=detail)

    # 原图先落到本地卷：FastGPT 的 previewUrl 不受我们控制，也不保证留多久，
    # 用户之后回看这次识别用的是哪几张图，靠的是这份副本。
    stored = [
        save_upload(settings.upload_dir, user.id, name, data) for name, data in payloads
    ]

    job = PatternJob(
        user_id=user.id,
        status="pending",
        images=stored,
        # 被挡在门外的那几张先记上，识别完了再和后面的结果合并
        items=[r.model_dump() for r in rejected],
    )
    session.add(job)
    session.commit()

    threading.Thread(
        target=_run_job, args=(job.id, payloads, settings), daemon=True, name=f"pattern-{job.id}"
    ).start()
    return _row(job)


@router.get("/patterns", response_model=PatternJobSummary)
def list_pattern_jobs(
    user: User = Depends(require_vip), session: Session = Depends(get_session)
) -> PatternJobSummary:
    jobs = session.scalars(
        select(PatternJob)
        .where(PatternJob.user_id == user.id)
        .order_by(PatternJob.id.desc())
        .limit(20)
    ).all()
    return PatternJobSummary(
        jobs=[_row(j) for j in jobs],
        # 前台就靠这个数字决定红点显不显示。
        # 只有真抽到东西才值得亮红点——"这张图里没有色号表"不需要打断用户。
        unseen=sum(1 for j in jobs if j.status == "done" and j.extracted and not j.seen),
        running=sum(1 for j in jobs if j.status in ("pending", "running")),
    )


def _own_job(job_id: int, user: User, session: Session) -> PatternJob:
    job = session.get(PatternJob, job_id)
    # 不区分"不存在"和"不是你的"，免得别人靠状态码枚举 id。
    if job is None or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="没有这个识别任务")
    return job


@router.get("/patterns/{job_id}", response_model=PatternJobOut)
def get_pattern_job(
    job_id: int, user: User = Depends(require_vip), session: Session = Depends(get_session)
) -> PatternJobOut:
    return _row(_own_job(job_id, user, session))


@router.post("/patterns/{job_id}/seen", response_model=PatternJobOut)
def mark_seen(
    job_id: int, user: User = Depends(require_vip), session: Session = Depends(get_session)
) -> PatternJobOut:
    job = _own_job(job_id, user, session)
    job.seen = True
    session.commit()
    return _row(job)


@router.delete("/patterns/{job_id}", status_code=204)
def delete_pattern_job(
    job_id: int,
    user: User = Depends(require_vip),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> Response:
    job = _own_job(job_id, user, session)
    # 原图跟着记录一起删，不留孤儿文件占卷。
    for rel in job.images or []:
        try:
            os.remove(os.path.join(settings.upload_dir, rel))
        except OSError:
            pass  # 文件早就没了不是错误，记录照删
    session.delete(job)
    session.commit()
    return Response(status_code=204)


@router.get("/patterns/{job_id}/images/{index}")
def get_pattern_image(
    job_id: int,
    index: int,
    user: User = Depends(require_vip),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> Response:
    """回看这次识别用的原图。只有任务的主人拿得到。"""
    job = _own_job(job_id, user, session)
    images = job.images or []
    if index < 0 or index >= len(images):
        raise HTTPException(status_code=404, detail="没有这张图")
    try:
        data = read_upload(settings.upload_dir, images[index])
    except (OSError, ValueError):
        raise HTTPException(status_code=404, detail="图片已不存在") from None
    return Response(content=data, media_type="image/png")
