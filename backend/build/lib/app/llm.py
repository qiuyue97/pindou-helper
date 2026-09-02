"""把自然语言抽取成豆仓变动，走 OpenAI 兼容网关。

设计要点：
- 用**原生 json_schema 结构化输出**，不靠"请返回 JSON"式的祈使句，也不解析
  自由文本。实测 5 个模型全部支持。
- 按配置顺序**逐个模型降级**：任何一步失败（HTTP 错误、超时、返回的 JSON 不
  合形状）都换下一个，而不是直接报错。
- 结果**只是候选**，用户确认后才会真正改库存；提交仍走 /api/inventory/batch
  的原有校验，所以模型说什么都不可能绕过色号校验。
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

import httpx

from app.config import Settings

log = logging.getLogger("pindou.llm")

SYSTEM_PROMPT = """你是拼豆库存助手。用户会用自然语言描述豆仓的增减，你要把它抽取成结构化数据。

规则：
1. 色号形如「字母+数字」，例如 A1、B12、ZG3、M7。统一转成大写，去掉空格。
2. delta 是有符号整数：补货、加、进货、买了、补 → 正数；用掉、用了、减、扣、消耗、少了 → 负数。
3. 只抽取用户明确写出的色号和数量，绝对不要臆造、不要推测、不要补全。
4. source 填触发这一条的原文片段，保持原样。
5. 看不懂或不含色号数量的片段，原样放进 unresolved。
6. 同一个色号出现多次就输出多条，不要自行合并。

示例
输入：A1 补 200，B3 用掉了 50
输出：{"lines":[{"code":"A1","delta":200,"source":"A1 补 200"},{"code":"B3","delta":-50,"source":"B3 用掉了 50"}],"unresolved":[]}"""

# 去掉这个示例，gemini/gemma-4-31b-it 会稳定返回空的 lines——schema 合法但什么
# 都没抽出来。其余模型没有它也正常，但留着对所有模型都没坏处。

RESPONSE_SCHEMA = {
    "name": "pindou_inventory_changes",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "lines": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "code": {"type": "string"},
                        "delta": {"type": "integer"},
                        "source": {"type": "string"},
                    },
                    "required": ["code", "delta", "source"],
                    "additionalProperties": False,
                },
            },
            "unresolved": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["lines", "unresolved"],
        "additionalProperties": False,
    },
}

# 单次输入的上限。超过这个长度基本不是"说一句话增减豆仓"，而是误粘贴，
# 没必要为它付 token。
MAX_INPUT_CHARS = 2000


class LLMUnavailable(RuntimeError):
    """所有候选模型都试过了，没有一个给出可用结果。"""


@dataclass(frozen=True)
class ExtractedLine:
    code: str
    delta: int
    source: str


@dataclass(frozen=True)
class Extraction:
    lines: list[ExtractedLine]
    unresolved: list[str]
    model: str


def _build_body(model: str, text: str, with_temperature: bool) -> dict:
    body: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
        "response_format": {"type": "json_schema", "json_schema": RESPONSE_SCHEMA},
    }
    if with_temperature:
        body["temperature"] = 0
    return body


def _parse(content: str, model: str) -> Extraction:
    """把模型返回的 JSON 收成 Extraction，形状不对就抛异常换下一个模型。

    形状问题一律抛 TypeError；调用方的循环用 `except Exception` 接住，所以具体
    类型只影响可读性。extract() 自己抛的 ValueError（输入过长）才是要冒到接口层
    变成 422 的那一种，两者刻意分开。
    """
    data = json.loads(content)
    if not isinstance(data, dict):
        raise TypeError("顶层不是对象")

    raw_lines = data.get("lines")
    if not isinstance(raw_lines, list):
        raise TypeError("lines 不是数组")

    lines: list[ExtractedLine] = []
    for item in raw_lines:
        if not isinstance(item, dict):
            raise TypeError("lines 里有非对象元素")
        code, delta, source = item.get("code"), item.get("delta"), item.get("source", "")
        # bool 是 int 的子类，这里必须排除，否则 True 会被当成 1。
        if not isinstance(code, str) or not code.strip():
            raise TypeError(f"code 非法: {code!r}")
        if not isinstance(delta, int) or isinstance(delta, bool):
            raise TypeError(f"delta 非整数: {delta!r}")
        if delta == 0:
            continue  # 零变动没有意义，直接丢掉
        lines.append(
            ExtractedLine(
                code=code.strip().upper(),
                delta=delta,
                source=str(source or "").strip(),
            )
        )

    raw_unresolved = data.get("unresolved") or []
    unresolved = [str(u) for u in raw_unresolved if isinstance(raw_unresolved, list) and str(u).strip()]
    return Extraction(lines=lines, unresolved=unresolved, model=model)


def _ask_one(client: httpx.Client, settings: Settings, model: str, text: str) -> Extraction:
    url = settings.llm_base_url.rstrip("/") + "/v1/chat/completions"
    headers = {"Authorization": f"Bearer {settings.llm_api_key}"}

    res = client.post(url, json=_build_body(model, text, True), headers=headers)
    # azure_ai/gpt-5.6-terra 只接受默认温度，显式传 0 会 400。这类模型不该被
    # 当成"不可用"而跳过，去掉 temperature 重试一次即可。
    if res.status_code == 400 and "temperature" in res.text:
        log.info("%s 不接受 temperature，去掉后重试", model)
        res = client.post(url, json=_build_body(model, text, False), headers=headers)

    res.raise_for_status()
    payload = res.json()
    content = payload["choices"][0]["message"]["content"]
    return _parse(content, model)


def extract(text: str, settings: Settings) -> Extraction:
    """按优先级逐个模型尝试，返回第一个成功的结果。"""
    if not settings.llm_configured:
        raise LLMUnavailable("未配置 LLM 网关（PINDOU_LLM_BASE_URL / PINDOU_LLM_API_KEY）")

    text = text.strip()
    if not text:
        return Extraction(lines=[], unresolved=[], model="")
    if len(text) > MAX_INPUT_CHARS:
        raise ValueError(f"输入过长（{len(text)} 字），上限 {MAX_INPUT_CHARS} 字")

    models = settings.llm_model_list
    if not models:
        raise LLMUnavailable("没有配置任何模型")

    failures: list[str] = []
    with httpx.Client(timeout=settings.llm_timeout) as client:
        for model in models:
            try:
                result = _ask_one(client, settings, model, text)
            except Exception as exc:  # noqa: BLE001 - 任何失败都只是"换下一个"
                # 网关的错误正文里可能带 key，只留异常类型和简短描述。
                reason = f"{model}: {type(exc).__name__}"
                log.warning("模型 %s 失败，尝试下一个：%s", model, exc.__class__.__name__)
                failures.append(reason)
                continue
            if failures:
                log.info("模型 %s 成功（前面失败过 %d 个）", model, len(failures))
            return result

    raise LLMUnavailable("所有模型都失败了：" + "；".join(failures))
