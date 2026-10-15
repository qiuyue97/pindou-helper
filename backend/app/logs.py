"""业务日志的输出。

uvicorn 只给它自己的 `uvicorn.*` 配了 handler，`pindou.*` 一个都没有：INFO 全被
丢掉，WARNING 靠 Python 的兜底处理器漏到 stderr，还不带时间。线上卡住了去翻
`docker logs`，只看得到访问记录，后台线程里发生了什么一概没有。

这里只管 `pindou` 这一棵树，不碰 root、不碰 uvicorn：访问日志照旧，业务日志
另起一路打到 stdout。不关 propagate——root 平时没有 handler，不会重复；测试里
pytest 的 caplog 挂在 root 上，正好能收到。

另外可以再落一份文件（`log_dir`）。docker 的日志跟着容器走，每次部署重建容器
就没了——问题发生后中间部署过一次，就再也查不到。文件放在挂载出来的目录里，
按天切、留 `keep_days` 天：当天的是 pindou.log，之前的是 pindou.log.2026-10-14。
"""

from __future__ import annotations

import logging
import logging.handlers
import os
import sys

#: 带日期时间和线程名。后台任务的线程叫 sheet-<id> / pattern-<id>，几条日志之间
#: 隔了多久、是哪一张图纸的，是定位「卡在哪」的全部依据。
FORMAT = "%(asctime)s %(levelname)s %(name)s [%(threadName)s] %(message)s"
DATEFMT = "%Y-%m-%d %H:%M:%S"
FILE_NAME = "pindou.log"


def _ours(lg: logging.Logger, kind: str) -> bool:
    return any(getattr(h, "_pindou", None) == kind for h in lg.handlers)


def _add(lg: logging.Logger, h: logging.Handler, kind: str) -> None:
    h._pindou = kind  # type: ignore[attr-defined]
    h.setFormatter(logging.Formatter(FORMAT, DATEFMT))
    lg.addHandler(h)


def configure_logging(level: str = "INFO", log_dir: str = "", keep_days: int = 30) -> None:
    """给 `pindou` 挂 stdout（和可选的文件）handler。重复调用只更新级别，不会重复打印。"""
    lg = logging.getLogger("pindou")
    resolved = logging.getLevelName(level.strip().upper())
    bad = not isinstance(resolved, int)
    lg.setLevel(logging.INFO if bad else resolved)

    if not _ours(lg, "stdout"):
        _add(lg, logging.StreamHandler(sys.stdout), "stdout")

    if bad:
        lg.warning("PINDOU_LOG_LEVEL=%r 不认识，按 INFO 处理", level)

    if log_dir and not _ours(lg, "file"):
        try:
            os.makedirs(log_dir, exist_ok=True)
            # 按本地时间（容器里 TZ=Asia/Shanghai）的零点切
            h = logging.handlers.TimedRotatingFileHandler(
                os.path.join(log_dir, FILE_NAME), when="midnight",
                backupCount=max(1, keep_days), encoding="utf-8",
            )
        except OSError as exc:
            # 挂载目录权限没配好之类。服务照样起来，只是少了文件那一路。
            lg.warning("写不了日志文件 %s（%s），只输出到 stdout", log_dir, exc)
            return
        _add(lg, h, "file")
