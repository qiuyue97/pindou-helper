"""类型嗅探与内联预算压缩。

这里的断言都盯着同一件事：压缩过程**绝不改分辨率**。图纸的信息就在那些几像素
高的色号文字上，降采样是拿识别率换体积，所以阶梯宁可在"还是太大"处停下，交给
不吃内联的模型，也不动一个像素的尺寸。
"""

import io

import pytest

from app.imaging import DE_WARN, fit_inline, normalise_name, sniff_image

PIL = pytest.importorskip("PIL.Image")


def _png(w=64, h=64, colours=None) -> bytes:
    """一张 w x h 的图。colours 给定时按列平涂，用来控制颜色种类。"""
    from PIL import Image

    im = Image.new("RGB", (w, h))
    px = im.load()
    n = colours or 4
    for x in range(w):
        for y in range(h):
            v = (x * n // w) * (255 // max(n - 1, 1))
            px[x, y] = (v, (v * 7) % 256, (v * 13) % 256)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def _noise(w=400, h=400) -> bytes:
    """随机噪声：最难压的东西，用来把阶梯逼到最后一级。"""
    import numpy as np
    from PIL import Image

    a = np.random.default_rng(0).integers(0, 256, (h, w, 3), dtype="uint8")
    buf = io.BytesIO()
    Image.fromarray(a).save(buf, "PNG")
    return buf.getvalue()


# ---------- 类型嗅探 ----------


def test_sniffs_by_content_not_by_name():
    jpeg = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01" + b"0" * 32
    assert sniff_image(jpeg) == (".jpg", "image/jpeg")
    # 名字说 png，内容说 jpeg —— 以内容为准，否则 FastGPT 会打回 500
    assert normalise_name("photo.png", jpeg) == ("photo.jpg", "image/jpeg")


def test_a_real_png_keeps_its_name():
    assert normalise_name("a.png", _png()) == ("a.png", "image/png")


def test_webp_is_recognised_despite_the_riff_container():
    data = b"RIFF" + b"\x00" * 4 + b"WEBP" + b"\x00" * 16
    assert sniff_image(data) == (".webp", "image/webp")


def test_unknown_content_is_not_guessed_into_an_image():
    assert sniff_image(b"not an image at all") is None


def test_a_nameless_upload_still_gets_a_name():
    assert normalise_name("", _png())[0] == "image.png"


# ---------- 阶梯 ----------


def _size(data: bytes) -> tuple[int, int]:
    from PIL import Image

    return Image.open(io.BytesIO(data)).size


def test_an_image_already_inside_the_budget_is_untouched():
    """够小就别动它。转码只会让本来就是 JPEG 的图变大。"""
    data = _png()
    out = fit_inline(data, budget=10 * 1024 * 1024)
    assert out.step == "original"
    assert out.data is data
    assert out.within_budget


def test_lossless_recompression_is_tried_before_anything_lossy():
    data = _png(400, 400, colours=4)
    out = fit_inline(data, budget=len(data) - 1)
    assert out.step == "png-recompress"
    assert out.within_budget
    assert out.lossless
    # 无损这一级绝不改像素
    from PIL import Image

    before = Image.open(io.BytesIO(data)).convert("RGB")
    after = Image.open(io.BytesIO(out.data)).convert("RGB")
    assert list(before.getdata()) == list(after.getdata())


def test_the_palette_step_reports_what_it_cost():
    data = _noise(300, 300)
    out = fit_inline(data, budget=len(data) // 3)
    assert out.step == "png8"
    assert out.within_budget
    assert out.size <= len(data) // 3
    # 量化了就得说清楚代价，而不是悄悄交出一张变了色的图
    assert out.de_p99 > 0
    if out.de_p99 > DE_WARN:
        assert out.notes and "量化" in out.notes[0]


def test_resolution_never_changes_at_any_step():
    """整条阶梯的核心保证。"""
    data = _noise(300, 300)
    for budget in (len(data) * 2, len(data) - 1, len(data) // 4, 1):
        out = fit_inline(data, budget=budget)
        assert _size(out.data) == (300, 300), f"budget={budget} 改了分辨率"


def test_giving_up_is_reported_rather_than_downscaling():
    """压不动就说压不动，交给不吃内联的模型——不是偷偷降采样。"""
    out = fit_inline(_noise(300, 300), budget=1)
    assert not out.within_budget
    assert _size(out.data) == (300, 300)
    assert out.notes and "不受此限" in out.notes[0]


def test_undecodable_data_is_passed_through_untouched():
    junk = b"\x89PNG\r\n\x1a\n" + b"broken"
    out = fit_inline(junk, budget=1)
    assert out.data == junk
    assert not out.within_budget
