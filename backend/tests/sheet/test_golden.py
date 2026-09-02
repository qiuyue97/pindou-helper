"""真实图纸的回归基准。默认跳过。

合成图纸能断言到具体某一格，但它是我们自己画的——它证明不了代码在**真实**生成器
的输出上也成立。这个测试补上那一点。

    PINDOU_GOLDEN_SHEETS=D:/wlh/code/fastgpt_code_sandbox_self/图纸切分 \
        python -m pytest tests/sheet/test_golden.py -v

没设这个变量就整体跳过，CI 不受影响。

断言的是「重写的输出 == 当年那版已验证的自动检测」，而不是「== 人工确认的框」。
后者会在三张图上失败，但那不是缺陷：`grids.json` 里存着当年 auto_frame 的原始
输出，实测本重写在**全部 7 张**上和它逐位相同（偏差 13.7 / 906.9 / 286.2 /
0.0 x4）。检测器本来就在这三张上收不准——那正是整个流程要让用户确认网格的原因。

拿人工确认的框当断言，等于把「人补上的那一手」记到检测器头上；拿原版输出当断言，
钉住的才是这次重写有没有改变行为。
"""

import json
import os
from pathlib import Path

import numpy as np
import pytest

from app.sheet.lattice import detect

ROOT = os.environ.get("PINDOU_GOLDEN_SHEETS", "")
pytestmark = pytest.mark.skipif(not ROOT, reason="未设置 PINDOU_GOLDEN_SHEETS")

IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".bmp", ".webp")


def _cases():
    if not ROOT:
        return []
    store = Path(ROOT) / "grids.json"
    if not store.is_file():
        return []
    grids = json.loads(store.read_text(encoding="utf-8"))
    images = Path(ROOT).parent / "images"
    out = []
    for name, meta in grids.items():
        if "auto" not in meta:
            continue
        for ext in IMAGE_EXTS:
            p = images / (name + ext)
            if p.is_file():
                out.append(pytest.param(p, meta, id=name[:12]))
                break
    return out


def _read(path: Path):
    """cv2.imread 在非 ASCII 路径上会静默失败，走 numpy 缓冲。"""
    import cv2

    data = np.fromfile(str(path), dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


@pytest.mark.parametrize(("path", "meta"), _cases())
def test_the_rewrite_reproduces_the_original_auto_frame(path, meta):
    g = detect(_read(path))
    assert g is not None, f"{path.name} 完全没找到点阵"
    assert np.allclose(g.rect, meta["auto"]["rect"], atol=0.5), (
        g.rect, meta["auto"]["rect"])


@pytest.mark.parametrize(("path", "meta"), _cases())
def test_the_easy_sheets_land_on_the_confirmed_frame(path, meta):
    """当年自动检测就已经对准的那几张，重写之后必须还是对准的。

    只对「原版本来就准」的图纸断言。原版收不准的那三张在上一个测试里按原版行为
    钉着，不在这里重复要求它们变准——那需要换算法，不是这次重写的范围。
    """
    if not np.allclose(meta["auto"]["rect"], meta["rect"], atol=2.0):
        pytest.skip("这张图当年的自动检测就没对准，由上一个测试按原版行为钉住")
    g = detect(_read(path))
    assert g is not None
    assert (g.rows, g.cols) == (meta["rows"], meta["cols"])
    assert np.allclose(g.rect, meta["rect"], atol=2.0), (g.rect, meta["rect"])
