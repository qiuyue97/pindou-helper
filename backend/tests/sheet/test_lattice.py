"""点阵检测。

这一步只产出**初始猜测和吸附靶点**，用户会在界面上确认。所以测试的标准不是
「像素级完美」，而是「省得用户从零拖」：rect 落在真值 1px 内、行列数完全一致。

找不到点阵不是异常。返回 None，让用户自己拖框——下游只吃
(rect, rows, cols, has_blanks)，手动路径和自动路径之后完全一样。
"""

import numpy as np

from app.sheet.lattice import detect
from tests.sheet.synth import make_random_sheet


def test_finds_the_grid_on_a_clean_sheet():
    s = make_random_sheet(rows=30, cols=28, n_codes=9, pitch=27, seed=0)
    g = detect(s.image)
    assert g is not None
    assert (g.rows, g.cols) == (s.rows, s.cols)
    assert np.allclose(g.rect, s.rect, atol=1.0)


def test_finds_a_small_pitch_grid():
    """小格子也要找得到（读不读得出字是另一回事）。

    这里止步于 20px，不是因为 13px 检测不了——真实的 13.4px 图纸是检测得到的，
    那一条由 test_golden.py 拿真图钉。合成渲染器在 16px 以下不够忠实：真实分隔线
    是半透明多次叠加的，交叉点比两条线都暗，梯度一路贯通；合成的即使做了 alpha
    混合，交叉处的落差仍在 Sobel 阈值以下，于是 _line_maps 的开运算把它抹掉。

    继续调渲染器去凑 13px 就是拿夹具反向拟合检测器。真图才是这件事的地面真值。
    """
    s = make_random_sheet(rows=40, cols=40, n_codes=6, pitch=20, seed=1)
    g = detect(s.image)
    assert g is not None
    assert (g.rows, g.cols) == (40, 40)


def test_snap_targets_sit_on_the_real_separators():
    s = make_random_sheet(rows=20, cols=20, n_codes=5, pitch=27, margin=40, seed=2)
    g = detect(s.image)
    assert g is not None
    # 每条真实分隔线附近都要有一个靶点，否则用户拖到那里吸不住
    for j in range(s.cols + 1):
        want = 40 + j * 27
        assert min(abs(np.array(g.snap_x) - want)) <= 2.0, want


def test_a_blank_image_yields_no_guess_rather_than_an_exception():
    """检测失败是正常路径，不是错误。"""
    assert detect(np.full((300, 300, 3), 255, np.uint8)) is None


def test_pure_noise_yields_no_guess():
    rng = np.random.default_rng(0)
    im = rng.integers(0, 256, (300, 300, 3), dtype=np.uint8)
    assert detect(im) is None


def test_jitter_does_not_move_the_frame():
    """JPEG 噪声不该让框动。"""
    a = detect(make_random_sheet(20, 20, 5, seed=4, jitter=0.0).image)
    b = detect(make_random_sheet(20, 20, 5, seed=4, jitter=2.0).image)
    assert a is not None and b is not None
    assert np.allclose(a.rect, b.rect, atol=1.5)
