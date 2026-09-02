"""真实图纸的回归基准。默认跳过。

合成图纸能断言到具体某一格，但它是我们自己画的——它证明不了代码在**真实**生成器
的输出上也成立。这个测试补上那一点，比对 13 张人工确认过的图纸（4 个不同生成器，
pitch 13–61，有空格的和密铺的都有）。

    PINDOU_GOLDEN_SHEETS=D:/wlh/code/fastgpt_code_sandbox_self/图纸切分 \
        python -m pytest tests/sheet/test_golden.py -v

没设这个变量就整体跳过，CI 不受影响。

**断言的标准不是「像素级完美」，而是「省得用户从零拖」。** 检测只产出初始猜测，
用户会在界面上确认，所以真正要守住的是两件事：任何一张都不能完全找不到点阵，
以及偏差不能大到还不如重画——实测最差 208px，而在加可信度闸之前是 3328px。
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

#: 实测最差 208px（58828AF7）。留一点余量当回归上限——超过它说明有东西退化了，
#: 而不是「又差了一点点」。
MAX_RECT_ERROR = 250.0

#: 这几张实测落在 2px 内。它们是「好路径」的代表：pattern() 的两条判据都成立，
#: 收窄被采纳。任何一张掉出来都说明收窄那条路坏了。
EXACT = {
    "D7C611C92FB07A3E1E937290B32A664E",
    "IMG_8422", "IMG_8423", "IMG_8425",
    "20D04BDFC5CCB72180DD6D43710F39E2",
    "D63E4322FD6F5D12736D6447165406CF",
}


def _grids():
    store = Path(ROOT) / "grids.json"
    return json.loads(store.read_text(encoding="utf-8")) if store.is_file() else {}


def _find(name: str):
    """图纸散在 images/ 和 test_images/ 两个目录里。"""
    base = Path(ROOT).parent
    for folder in ("images", "test_images"):
        for ext in IMAGE_EXTS:
            p = base / folder / (name + ext)
            if p.is_file():
                return p
    return None


def _cases():
    if not ROOT:
        return []
    out = []
    for name, meta in _grids().items():
        p = _find(name)
        if p is not None:
            out.append(pytest.param(p, meta, id=name[:12]))
    return out


def _read(path: Path):
    """cv2.imread 在非 ASCII 路径上会静默失败，走 numpy 缓冲。"""
    import cv2

    return cv2.imdecode(np.fromfile(str(path), dtype=np.uint8), cv2.IMREAD_COLOR)


CASES = _cases()


@pytest.mark.parametrize(("path", "meta"), CASES)
def test_every_sheet_yields_a_usable_starting_frame(path, meta):
    g = detect(_read(path))
    assert g is not None, f"{path.name} 完全没找到点阵"
    err = max(abs(a - b) for a, b in zip(g.rect, meta["rect"]))
    assert err <= MAX_RECT_ERROR, f"{path.name} 偏差 {err:.1f}px，用户不如自己重画"


@pytest.mark.parametrize(("path", "meta"), CASES)
def test_the_frame_is_never_wildly_smaller_than_the_truth(path, meta):
    """错要错在偏大。

    框大了用户往里收一下就行；一个错的小框会骗过人眼。加可信度闸之前，有空格的
    图纸会被切成 6x1 这种，那比不收窄糟得多。
    """
    g = detect(_read(path))
    assert g is not None
    assert g.rows * g.cols >= 0.5 * meta["rows"] * meta["cols"], (
        f"{path.name} 检测出 {g.rows}x{g.cols}，真值 {meta['rows']}x{meta['cols']}")


@pytest.mark.parametrize(("path", "meta"), CASES)
def test_the_good_path_still_lands_on_the_confirmed_frame(path, meta):
    """pattern() 的判据都成立时，必须收到真值上。

    只对已知走通那条路的图纸断言。其余几张 pattern() 的前提不成立（有空白格，
    或画面背景本身很淡），退回整个点阵是正确行为，不该在这里要求它们变准——
    那需要换算法，不是这次的范围。
    """
    if path.stem not in EXACT:
        pytest.skip("这张走的是「退回整个点阵」那条路，由上面两个测试守着")
    g = detect(_read(path))
    assert g is not None
    assert (g.rows, g.cols) == (meta["rows"], meta["cols"])
    assert np.allclose(g.rect, meta["rect"], atol=2.0), (g.rect, meta["rect"])


def test_the_corpus_covers_both_paths():
    """光有密铺图纸测不出这次修的问题——语料必须两种都有。"""
    metas = _grids()
    assert len(CASES) >= 13, f"只找到 {len(CASES)} 张，语料不完整"
    blanks = [n for n, m in metas.items() if m["has_blanks"]]
    assert len(blanks) >= 3, "语料里缺少有空白格的图纸"
