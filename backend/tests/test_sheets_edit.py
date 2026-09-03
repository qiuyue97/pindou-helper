"""三级编辑。

  上层：改整类的色号   -> classes[k].code，一次生效几十上百格
  上层：改基准数量     -> prior[code]，重新对账、重算紫色告警
  格子：改单格/多选     -> overrides，稀疏，只存改过的

override 覆盖 class：用户手工挑出来的那几格是他的决定，后来的整类修改不该冲掉它。
"""

import io

import pytest
from PIL import Image

from app.db import get_sessionmaker
from app.models import Sheet
from app.text_parse import code_key
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


# ---------- 对账是推导出来的 ----------

def test_a_stale_count_flag_is_recomputed_on_read(vip, done):  # noqa: F811
    """库里留着的「数量对不上」不是权威，取图纸时重算。

    早先的版本把 count 写进类的 level，而下一次对账取的是「已有 level 和 count
    的最大值」——于是它只进不出：用户把图纸数量改成和已识别数量一样，红色感叹号
    还挂在那儿。这类记录现在还在库里，读的时候就得算掉。
    """
    sid, d = done
    code = d["counts"][0]["code"]

    # 伪造一条脏记录：数量明明对得上，却存着 count
    with get_sessionmaker()() as session:
        sheet = session.get(Sheet, sid)
        sheet.prior = {r["code"]: r["sheet"] for r in sheet.counts}
        sheet.counts = [{**r, "level": "count"} for r in sheet.counts]
        sheet.classes = [{**c, "level": "count"} for c in sheet.classes]
        session.commit()

    got = vip.get(f"/api/sheets/{sid}").json()
    by = {r["code"]: r for r in got["counts"]}
    assert by[code]["prior"] == by[code]["sheet"]
    assert by[code]["level"] != "count", "数量对上了就不该再标"
    assert all(c["level"] != "count" for c in got["classes"])


def test_problem_rows_are_listed_first(vip, done):  # noqa: F811
    """有问题的排上面，两组各自按色号顺序。

    识别在测试里走的是颜色兜底（没有 MinerU token），所有类都是 guess、全都算
    有问题。先把它们改成正常的 OCR 结果，才有「有问题的」和「没问题的」之分。
    """
    sid, d = done
    codes = sorted((r["code"] for r in d["counts"]), key=code_key)
    with get_sessionmaker()() as session:
        sheet = session.get(Sheet, sid)
        sheet.classes = [{**c, "source": "ocr", "de": 0.5, "off_list": False,
                          "dup": None} for c in sheet.classes]
        prior = {r["code"]: r["sheet"] for r in sheet.counts}
        prior[codes[-1]] += 7         # 让**排最后**的那个色号数量对不上
        sheet.prior = prior
        session.commit()

    got = vip.get(f"/api/sheets/{sid}").json()["counts"]
    assert [r["level"] for r in got].count("count") == 1
    # 按色号排它在最后，但它有问题，所以要顶到第一行
    assert got[0]["code"] == codes[-1] and got[0]["level"] == "count"
    rest = [r["code"] for r in got[1:]]
    assert rest == sorted(rest, key=code_key)
    assert all(r["level"] == "ok" for r in got[1:])


# ---------- 整体改色号（按色号，不按类） ----------

def test_recode_moves_classes_and_hand_edited_cells_together(vip, done):  # noqa: F811
    """把 C18 改成 M3：类名下的格子和手工挪进来的格子都要跟着走。

    只改类的话，那几个手工挪进 C18 的豆点会继续显示成 C18——界面上凭空多出一个
    谁都没要的色号。
    """
    sid, d = done
    code = d["counts"][0]["code"]
    other = next(r["code"] for r in d["counts"] if r["code"] != code)
    n_before = d["tally"][code]

    # 从另一个色号手工挪一格进来
    k = next(c for c in d["classes"] if c["code"] == other)
    flat = k["cells"][0]
    r0, c0 = divmod(flat, d["cols"])
    moved = _patch(vip, sid, "cells", {"patches": [{"r": r0, "c": c0, "code": code}]})
    assert moved.json()["tally"][code] == n_before + 1

    got = _patch(vip, sid, "recode", {"code": code, "to": "M3"})
    assert got.status_code == 200, got.text
    body = got.json()
    assert code not in body["tally"], "旧色号不该还剩下格子"
    assert body["tally"]["M3"] == n_before + 1
    assert all(c["code"] != code for c in body["classes"])


def test_recode_works_for_a_code_that_has_no_class_at_all(vip, done):  # noqa: F811
    """图例里有、一个都没识别出来的色号：用户逐格挪了豆点进去之后也要能整体改。

    这一行名下全是逐格覆盖，一个类都没有。按类改的话它根本改不动——界面上表现为
    「改色号」按钮一直是灰的。
    """
    sid, d = done
    k = d["classes"][0]
    r0, c0 = divmod(k["cells"][0], d["cols"])
    _patch(vip, sid, "cells", {"patches": [{"r": r0, "c": c0, "code": "M3"}]})

    body = _patch(vip, sid, "recode", {"code": "M3", "to": "B8"}).json()
    assert "M3" not in body["tally"]
    assert body["tally"]["B8"] == 1


def test_recode_rejects_a_code_outside_the_palette(vip, done):  # noqa: F811
    sid, d = done
    r = _patch(vip, sid, "recode", {"code": d["counts"][0]["code"], "to": "ZZ9"})
    assert r.status_code == 422


# ---------- 空白格 ----------

def test_a_cell_can_be_marked_blank(vip, done):  # noqa: F811
    """有空格子的图纸上，生成器把空格印成了浅色、被识别成了某个色号——
    得能把它改回空白。空串不行，那是「撤销这一格的修正」。"""
    sid, d = done
    k = d["classes"][0]
    r0, c0 = divmod(k["cells"][0], d["cols"])
    before = d["tally"][k["code"]]

    body = _patch(vip, sid, "cells", {"patches": [{"r": r0, "c": c0, "code": "-"}]}).json()
    assert body["tally"][k["code"]] == before - 1, "空格不计入任何色号"
    assert body["overrides"][f"{r0},{c0}"] == "-"


def test_a_blank_cell_can_be_given_a_code(vip, done):  # noqa: F811
    """反过来也要能改：识别成空白、其实有豆子的那些格。"""
    sid, d = done
    k = d["classes"][0]
    r0, c0 = divmod(k["cells"][0], d["cols"])
    _patch(vip, sid, "cells", {"patches": [{"r": r0, "c": c0, "code": "-"}]})

    body = _patch(vip, sid, "cells", {"patches": [{"r": r0, "c": c0, "code": "M3"}]}).json()
    assert body["tally"]["M3"] == 1


def test_blank_is_not_checked_against_the_palette(vip, done):  # noqa: F811
    """空白不是色号，不该拿色卡去校验它。"""
    sid, d = done
    r = _patch(vip, sid, "cells", {"patches": [{"r": 0, "c": 0, "code": "-"}]})
    assert r.status_code == 200, r.text


def test_recoding_the_blank_group_fills_every_blank_cell(vip, done):  # noqa: F811
    """把「空白格」整组改成一个色号：检测出来的空格没有类，只能逐格写覆盖。"""
    sid, d = done
    k = d["classes"][0]
    r0, c0 = divmod(k["cells"][0], d["cols"])
    r1, c1 = divmod(k["cells"][1], d["cols"])
    _patch(vip, sid, "cells", {"patches": [{"r": r0, "c": c0, "code": "-"},
                                           {"r": r1, "c": c1, "code": "-"}]})

    body = _patch(vip, sid, "recode", {"code": "-", "to": "B8"}).json()
    assert body["tally"]["B8"] == 2
    assert "-" not in body["overrides"].values()


def test_recoding_a_code_to_blank_empties_it(vip, done):  # noqa: F811
    """整类改成空白：改的是类的色号，不必逐格写覆盖。"""
    sid, d = done
    code = d["counts"][0]["code"]
    body = _patch(vip, sid, "recode", {"code": code, "to": "-"}).json()
    assert code not in body["tally"]
    assert "-" not in body["tally"], "空白不是色号，不进统计"
