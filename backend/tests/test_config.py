"""图纸识别相关的配置。

MinerU 没配 token 不是错误配置——那时整条 pipeline 走颜色兜底并把每个格子标红，
功能仍然可用。所以 `mineru_configured` 只影响「要不要去调」，不影响「能不能开」。
"""

from app.config import Settings


def _settings(**kw) -> Settings:
    # _env_file=None：开发机的 backend/.env 里有真凭据，测试不能读它
    return Settings(_env_file=None, **kw)


def test_mineru_is_optional():
    s = _settings()
    assert s.mineru_token == ""
    assert s.mineru_configured is False


def test_mineru_configured_when_a_token_is_present():
    assert _settings(mineru_token="tok").mineru_configured is True


def test_sheet_concurrency_defaults_to_two():
    """CV 是 CPU 密集的，NAS（i5-12500t）上放开会拖垮 API 响应。"""
    assert _settings().sheet_concurrency == 2


def test_a_cell_cap_guards_against_a_slipped_digit():
    """rows/cols 是用户手填的。40000 比最大的真实样本（104x104 = 10,816）宽松四倍。"""
    assert _settings().sheet_max_cells == 40000


def test_the_mineru_timeout_is_generous():
    """vlm 的排队时长不可控，卡在后台线程里也不影响前台。"""
    assert _settings().mineru_timeout >= 300
