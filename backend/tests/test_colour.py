"""色彩计算的地基。

CIEDE2000 的公式长且到处是分支，抄错一个符号不会崩，只会让所有色差悄悄偏掉。
所以这里钉的是 Sharma 等人论文里的参考对——它专门为暴露这种错误设计。
"""

import numpy as np
import pytest

from app.colour import delta_e00, load_palette, srgb_to_lab

# Sharma, Wu & Dalal (2005) 的参考数据，专挑各个分支的边界
SHARMA = [
    ((50.0, 2.6772, -79.7751), (50.0, 0.0, -82.7485), 2.0425),
    ((50.0, 3.1571, -77.2803), (50.0, 0.0, -82.7485), 2.8615),
    ((50.0, 2.8361, -74.0200), (50.0, 0.0, -82.7485), 3.4412),
    ((50.0, -1.3802, -84.2814), (50.0, 0.0, -82.7485), 1.0000),
    ((50.0, -1.1848, -84.8006), (50.0, 0.0, -82.7485), 1.0000),
    ((60.2574, -34.0099, 36.2677), (60.4626, -34.1751, 39.4387), 1.2644),
    ((22.7233, 20.0904, -46.6940), (23.0331, 14.9730, -42.5619), 2.0373),
    ((90.8027, -2.0831, 1.4410), (91.1528, -1.6435, 0.0447), 1.4441),
]


@pytest.mark.parametrize(("a", "b", "want"), SHARMA)
def test_ciede2000_matches_the_reference_pairs(a, b, want):
    got = float(delta_e00(np.array(a), np.array(b)))
    assert got == pytest.approx(want, abs=1e-3)


def test_delta_e00_broadcasts():
    """逐类对全色卡算距离要靠广播，纯 Python 循环在一万格上跑不动。"""
    labs = srgb_to_lab(np.random.default_rng(0).integers(0, 256, (7, 3)).astype(float))
    pal = srgb_to_lab(np.random.default_rng(1).integers(0, 256, (221, 3)).astype(float))
    d = delta_e00(labs[:, None, :], pal[None, :, :])
    assert d.shape == (7, 221)


def test_white_maps_to_l_100():
    lab = srgb_to_lab(np.array([255.0, 255.0, 255.0]))
    assert lab[0] == pytest.approx(100.0, abs=1e-4)
    assert lab[1] == pytest.approx(0.0, abs=1e-3)
    assert lab[2] == pytest.approx(0.0, abs=1e-3)


def test_221_is_a_subset_of_291():
    p221, p291 = load_palette("221"), load_palette("291")
    assert len(p291.codes) == 291
    assert len(p221.codes) == 221
    assert set(p221.codes) < set(p291.codes)


def test_palette_arrays_line_up_with_the_codes():
    p = load_palette("221")
    assert p.rgb.shape == (221, 3)
    assert p.lab.shape == (221, 3)
    # 第 k 行必须是第 k 个色号的颜色，否则整条 pipeline 会张冠李戴
    from app.catalog import BASE_BY_CODE

    for k in (0, 37, 220):
        want = BASE_BY_CODE[p.codes[k]]["hex"]
        got = "".join(f"{int(v):02X}" for v in p.rgb[k])
        assert got == want.upper()


def test_an_unknown_candidate_set_is_rejected():
    with pytest.raises(ValueError):
        load_palette("999")
