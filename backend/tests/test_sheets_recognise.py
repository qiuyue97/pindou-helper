"""识别接口。

后台线程跑，接口立刻 202。**识别不出来不是失败**：MinerU 全挂、没配 token、
这张图没有颜色结构，产出的都是一张全红的矩阵，status 仍然是 done——用户可以
从零改。真正的 failed 只有图片解不开、几何不合法、线程里的未预期异常。
"""

import io
import time

import pytest
from PIL import Image

from tests.conftest import XRW
from tests.sheet.synth import make_random_sheet
from tests.test_sheets_api import _upload, plain, vip  # noqa: F401


def _wait(client, sid, status="done", timeout=30.0):
    """后台线程是真线程，得等它跑完。"""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = client.get(f"/api/sheets/{sid}").json()
        if last["status"] == status:
            return last
        time.sleep(0.02)
    raise AssertionError(f"没有进入 {status}，当前 {last and last['status']}")


@pytest.fixture()
def sheet_png():
    s = make_random_sheet(rows=12, cols=10, n_codes=4, pitch=27, seed=1)
    buf = io.BytesIO()
    Image.fromarray(s.image[..., ::-1]).save(buf, "PNG")
    return buf.getvalue(), s


@pytest.fixture()
def uploaded(vip, sheet_png):  # noqa: F811
    png, s = sheet_png
    return _upload(vip, png).json()["id"], s


def _geom(s, **kw):
    return {"rect": s.rect, "rows": s.rows, "cols": s.cols,
            "has_blanks": False, "palette": "221", **kw}


def test_recognise_runs_and_finishes(vip, uploaded):  # noqa: F811
    sid, s = uploaded
    r = vip.post(f"/api/sheets/{sid}/recognise", json=_geom(s), headers=XRW)
    assert r.status_code == 202, r.text
    d = _wait(vip, sid)
    assert len(d["labels"]) == s.rows * s.cols
    assert d["classes"] and d["tally"]
    assert sum(d["tally"].values()) == s.rows * s.cols


def test_no_mineru_token_still_produces_a_full_red_matrix(vip, uploaded):  # noqa: F811
    """没配 token 是可用的降级，不是错误。"""
    sid, s = uploaded
    vip.post(f"/api/sheets/{sid}/recognise", json=_geom(s), headers=XRW)
    d = _wait(vip, sid)
    assert d["engine"] == "colour-only"
    assert all(c["level"] == "guess" for c in d["classes"])
    assert d["error"] == ""


def test_the_confirmed_geometry_is_stored(vip, uploaded):  # noqa: F811
    sid, s = uploaded
    vip.post(f"/api/sheets/{sid}/recognise",
             json=_geom(s, has_blanks=True, palette="291"), headers=XRW)
    d = _wait(vip, sid)
    assert d["has_blanks"] is True
    assert d["palette"] == "291"
    assert (d["rows"], d["cols"]) == (s.rows, s.cols)


def test_a_silly_cell_count_is_refused(vip, uploaded):  # noqa: F811
    """行列数是用户手填的，手滑一个数量级会把内存吃光。"""
    sid, s = uploaded
    r = vip.post(f"/api/sheets/{sid}/recognise",
                 json=_geom(s, rows=5000, cols=5000), headers=XRW)
    assert r.status_code == 422
    assert "格" in r.json()["detail"]


def test_zero_rows_is_refused_by_the_schema(vip, uploaded):  # noqa: F811
    sid, s = uploaded
    assert vip.post(f"/api/sheets/{sid}/recognise",
                    json=_geom(s, rows=0), headers=XRW).status_code == 422


def test_a_short_rect_is_refused_by_the_schema(vip, uploaded):  # noqa: F811
    sid, s = uploaded
    assert vip.post(f"/api/sheets/{sid}/recognise",
                    json=_geom(s, rect=[1, 2, 3]), headers=XRW).status_code == 422


def test_the_ai_prior_is_merged_in(vip, uploaded, monkeypatch):  # noqa: F811
    """并行跑现有的「拼豆图纸AI抽取」，它的色号+数量成为对账基准。"""
    from app.routers import sheets as mod

    monkeypatch.setattr(mod, "_fetch_prior",
                        lambda *a, **k: ({"H15": 999}, "kimi-k3"))
    sid, s = uploaded
    vip.post(f"/api/sheets/{sid}/recognise", json=_geom(s), headers=XRW)
    d = _wait(vip, sid)
    assert d["prior"] == {"H15": 999}
    by = {row["code"]: row for row in d["counts"]}
    assert by["H15"]["prior"] == 999
    assert by["H15"]["level"] == "count"


def test_a_failing_ai_extraction_does_not_fail_the_job(vip, uploaded, monkeypatch):  # noqa: F811
    """AI 抽取挂了 = 没有第二份证据，不是「全都对不上」。"""
    from app.routers import sheets as mod

    def boom(*a, **k):
        raise RuntimeError("gateway down")

    monkeypatch.setattr(mod, "_fetch_prior", boom)
    sid, s = uploaded
    vip.post(f"/api/sheets/{sid}/recognise", json=_geom(s), headers=XRW)
    d = _wait(vip, sid)
    assert d["prior"] == {}
    assert all(row["prior"] is None for row in d["counts"])


def test_the_ocr_is_called_exactly_once_per_job(vip, uploaded, monkeypatch):  # noqa: F811
    """先验比 CV 晚到，但**绝不能**因此整条重跑。

    重跑等于再发一次 MinerU 请求：第二份配额、第二份钱，还要重新采样重新聚类。
    正确做法是 analyse 一次、finalise 随先验重来。
    """
    from app.routers import sheets as mod

    calls = []
    real = mod.pipeline.analyse
    monkeypatch.setattr(mod.pipeline, "analyse",
                        lambda *a, **k: (calls.append(1), real(*a, **k))[1])
    monkeypatch.setattr(mod, "_fetch_prior", lambda *a, **k: ({"H15": 3}, "kimi"))

    sid, s = uploaded
    vip.post(f"/api/sheets/{sid}/recognise", json=_geom(s), headers=XRW)
    _wait(vip, sid)
    assert len(calls) == 1


def test_an_unexpected_error_lands_in_the_row_not_in_the_void(vip, uploaded,  # noqa: F811
                                                              monkeypatch):
    """线程里任何异常都必须落库。吞掉的话前台会永远转圈。"""
    from app.routers import sheets as mod

    def boom(*a, **k):
        raise RuntimeError("boom")

    monkeypatch.setattr(mod.pipeline, "analyse", boom)
    sid, s = uploaded
    vip.post(f"/api/sheets/{sid}/recognise", json=_geom(s), headers=XRW)
    d = _wait(vip, sid, "failed")
    assert d["error"]


def test_recognising_twice_at_once_is_refused(vip, uploaded, monkeypatch):  # noqa: F811
    from app.routers import sheets as mod

    monkeypatch.setattr(mod.pipeline, "analyse",
                        lambda *a, **k: time.sleep(1.0))
    sid, s = uploaded
    assert vip.post(f"/api/sheets/{sid}/recognise",
                    json=_geom(s), headers=XRW).status_code == 202
    r = vip.post(f"/api/sheets/{sid}/recognise", json=_geom(s), headers=XRW)
    assert r.status_code == 409


def test_re_recognising_clears_the_manual_cell_edits(vip, uploaded):  # noqa: F811
    """类的编号会变，overrides 指向的类已经不是原来那个。留着比清掉更让人困惑。"""
    sid, s = uploaded
    vip.post(f"/api/sheets/{sid}/recognise", json=_geom(s), headers=XRW)
    d = _wait(vip, sid)
    code = d["classes"][0]["code"]
    vip.patch(f"/api/sheets/{sid}/cells",
              json={"patches": [{"r": 0, "c": 0, "code": code}]},
              headers=XRW)
    vip.post(f"/api/sheets/{sid}/recognise", json=_geom(s), headers=XRW)
    assert _wait(vip, sid)["overrides"] == {}


def test_the_list_only_shows_my_own(vip, uploaded):  # noqa: F811
    from tests.test_sheets_api import _set_vip

    assert len(vip.get("/api/sheets").json()["sheets"]) == 1
    vip.post("/api/auth/logout", headers=XRW)
    vip.post("/api/auth/register",
             json={"username": "other", "password": "password123"}, headers=XRW)
    _set_vip("other")
    assert vip.get("/api/sheets").json()["sheets"] == []


def test_deleting_removes_the_record(vip, uploaded):  # noqa: F811
    sid, _ = uploaded
    assert vip.delete(f"/api/sheets/{sid}", headers=XRW).status_code == 204
    assert vip.get(f"/api/sheets/{sid}").status_code == 404


# ------------------------------------------------------------------ 进度 --
#
# 识别是后台线程跑的，用户那边只能看见状态字段。没有进度，整个过程就是一句
# 「可能要一两分钟」——用户分不出是在排队、在算，还是已经卡死了。


def test_progress_lands_on_100_when_done(vip, uploaded):  # noqa: F811
    sid, s = uploaded
    vip.post(f"/api/sheets/{sid}/recognise", json=_geom(s), headers=XRW)
    d = _wait(vip, sid)
    assert d["progress"] == 100
    assert d["step"] == ""          # 干完了就不该再报「正在做什么」


def test_progress_climbs_while_running(vip, uploaded):  # noqa: F811
    """跑的过程中 step 和 progress 都得真的动起来。"""
    sid, s = uploaded
    seen: set[tuple[str, int]] = set()
    vip.post(f"/api/sheets/{sid}/recognise", json=_geom(s), headers=XRW)
    deadline = time.time() + 30
    while time.time() < deadline:
        d = vip.get(f"/api/sheets/{sid}").json()
        seen.add((d["step"], d["progress"]))
        if d["status"] == "done":
            break
        time.sleep(0.005)
    # 至少见过一个「正在做某事」的中间态，而不是从 0 直接跳 100
    mid = {p for step, p in seen if step and 0 < p < 100}
    assert mid, f"没见到任何中间进度：{seen}"


def test_a_failed_run_clears_the_progress(vip, uploaded, monkeypatch):  # noqa: F811
    """失败了还留着半截进度条，比没有进度条更让人困惑。"""
    from app.routers import sheets as mod

    def boom(*a, **k):
        raise RuntimeError("boom")

    monkeypatch.setattr(mod.pipeline, "analyse", boom)
    sid, s = uploaded
    vip.post(f"/api/sheets/{sid}/recognise", json=_geom(s), headers=XRW)
    d = _wait(vip, sid, status="failed")
    assert d["progress"] == 0
    assert d["step"] == ""


def test_progress_resets_when_recognising_again(vip, uploaded, monkeypatch):  # noqa: F811
    """重新识别要把上一次的 100% 清掉。

    **把线程按在半路上再断言**，不能跑完一次就直接读——离线那条路快得很，后台线程
    常常在断言之前就又跑完了，于是读到的是新的 100 而不是重置后的 0，测试时红时绿。
    """
    import threading

    from app.routers import sheets as mod

    sid, s = uploaded
    vip.post(f"/api/sheets/{sid}/recognise", json=_geom(s), headers=XRW)
    assert _wait(vip, sid)["progress"] == 100

    gate = threading.Event()
    real = mod.pipeline.analyse

    def held(*a, **kw):
        gate.wait(10)
        return real(*a, **kw)

    monkeypatch.setattr(mod.pipeline, "analyse", held)
    vip.post(f"/api/sheets/{sid}/recognise", json=_geom(s), headers=XRW)
    try:
        d = vip.get(f"/api/sheets/{sid}").json()
        assert d["progress"] < 100      # 不能还挂着上一次的 100
        assert d["status"] in ("pending", "running")
    finally:
        gate.set()
    _wait(vip, sid)
