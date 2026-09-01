"""VIP-only endpoints."""

import logging

from fastapi import APIRouter, Depends, HTTPException

from app.config import Settings, get_settings
from app.deps import require_vip
from app.llm import LLMUnavailable, extract
from app.models import User
from app.schemas import SmartExtractIn, SmartExtractOut, SmartLine

log = logging.getLogger("pindou.smart")

router = APIRouter(tags=["smart"])


@router.post("/smart/extract", response_model=SmartExtractOut)
def smart_extract(
    body: SmartExtractIn,
    # Reached only by an account the DATABASE says is VIP. Order matters: this
    # runs before the handler, so non-VIP callers never reach the model call —
    # which is what stops a normal account from spending tokens.
    user: User = Depends(require_vip),
    settings: Settings = Depends(get_settings),
) -> SmartExtractOut:
    try:
        result = extract(body.text, settings)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except LLMUnavailable as exc:
        log.warning("智能管控不可用: %s", exc)
        raise HTTPException(status_code=503, detail="识别服务暂时不可用，请稍后再试") from exc

    log.info("智能管控: user=%s model=%s 抽出 %d 条", user.username, result.model, len(result.lines))
    return SmartExtractOut(
        lines=[SmartLine(code=ln.code, delta=ln.delta, source=ln.source) for ln in result.lines],
        unresolved=result.unresolved,
        model=result.model,
    )
