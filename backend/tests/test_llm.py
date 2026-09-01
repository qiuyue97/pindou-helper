"""智能管控的抽取逻辑。

全部用 httpx 的 MockTransport 打桩，不打真实网关：测试不该花钱，也不该因为
外部服务抖动而变红。
"""

import json

import httpx
import pytest

from app.config import Settings
from app.llm import (
    MAX_INPUT_CHARS,
    RESPONSE_SCHEMA,
    SYSTEM_PROMPT,
    Extraction,
    LLMUnavailable,
    _parse,
    extract,
)

SETTINGS = Settings(
    llm_base_url="https://gateway.example",
    llm_api_key="sk-test",
    llm_models="model-a,model-b,model-c",
)


def _reply(lines, unresolved=()):
    return {
        "choices": [
            {
                "message": {
                    "content": json.dumps({"lines": lines, "unresolved": list(unresolved)})
                }
            }
        ]
    }


def _mount(monkeypatch, handler):
    """把 httpx.Client 换成走 MockTransport 的版本。"""
    real = httpx.Client

    def factory(*args, **kwargs):
        kwargs.pop("timeout", None)
        return real(transport=httpx.MockTransport(handler), timeout=5)

    monkeypatch.setattr("app.llm.httpx.Client", factory)


# ---------- 请求长什么样 ----------


def test_asks_for_native_structured_output(monkeypatch):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(json.loads(request.content))
        seen["auth"] = request.headers["authorization"]
        seen["url"] = str(request.url)
        return httpx.Response(200, json=_reply([{"code": "A1", "delta": 5, "source": "A1加5"}]))

    _mount(monkeypatch, handler)
    extract("A1加5", SETTINGS)

    assert seen["url"] == "https://gateway.example/v1/chat/completions"
    assert seen["auth"] == "Bearer sk-test"
    # 靠 schema，不靠祈使句
    assert seen["response_format"] == {"type": "json_schema", "json_schema": RESPONSE_SCHEMA}
    assert seen["messages"][0]["content"] == SYSTEM_PROMPT
    assert seen["messages"][1]["content"] == "A1加5"


def test_schema_is_strict_and_closed():
    """strict + additionalProperties:false 是拿到稳定形状的前提，别被改掉。"""
    assert RESPONSE_SCHEMA["strict"] is True
    root = RESPONSE_SCHEMA["schema"]
    assert root["additionalProperties"] is False
    assert set(root["required"]) == {"lines", "unresolved"}
    item = root["properties"]["lines"]["items"]
    assert item["additionalProperties"] is False
    assert set(item["required"]) == {"code", "delta", "source"}
    assert item["properties"]["delta"]["type"] == "integer"


def test_prompt_keeps_the_worked_example():
    """删掉示例会让 gemma-4-31b-it 稳定返回空 lines（实测）。"""
    assert "示例" in SYSTEM_PROMPT
    assert '"delta":-50' in SYSTEM_PROMPT


# ---------- 降级 ----------


def test_falls_through_to_the_next_model_on_http_error(monkeypatch):
    tried = []

    def handler(request: httpx.Request) -> httpx.Response:
        model = json.loads(request.content)["model"]
        tried.append(model)
        if model == "model-a":
            return httpx.Response(500, text="boom")
        return httpx.Response(200, json=_reply([{"code": "B2", "delta": -3, "source": "x"}]))

    _mount(monkeypatch, handler)
    result = extract("随便", SETTINGS)

    assert tried == ["model-a", "model-b"]
    assert result.model == "model-b"
    assert result.lines[0].code == "B2"


def test_falls_through_when_the_payload_is_malformed(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        model = json.loads(request.content)["model"]
        if model == "model-a":
            return httpx.Response(200, json={"choices": [{"message": {"content": "不是 JSON"}}]})
        if model == "model-b":
            # 合法 JSON，但 delta 是字符串
            return httpx.Response(
                200, json=_reply([{"code": "A1", "delta": "5", "source": "x"}])
            )
        return httpx.Response(200, json=_reply([{"code": "A1", "delta": 5, "source": "x"}]))

    _mount(monkeypatch, handler)
    result = extract("随便", SETTINGS)
    assert result.model == "model-c"


def test_raises_when_every_model_fails(monkeypatch):
    _mount(monkeypatch, lambda request: httpx.Response(503, text="down"))
    with pytest.raises(LLMUnavailable) as excinfo:
        extract("随便", SETTINGS)
    # 报错里要能看出每个模型都试过了，但不能带上 key
    message = str(excinfo.value)
    for model in ("model-a", "model-b", "model-c"):
        assert model in message
    assert "sk-test" not in message


def test_a_model_that_rejects_temperature_is_retried_without_it(monkeypatch):
    """azure_ai/gpt-5.6-terra 只接受默认温度；这种模型不该被当成不可用。"""
    bodies = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        bodies.append(body)
        if "temperature" in body:
            return httpx.Response(
                400, text="Unsupported value: 'temperature' does not support 0"
            )
        return httpx.Response(200, json=_reply([{"code": "A1", "delta": 1, "source": "x"}]))

    _mount(monkeypatch, handler)
    result = extract("随便", SETTINGS)

    # 同一个模型重试，而不是跳到下一个
    assert [b["model"] for b in bodies] == ["model-a", "model-a"]
    assert "temperature" not in bodies[1]
    assert result.model == "model-a"


def test_other_400s_are_not_retried_but_fall_through(monkeypatch):
    bodies = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        bodies.append(body["model"])
        if body["model"] == "model-a":
            return httpx.Response(400, text="context length exceeded")
        return httpx.Response(200, json=_reply([]))

    _mount(monkeypatch, handler)
    extract("随便", SETTINGS)
    assert bodies == ["model-a", "model-b"]


# ---------- 结果整理 ----------


def test_codes_are_upper_cased_and_trimmed():
    out = _parse(
        json.dumps({"lines": [{"code": " zg3 ", "delta": 8, "source": " x "}], "unresolved": []}),
        "m",
    )
    assert out.lines[0].code == "ZG3"
    assert out.lines[0].source == "x"


def test_zero_deltas_are_dropped():
    out = _parse(
        json.dumps(
            {
                "lines": [
                    {"code": "A1", "delta": 0, "source": "没变"},
                    {"code": "A2", "delta": 3, "source": "加3"},
                ],
                "unresolved": [],
            }
        ),
        "m",
    )
    assert [ln.code for ln in out.lines] == ["A2"]


def test_booleans_are_not_accepted_as_deltas():
    """bool 是 int 的子类，不排除的话 True 会被当成 +1。"""
    with pytest.raises(TypeError):
        _parse(
            json.dumps({"lines": [{"code": "A1", "delta": True, "source": "x"}], "unresolved": []}),
            "m",
        )


def test_duplicate_codes_are_kept_separate():
    out = _parse(
        json.dumps(
            {
                "lines": [
                    {"code": "A1", "delta": 10, "source": "加10"},
                    {"code": "A1", "delta": 20, "source": "又加20"},
                ],
                "unresolved": [],
            }
        ),
        "m",
    )
    # 合并会让用户在确认表里看不出自己说了两次
    assert [ln.delta for ln in out.lines] == [10, 20]


def test_unresolved_is_passed_through_and_blank_entries_dropped():
    out = _parse(
        json.dumps({"lines": [], "unresolved": ["天气不错", "  ", ""]}),
        "m",
    )
    assert out.unresolved == ["天气不错"]


# ---------- 边界 ----------


def test_blank_input_short_circuits_without_calling_anything(monkeypatch):
    def handler(request):  # pragma: no cover - 不该被调用
        raise AssertionError("空输入不应该调模型")

    _mount(monkeypatch, handler)
    assert extract("   \n  ", SETTINGS) == Extraction(lines=[], unresolved=[], model="")


def test_overlong_input_is_refused_before_spending_tokens(monkeypatch):
    def handler(request):  # pragma: no cover
        raise AssertionError("超长输入不应该调模型")

    _mount(monkeypatch, handler)
    with pytest.raises(ValueError, match="过长"):
        extract("字" * (MAX_INPUT_CHARS + 1), SETTINGS)


def test_unconfigured_gateway_reports_itself_clearly():
    with pytest.raises(LLMUnavailable, match="未配置"):
        extract("A1加5", Settings(llm_base_url="", llm_api_key=""))


def test_empty_model_list_is_reported():
    with pytest.raises(LLMUnavailable, match="没有配置任何模型"):
        extract(
            "A1加5",
            Settings(llm_base_url="https://x", llm_api_key="k", llm_models="  ,  "),
        )


def test_the_suite_never_talks_to_a_real_gateway(app):
    """conftest 把 LLM 配置清空了；这条是防止那几行被删掉。

    一旦失效，整个测试套件会开始真调外部模型：慢、要花钱、还会因为对方抖动变红。
    """
    from app.config import get_settings

    assert get_settings().llm_configured is False
