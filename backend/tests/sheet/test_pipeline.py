"""端到端编排。

MinerU 打桩（真实网络不进测试），其余全是真代码：真的检测、真的采样、真的聚类。

降级路径在这里集中验收：**没有一条会让识别变成失败**。识别不出来产出的是一张
全红的矩阵，那是正常产出，用户可以从零改。
"""

import io
import time

import numpy as np
import pytest
from PIL import Image

from app.colour import delta_e00, load_palette, srgb_to_lab
from app.sheet import mineru, pipeline
from app.sheet.decide import decide
from tests.sheet.synth import make_random_sheet


def _png(sheet) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(sheet.image[..., ::-1]).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture
def sheet():
    return make_random_sheet(rows=20, cols=18, n_codes=6, pitch=27, seed=7)


@pytest.fixture
def geom(sheet):
    return pipeline.Geometry(rect=sheet.rect, rows=sheet.rows, cols=sheet.cols,
                             has_blanks=False, palette="221")


def _truth_codes(sheet):
    seen, out = set(), []
    for row in sheet.codes:
        for c in row:
            if c not in seen:
                seen.add(c)
                out.append(c)
    return out


def _answers_by_colour(classes, truth):
    """按每个类的类心色，从真值色号里挑最近的那个。

    这是「一个永远读对的 OCR」的替身：测试要验的是编排把答案摊回每一格的过程，
    不是 OCR 本身有多准。
    """
    pal = load_palette("221")
    out = []
    for c in classes:
        lab = srgb_to_lab(np.array(c["rgb"], float))
        d = [float(delta_e00(lab, pal.lab[pal.codes.index(t)])) for t in truth]
        out.append(truth[int(np.argmin(d))])
    return out


def test_detect_returns_a_usable_guess(sheet):
    g = pipeline.detect(_png(sheet))
    assert g is not None
    assert (g.rows, g.cols) == (sheet.rows, sheet.cols)


def test_detect_on_a_blank_image_returns_none():
    buf = io.BytesIO()
    Image.new("RGB", (300, 300), "white").save(buf, "PNG")
    assert pipeline.detect(buf.getvalue()) is None


def test_undecodable_bytes_raise_valueerror():
    with pytest.raises(ValueError):
        pipeline.decode_image(b"not an image")


def test_zero_rows_is_rejected(sheet):
    g = pipeline.Geometry(rect=sheet.rect, rows=0, cols=5)
    with pytest.raises(ValueError):
        pipeline.analyse(_png(sheet), g)


def test_recognise_without_ocr_still_produces_a_full_matrix(sheet, geom):
    """没有 token = 没有 OCR。每格仍然有色号，全部标红。"""
    r = pipeline.recognise(_png(sheet), geom, token="")
    assert len(r.labels) == sheet.rows * sheet.cols
    assert r.engine == "colour-only"
    assert r.classes
    assert all(c["source"] == "guess" for c in r.classes)
    assert all(c["level"] == "guess" for c in r.classes)


def test_recognise_survives_mineru_failing_every_time(sheet, geom, monkeypatch):
    monkeypatch.setattr(
        mineru, "read_classes",
        lambda *a, **k: (None, {"engine": "mineru", "attempts": 5,
                                "error": "boom", "tiles": 0, "classes": 0}))
    r = pipeline.recognise(_png(sheet), geom, token="t")
    assert r.engine == "colour-only"
    assert all(c["level"] == "guess" for c in r.classes)


def test_recognise_with_a_working_ocr_reads_every_cell(sheet, geom, monkeypatch):
    """读对时每格的色号必须和画进去的真值一致。"""
    truth = _truth_codes(sheet)
    # 先跑一遍拿到类的顺序和类心色，再按颜色排出「正确答案」喂给桩
    probe = pipeline.analyse(_png(sheet), geom, token="")
    answers = _answers_by_colour(
        [r.as_dict() for r in decide(probe.stats, probe.reads, probe.palette)],
        truth)

    monkeypatch.setattr(
        mineru, "read_classes",
        lambda *a, **k: (list(answers), {"model": "vlm", "attempts": 1,
                                         "error": None, "tiles": len(answers),
                                         "classes": len(answers)}))
    r = pipeline.recognise(_png(sheet), geom, token="t")
    assert r.engine.startswith("mineru")
    flat_truth = [c for row in sheet.codes for c in row]
    code_of = {c["klass"]: c["code"] for c in r.classes}
    assert [code_of[k] for k in r.labels] == flat_truth


def test_a_prior_shows_up_in_the_counts(sheet, geom):
    r = pipeline.recognise(_png(sheet), geom, token="", prior={"H15": 999})
    by = {row["code"]: row for row in r.counts}
    assert "H15" in by
    assert by["H15"]["prior"] == 999
    assert by["H15"]["level"] == "count"


def test_no_colour_structure_skips_ocr_and_says_so(sheet, geom, monkeypatch):
    monkeypatch.setattr(pipeline, "has_colour_structure", lambda *a: False)
    called = []
    monkeypatch.setattr(mineru, "read_classes",
                        lambda *a, **k: called.append(1) or (None, {}))
    r = pipeline.recognise(_png(sheet), geom, token="t")
    assert r.structured is False
    assert called == [], "没有颜色结构时不该去调 OCR"
    assert all(c["level"] == "guess" for c in r.classes)


def test_finalise_can_be_rerun_with_a_prior_without_touching_the_ocr(
        sheet, geom, monkeypatch):
    """先验是并行跑的 AI 抽取给的，比 CV 晚到。

    如果只能整条重跑，就要**再发一次 MinerU 请求**——第二份配额、第二份钱，还要
    重新采样重新聚类。所以贵的那一半只跑一次，定案和对账随先验反复重来。
    """
    calls = []
    monkeypatch.setattr(
        mineru, "read_classes",
        lambda *a, **k: (calls.append(1), (None, {"error": "x", "attempts": 1}))[1])

    an = pipeline.analyse(_png(sheet), geom, token="t")
    a = pipeline.finalise(an, prior=None)
    b = pipeline.finalise(an, prior={"H15": 999})

    assert len(calls) == 1, "finalise 不该再碰 OCR"
    assert a.labels == b.labels
    assert {r["code"]: r["prior"] for r in a.counts}.get("H15") is None
    assert {r["code"]: r["prior"] for r in b.counts}["H15"] == 999


def test_finalise_is_cheap_enough_to_call_repeatedly(sheet, geom):
    """用户每改一次基准数量都要重算一遍对账，慢了就没法做成交互。"""
    an = pipeline.analyse(_png(sheet), geom, token="")
    t0 = time.perf_counter()
    for _ in range(10):
        pipeline.finalise(an, prior={"H15": 3})
    assert (time.perf_counter() - t0) / 10 < 0.05


def test_blank_cells_are_honoured_when_the_user_says_there_are_some(sheet):
    g = pipeline.Geometry(rect=sheet.rect, rows=sheet.rows, cols=sheet.cols,
                          has_blanks=True, palette="221")
    r = pipeline.recognise(_png(sheet), g, token="")
    assert len(r.labels) == sheet.rows * sheet.cols


def test_the_291_palette_is_accepted(sheet):
    g = pipeline.Geometry(rect=sheet.rect, rows=sheet.rows, cols=sheet.cols,
                          has_blanks=False, palette="291")
    r = pipeline.recognise(_png(sheet), g, token="")
    assert r.classes
