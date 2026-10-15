"""业务日志。

uvicorn 只给它自己的 `uvicorn.*` 配了输出，`pindou.*` 一个 handler 都没有：
INFO 全被丢掉，WARNING 靠 Python 的兜底处理器漏出来，还不带时间。线上卡住了
翻 `docker logs`，只看得到一堆访问记录，什么都对不上。
"""

import logging
import logging.handlers

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
    # 测试里开的文件 handler 要关掉，不然 Windows 上 tmp_path 删不掉
    for h in lg.handlers:
        if h not in saved[1]:
            h.close()
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


# ---------- 落文件 ----------
#
# docker 的日志跟着容器走：每次部署 `up -d --build` 重建容器，之前的日志就没了。
# 问题发生后中间部署过一次，就再也查不到。所以另写一份到挂载出来的目录里。


def _file_handlers():
    return [h for h in logging.getLogger("pindou").handlers
            if isinstance(h, logging.handlers.TimedRotatingFileHandler)]


def _flush():
    for h in logging.getLogger("pindou").handlers:
        h.flush()


def test_no_log_dir_means_no_file():
    configure_logging("INFO")
    assert _file_handlers() == []


def test_logs_are_also_written_to_a_file(tmp_path, capsys):
    configure_logging("INFO", log_dir=str(tmp_path))
    logging.getLogger("pindou.sheets").info("图纸 9 识别完成")
    _flush()
    text = (tmp_path / "pindou.log").read_text(encoding="utf-8")
    assert "图纸 9 识别完成" in text
    assert "pindou.sheets" in text
    # stdout 那一路照旧，docker logs 还能看
    assert "图纸 9 识别完成" in capsys.readouterr().out


def test_the_log_dir_is_created_if_missing(tmp_path):
    d = tmp_path / "nested" / "logs"
    configure_logging("INFO", log_dir=str(d))
    logging.getLogger("pindou.x").info("建目录")
    _flush()
    assert (d / "pindou.log").exists()


def test_files_rotate_daily_and_keep_n_days(tmp_path):
    configure_logging("INFO", log_dir=str(tmp_path), keep_days=7)
    [h] = _file_handlers()
    assert h.when == "MIDNIGHT"
    assert h.backupCount == 7


def test_configuring_twice_opens_only_one_file(tmp_path):
    configure_logging("INFO", log_dir=str(tmp_path))
    configure_logging("INFO", log_dir=str(tmp_path))
    assert len(_file_handlers()) == 1


def test_an_unwritable_log_dir_does_not_stop_the_app(tmp_path, capsys):
    """挂载目录权限没配好，服务照样得起来——只是少了文件那一路。"""
    blocker = tmp_path / "a-file"
    blocker.write_text("x")
    configure_logging("INFO", log_dir=str(blocker / "logs"))  # 父路径是个文件，建不了目录
    assert _file_handlers() == []
    logging.getLogger("pindou.x").info("照常")
    out = capsys.readouterr().out
    assert "照常" in out
    assert "写不了日志文件" in out


def test_log_file_settings_have_defaults():
    s = Settings(_env_file=None)
    assert s.log_dir == ""          # 开发机默认不落文件
    assert s.log_keep_days == 30


def test_log_level_defaults_to_info():
    assert Settings(_env_file=None).log_level == "INFO"


def test_create_app_wires_it_up():
    from app.main import create_app

    create_app()
    assert logging.getLogger("pindou").handlers
