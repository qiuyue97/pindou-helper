"""三级编辑。

  上层：改整类的色号   -> classes[k].code，一次生效几十上百格
  上层：改基准数量     -> prior[code]，重新对账、重算紫色告警
  格子：改单格/多选     -> overrides，稀疏，只存改过的

override 覆盖 class：用户手工挑出来的那几格是他的决定，后来的整类修改不该冲掉它。
"""

import io

import pytest
from PIL import Image

from tests.conftest import XRW
from tests.sheet.synth import make_random_sheet
from tests.test_sheets_api import _upload, vip  # noqa: F401
from tests.test_sheets_recognise import _wait


@pytest.fixture()
def done(vip):  # noqa: F811
    s = make_random_sheet(rows=8, cols=6, n_codes=3, pitch=27, seed=2)
    buf = io.BytesIO()
    Image.fromarray(s.image[..., ::-1]).save(buf, "PNG")
    sid = _upload(vip, buf.getvalue()).json()["id"]
    vip.post(f"/api/sheets/{sid}/recognise",
             json={"rect": s.rect, "rows": s.rows, "cols": s.cols,
                   "has_blanks": False, "palette": "221"}, headers=XRW)
    return sid, _wait(vip, sid)


def _patch(c, sid, what, body):
    return c.patch(f"/api/sheets/{sid}/{what}", json=body, headers=XRW)


# ---------- 整类 ----------

def test_changing_a_class_moves_all_its_cells(vip, done):  # noqa: F811
    sid, d = done
    k, n = d["classes"][0]["klass"], d["classes"][0]["n"]
    r = _patch(vip, sid, "classes", {"patches": [{"k": k, "code": "M3"}]})
    assert r.status_code == 200, r.text
    assert r.json()["tally"]["M3"] == n


def test_an_unknown_class_is_a_422(vip, done):  # noqa: F811
    sid, _ = done
    assert _patch(vip, sid, "classes",
                  {"patches": [{"k": 999, "code": "M3"}]}).status_code == 422


def test_a_code_outside_the_catalogue_is_a_422(vip, done):  # noqa: F811
    """色卡是权威。让用户填一个不存在的色号，「按图扣减」那边会直接报错。"""
    sid, d = done
    r = _patch(vip, sid, "classes",
               {"patches": [{"k": d["classes"][0]["klass"], "code": "ZZ99"}]})
    assert r.status_code == 422
    assert "色号" in r.json()["detail"]


# ---------- 格子 ----------

def test_changing_one_cell_leaves_its_class_alone(vip, done):  # noqa: F811
    sid, d = done
    before = d["tally"]
    r = _patch(vip, sid, "cells", {"patches": [{"r": 0, "c": 0, "code": "M3"}]})
    assert r.status_code == 200, r.text
    assert r.json()["tally"]["M3"] == before.get("M3", 0) + 1
    assert r.json()["overrides"] == {"0,0": "M3"}


def test_multiple_cells_in_one_call(vip, done):  # noqa: F811
    sid, _ = done
    r = _patch(vip, sid, "cells",
               {"patches": [{"r": 0, "c": 0, "code": "M3"},
                            {"r": 1, "c": 1, "code": "M3"},
                            {"r": 2, "c": 2, "code": "M3"}]})
    assert r.json()["tally"]["M3"] == 3


def test_an_empty_code_clears_the_override(vip, done):  # noqa: F811
    sid, _ = done
    _patch(vip, sid, "cells", {"patches": [{"r": 0, "c": 0, "code": "M3"}]})
    r = _patch(vip, sid, "cells", {"patches": [{"r": 0, "c": 0, "code": ""}]})
    assert r.json()["overrides"] == {}


def test_an_override_survives_a_later_class_change(vip, done):  # noqa: F811
    sid, d = done
    k = d["classes"][0]["klass"]
    _patch(vip, sid, "cells", {"patches": [{"r": 0, "c": 0, "code": "M3"}]})
    r = _patch(vip, sid, "classes", {"patches": [{"k": k, "code": "B8"}]})
    assert r.json()["overrides"] == {"0,0": "M3"}


def test_an_out_of_range_cell_is_a_422(vip, done):  # noqa: F811
    sid, _ = done
    assert _patch(vip, sid, "cells",
                  {"patches": [{"r": 999, "c": 0, "code": "M3"}]}).status_code == 422


def test_an_empty_patch_list_is_a_422(vip, done):  # noqa: F811
    sid, _ = done
    assert _patch(vip, sid, "cells", {"patches": []}).status_code == 422


# ---------- 先验与对账 ----------

def test_editing_the_prior_recomputes_the_reconciliation(vip, done):  # noqa: F811
    sid, d = done
    row = d["counts"][0]
    r = _patch(vip, sid, "prior", {"prior": {row["code"]: row["sheet"] + 5}})
    by = {x["code"]: x for x in r.json()["counts"]}
    assert by[row["code"]]["prior"] == row["sheet"] + 5
    assert by[row["code"]]["level"] == "count"


def test_a_matching_prior_clears_the_purple(vip, done):  # noqa: F811
    sid, d = done
    row = d["counts"][0]
    r = _patch(vip, sid, "prior", {"prior": {row["code"]: row["sheet"]}})
    by = {x["code"]: x for x in r.json()["counts"]}
    assert by[row["code"]]["level"] != "count"


def test_editing_cells_updates_the_reconciliation_too(vip, done):  # noqa: F811
    """改格子会改变本图数量，对账要跟着重算——不然紫色会停在上一次的状态上。"""
    sid, d = done
    row = d["counts"][0]
    _patch(vip, sid, "prior", {"prior": {row["code"]: row["sheet"]}})
    r = _patch(vip, sid, "cells", {"patches": [{"r": 0, "c": 0, "code": "M3"}]})
    by = {x["code"]: x for x in r.json()["counts"]}
    assert by[row["code"]]["sheet"] in (row["sheet"], row["sheet"] - 1)
    if by[row["code"]]["sheet"] != row["sheet"]:
        assert by[row["code"]]["level"] == "count", "数量变了紫色必须亮起来"


def test_a_zero_prior_removes_that_row(vip, done):  # noqa: F811
    sid, d = done
    code = d["counts"][0]["code"]
    r = _patch(vip, sid, "prior", {"prior": {code: 0}})
    assert r.json()["prior"] == {}


def test_a_prior_code_outside_the_catalogue_is_a_422(vip, done):  # noqa: F811
    sid, _ = done
    assert _patch(vip, sid, "prior", {"prior": {"ZZ99": 3}}).status_code == 422


# ---------- 越权 ----------

def test_editing_someone_elses_sheet_is_a_404(vip, done):  # noqa: F811
    from tests.test_sheets_api import _set_vip

    sid, _ = done
    vip.post("/api/auth/logout", headers=XRW)
    vip.post("/api/auth/register",
             json={"username": "other", "password": "password123"}, headers=XRW)
    _set_vip("other")
    assert _patch(vip, sid, "cells",
                  {"patches": [{"r": 0, "c": 0, "code": "M3"}]}).status_code == 404
