"""业务日志的输出。

uvicorn 只给它自己的 `uvicorn.*` 配了 handler，`pindou.*` 一个都没有：INFO 全被
丢掉，WARNING 靠 Python 的兜底处理器漏到 stderr，还不带时间。线上卡住了去翻
`docker logs`，只看得到访问记录，后台线程里发生了什么一概没有。

这里只管 `pindou` 这一棵树，不碰 root、不碰 uvicorn：访问日志照旧，业务日志
另起一路打到 stdout。不关 propagate——root 平时没有 handler，不会重复；测试里
pytest 的 caplog 挂在 root 上，正好能收到。
"""

from __future__ import annotations

import logging
import sys

#: 带日期时间和线程名。后台任务的线程叫 sheet-<id> / pattern-<id>，几条日志之间
#: 隔了多久、是哪一张图纸的，是定位「卡在哪」的全部依据。
FORMAT = "%(asctime)s %(levelname)s %(name)s [%(threadName)s] %(message)s"
DATEFMT = "%Y-%m-%d %H:%M:%S"


def configure_logging(level: str = "INFO") -> None:
    """给 `pindou` 挂一个 stdout handler。重复调用只更新级别，不会重复打印。"""
    lg = logging.getLogger("pindou")
    resolved = logging.getLevelName(level.strip().upper())
    bad = not isinstance(resolved, int)
    lg.setLevel(logging.INFO if bad else resolved)

    if not any(getattr(h, "_pindou", False) for h in lg.handlers):
        h = logging.StreamHandler(sys.stdout)
        h._pindou = True  # type: ignore[attr-defined]
        h.setFormatter(logging.Formatter(FORMAT, DATEFMT))
        lg.addHandler(h)

    if bad:
        lg.warning("PINDOU_LOG_LEVEL=%r 不认识，按 INFO 处理", level)
