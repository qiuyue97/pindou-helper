"""业务日志。

uvicorn 只给它自己的 `uvicorn.*` 配了输出，`pindou.*` 一个 handler 都没有：
INFO 全被丢掉，WARNING 靠 Python 的兜底处理器漏出来，还不带时间。线上卡住了
翻 `docker logs`，只看得到一堆访问记录，什么都对不上。
"""

import logging

import pytest

from app.config import Settings
from app.logs import configure_logging


@pytest.fixture(autouse=True)
def _clean_pindou_logger():
    """每个测试都从一个没配过的 pindou logger 开始，测完复原。"""
    lg = logging.getLogger("pindou")
    saved = (lg.level, list(lg.handlers))
    lg.handlers.clear()
    yield
    lg.setLevel(saved[0])
    lg.handlers[:] = saved[1]


def test_business_logs_reach_stdout_with_time_level_and_source(capsys):
    configure_logging("INFO")
    logging.getLogger("pindou.sheets").info("图纸 %s 开始识别", 7)
    out = capsys.readouterr().out
    assert "图纸 7 开始识别" in out
    assert "INFO" in out
    assert "pindou.sheets" in out
    # 带日期时间：几条日志隔了多久，是定位「卡在哪」的全部依据
    assert any(ch.isdigit() for ch in out.split("INFO")[0])


def test_debug_is_hidden_at_info(capsys):
    configure_logging("INFO")
    logging.getLogger("pindou.x").debug("看不见")
    assert "看不见" not in capsys.readouterr().out


def test_level_can_be_lowered_to_debug(capsys):
    configure_logging("debug")
    logging.getLogger("pindou.x").debug("看得见")
    assert "看得见" in capsys.readouterr().out


def test_configuring_twice_does_not_print_twice(capsys):
    """--reload、测试里多次 create_app，都会再调一遍。"""
    configure_logging("INFO")
    configure_logging("INFO")
    logging.getLogger("pindou.x").info("只一次")
    assert capsys.readouterr().out.count("只一次") == 1


def test_a_bad_level_falls_back_to_info(capsys):
    configure_logging("LOUD")
    logging.getLogger("pindou.x").info("照常")
    assert "照常" in capsys.readouterr().out


def test_log_level_defaults_to_info():
    assert Settings(_env_file=None).log_level == "INFO"


def test_create_app_wires_it_up():
    from app.main import create_app

    create_app()
    assert logging.getLogger("pindou").handlers
