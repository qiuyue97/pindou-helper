"""生成图纸接口：照片 + 框选 + 豆阵尺寸 → 一张拼豆图纸。

产物落在**和识别完全相同的结构里**（labels + classes + counts），所以这里除了
验生成本身，还要验「它确实能当一张普通图纸用」——预览、改色号、导出、按图扣减
都是照着那套结构写的。
"""

import io
import time

import numpy as np
import pytest
from PIL import Image

from tests.conftest import XRW
from tests.test_sheets_api import _set_vip, _upload, grid_png, plain, vip  # noqa: F401


def _wait(client, sid, status="done", timeout=60.0):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = client.get(f"/api/sheets/{sid}").json()
        if last["status"] == status:
            return last
        time.sleep(0.02)
    raise AssertionError(f"没有进入 {status}，当前 {last and last['status']}")


@pytest.fixture()
def photo():
    """一张左红右蓝的「照片」。没有点阵，检测什么也找不到——这正是生成要处理的输入。"""
    im = np.zeros((240, 240, 3), np.uint8)
    im[:, :120] = (220, 30, 30)
    im[:, 120:] = (30, 60, 200)
    buf = io.BytesIO()
    Image.fromarray(im).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture()
def uploaded(vip, photo):  # noqa: F811
    return _upload(vip, photo).json()["id"]


def _body(**kw):
    return {"rect": [0, 0, 240, 240], "rows": 12, "cols": 12,
            "palette": "221", "style": "slic", **kw}


def test_generating_needs_vip(plain, photo):  # noqa: F811
    assert _upload(plain, photo).status_code == 403


def test_generate_produces_a_usable_sheet(vip, uploaded):  # noqa: F811
    r = vip.post(f"/api/sheets/{uploaded}/generate", json=_body(), headers=XRW)
    assert r.status_code == 202, r.text
    d = _wait(vip, uploaded)
    assert len(d["labels"]) == 12 * 12
    assert d["classes"] and d["counts"]
    # tally 是从 labels+classes 现推的，能推出来就说明结构是对的
    assert sum(d["tally"].values()) == 12 * 12


def test_a_two_colour_photo_gives_two_codes(vip, uploaded):  # noqa: F811
    """左红右蓝，边界正好在格子边上——不该冒出第三个「中间色」。"""
    vip.post(f"/api/sheets/{uploaded}/generate", json=_body(), headers=XRW)
    d = _wait(vip, uploaded)
    assert len(d["tally"]) == 2
    assert set(d["tally"].values()) == {72}       # 一半一半


def test_the_engine_says_it_was_generated(vip, uploaded):  # noqa: F811
    """前端要据此区分「识别出来的」和「生成出来的」——两者该说的话不一样。"""
    vip.post(f"/api/sheets/{uploaded}/generate", json=_body(style="dpid"),
             headers=XRW)
    d = _wait(vip, uploaded)
    assert d["engine"] == "generate/dpid"


def test_generated_classes_are_not_guesses(vip, uploaded):  # noqa: F811
    """色号是我们自己挑的，不是 OCR 读的，所以不该整片标成「按颜色猜的」。"""
    vip.post(f"/api/sheets/{uploaded}/generate", json=_body(), headers=XRW)
    d = _wait(vip, uploaded)
    assert all(c["source"] == "generate" for c in d["classes"])
    assert all(c["level"] == "ok" for c in d["classes"])


def test_generated_sheets_have_no_blanks_and_no_prior(vip, uploaded):  # noqa: F811
    """生成出来的每一格都有豆子；也没有图例可以对账。"""
    vip.post(f"/api/sheets/{uploaded}/generate", json=_body(), headers=XRW)
    d = _wait(vip, uploaded)
    assert d["has_blanks"] is False
    assert d["prior"] == {}


def test_the_crop_box_is_stored_so_thumbnails_line_up(vip, uploaded):  # noqa: F811
    """校对界面按 rect 从原图上裁每一格的缩略图，框存错了那些图全是歪的。"""
    vip.post(f"/api/sheets/{uploaded}/generate",
             json=_body(rect=[20, 30, 200, 210], rows=6, cols=6), headers=XRW)
    d = _wait(vip, uploaded)
    assert d["rect"] == [20, 30, 200, 210]
    assert (d["rows"], d["cols"]) == (6, 6)


def test_only_the_crop_box_is_used(vip, uploaded):  # noqa: F811
    """只框左半边（纯红），就该只出一个色号。"""
    vip.post(f"/api/sheets/{uploaded}/generate",
             json=_body(rect=[0, 0, 110, 240], rows=8, cols=4), headers=XRW)
    d = _wait(vip, uploaded)
    assert len(d["tally"]) == 1


def test_a_box_smaller_than_the_grid_fails_with_a_reason(vip, uploaded):  # noqa: F811
    """5x5 像素切 12x12 格，每格连一个像素都没有。要说清楚，不是默默出垃圾。"""
    vip.post(f"/api/sheets/{uploaded}/generate",
             json=_body(rect=[0, 0, 5, 5]), headers=XRW)
    d = _wait(vip, uploaded, status="failed")
    assert "小" in d["error"]


def test_a_silly_cell_count_is_refused(vip, uploaded):  # noqa: F811
    r = vip.post(f"/api/sheets/{uploaded}/generate",
                 json=_body(rows=2000, cols=2000), headers=XRW)
    assert r.status_code == 422


def test_an_unknown_style_is_refused_by_the_schema(vip, uploaded):  # noqa: F811
    r = vip.post(f"/api/sheets/{uploaded}/generate",
                 json=_body(style="magic"), headers=XRW)
    assert r.status_code == 422


def test_generating_someone_elses_sheet_is_a_404(vip, uploaded):  # noqa: F811
    vip.post("/api/auth/logout", headers=XRW)
    vip.post("/api/auth/register",
             json={"username": "gen2", "password": "password123"}, headers=XRW)
    _set_vip("gen2")
    r = vip.post(f"/api/sheets/{uploaded}/generate", json=_body(), headers=XRW)
    assert r.status_code == 404


def test_progress_is_reported_while_generating(vip, uploaded):  # noqa: F811
    seen = set()
    vip.post(f"/api/sheets/{uploaded}/generate",
             json=_body(rows=40, cols=40), headers=XRW)
    deadline = time.time() + 60
    while time.time() < deadline:
        d = vip.get(f"/api/sheets/{uploaded}").json()
        seen.add((d["step"], d["progress"]))
        if d["status"] in ("done", "failed"):
            break
        time.sleep(0.005)
    assert {p for step, p in seen if step and 0 < p < 100}, f"没见到中间进度：{seen}"


def test_regenerating_drops_the_old_hand_edits(vip, uploaded):  # noqa: F811
    """类的编号变了，overrides 的坐标还在但指的已经不是原来那个类。"""
    vip.post(f"/api/sheets/{uploaded}/generate", json=_body(), headers=XRW)
    d = _wait(vip, uploaded)
    code = next(iter(d["tally"]))
    vip.patch(f"/api/sheets/{uploaded}/cells",
              json={"patches": [{"r": 0, "c": 0, "code": code}]}, headers=XRW)
    assert vip.get(f"/api/sheets/{uploaded}").json()["overrides"]

    vip.post(f"/api/sheets/{uploaded}/generate", json=_body(), headers=XRW)
    assert _wait(vip, uploaded)["overrides"] == {}


# ------------------------------------------------------------ 上传时跳检测 --


def test_upload_for_generating_skips_lattice_detection(vip, photo):  # noqa: F811
    """照片上没有点阵可找。白跑一趟还会给出一个莫名其妙的初始框。"""
    r = vip.post("/api/sheets",
                 files={"file": ("p.png", io.BytesIO(photo), "image/png")},
                 data={"kind": "generate"}, headers=XRW)
    assert r.status_code == 201, r.text
    g = r.json()
    assert g["source"] == "manual"
    assert (g["rows"], g["cols"]) == (0, 0)
    assert g["snap_x"] == [] and g["snap_y"] == []
    assert (g["width"], g["height"]) == (240, 240)


def test_upload_still_detects_by_default(vip, grid_png):  # noqa: F811
    g = _upload(vip, grid_png).json()
    assert g["source"] == "lattice"
    assert g["rows"] > 0 and g["cols"] > 0


# -------------------------------------------------------------------- kind --
#
# 两条路的产物结构一样、过程完全不同。只看 status 的话，一张传去生成的照片会被
# 当成「待确认网格」的图纸，用户回来时弹出的是角点界面而不是框选界面。


def test_an_upload_remembers_which_path_it_came_from(vip, photo, grid_png):  # noqa: F811
    gen = vip.post("/api/sheets",
                   files={"file": ("p.png", io.BytesIO(photo), "image/png")},
                   data={"kind": "generate"}, headers=XRW).json()["id"]
    rec = _upload(vip, grid_png).json()["id"]
    assert vip.get(f"/api/sheets/{gen}").json()["kind"] == "generate"
    assert vip.get(f"/api/sheets/{rec}").json()["kind"] == "recognise"


def test_kind_survives_being_abandoned_half_way(vip, photo):  # noqa: F811
    """传完就走、回来再点进去——那时还没生成，全靠 kind 决定进哪个界面。"""
    sid = vip.post("/api/sheets",
                   files={"file": ("p.png", io.BytesIO(photo), "image/png")},
                   data={"kind": "generate"}, headers=XRW).json()["id"]
    d = vip.get(f"/api/sheets/{sid}").json()
    assert d["status"] == "ready" and d["kind"] == "generate"


def test_generating_sets_the_kind_even_if_it_was_uploaded_the_other_way(vip, grid_png):  # noqa: F811
    sid = _upload(vip, grid_png).json()["id"]
    vip.post(f"/api/sheets/{sid}/generate",
             json={"rect": [0, 0, 100, 100], "rows": 6, "cols": 6,
                   "palette": "221", "style": "dpid"}, headers=XRW)
    assert _wait(vip, sid)["kind"] == "generate"
