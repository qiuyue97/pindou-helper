"""图纸识别接口：上传与点阵检测。

一次一张图。检测不到点阵不是错误——返回一个整图大小的框、空的吸附靶点，
用户自己拖。
"""

import io

import pytest
from PIL import Image
from sqlalchemy import select

from app.db import get_sessionmaker
from app.models import User
from tests.conftest import XRW
from tests.sheet.synth import make_random_sheet


def _set_vip(username: str, value: bool = True) -> None:
    with get_sessionmaker()() as session:
        user = session.scalar(select(User).where(User.username == username))
        assert user is not None
        user.is_vip = value
        session.commit()


def _png(sheet=None) -> bytes:
    buf = io.BytesIO()
    if sheet is None:
        Image.new("RGB", (240, 180), "white").save(buf, "PNG")
    else:
        Image.fromarray(sheet.image[..., ::-1]).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture()
def grid_png():
    return _png(make_random_sheet(rows=20, cols=18, n_codes=6, pitch=27, seed=0))


@pytest.fixture()
def vip(client):
    r = client.post("/api/auth/register",
                    json={"username": "vip", "password": "password123"},
                    headers=XRW)
    assert r.status_code == 200, r.text
    _set_vip("vip")
    return client


@pytest.fixture()
def plain(client):
    r = client.post("/api/auth/register",
                    json={"username": "plain", "password": "password123"},
                    headers=XRW)
    assert r.status_code == 200, r.text
    return client


def _upload(c, data, name="a.png", ctype="image/png"):
    return c.post("/api/sheets", files={"file": (name, io.BytesIO(data), ctype)},
                  headers=XRW)


def test_upload_requires_vip(plain, grid_png):
    assert _upload(plain, grid_png).status_code == 403


def test_upload_returns_a_detected_guess(vip, grid_png):
    r = _upload(vip, grid_png)
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["source"] == "lattice"
    assert (d["rows"], d["cols"]) == (20, 18)
    assert len(d["rect"]) == 4
    assert d["snap_x"] and d["snap_y"]
    assert d["width"] > 0 and d["height"] > 0


def test_a_sheet_with_no_lattice_still_gets_a_row(vip):
    """检测失败是正常路径：给整图的框、空吸附靶点，让用户自己拖。"""
    r = _upload(vip, _png())
    assert r.status_code == 201
    d = r.json()
    assert d["source"] == "manual"
    assert d["rect"] == [0.0, 0.0, 240.0, 180.0]
    assert d["snap_x"] == [] and d["snap_y"] == []
    assert d["rows"] == 0 and d["cols"] == 0


def test_a_non_image_is_rejected_by_content_not_by_name(vip):
    """浏览器报的 content_type 是从后缀推的，后缀错它就跟着错。"""
    r = _upload(vip, b"not an image at all", name="x.png")
    assert r.status_code == 422
    assert "格式" in r.json()["detail"]


def test_a_jpeg_named_png_is_accepted(vip):
    """微信/QQ 转存把 JPEG 存成 .png 是常态，按内容判就不该拦。"""
    s = make_random_sheet(rows=12, cols=12, n_codes=4, pitch=27, seed=1)
    buf = io.BytesIO()
    Image.fromarray(s.image[..., ::-1]).save(buf, "JPEG", quality=95)
    assert _upload(vip, buf.getvalue(), name="a.png").status_code == 201


def test_an_oversized_upload_is_rejected(vip, grid_png, monkeypatch):
    from app.config import get_settings

    monkeypatch.setenv("PINDOU_UPLOAD_MAX_BYTES", "1000")
    get_settings.cache_clear()
    try:
        r = _upload(vip, grid_png)
        assert r.status_code == 422
        assert "MB" in r.json()["detail"]
    finally:
        monkeypatch.delenv("PINDOU_UPLOAD_MAX_BYTES", raising=False)
        get_settings.cache_clear()


def test_the_original_image_comes_back_untouched(vip, grid_png):
    """前端要拿它裁格子，所以必须是原尺寸原字节。"""
    sid = _upload(vip, grid_png).json()["id"]
    r = vip.get(f"/api/sheets/{sid}/image")
    assert r.status_code == 200
    assert r.content == grid_png


def test_another_users_sheet_is_a_404_not_a_403(vip, grid_png):
    """不区分「不存在」和「不是你的」，否则能靠状态码枚举 id。"""
    sid = _upload(vip, grid_png).json()["id"]
    vip.post("/api/auth/logout", headers=XRW)
    vip.post("/api/auth/register",
             json={"username": "other", "password": "password123"}, headers=XRW)
    _set_vip("other")
    assert vip.get(f"/api/sheets/{sid}/image").status_code == 404


def test_a_missing_original_is_a_404_not_a_500(vip, grid_png):
    """卷被清过之后记录还在。要报「图片已不存在」，不是崩掉。

    只删这张图纸自己那个文件。原来是 os.walk 整个 upload_dir 全删——配上
    conftest 当时没隔离上传目录，跑一次测试就把开发机上真实的图纸清空了。
    现在目录是隔离的，但这种「遍历删除」的写法本身就不该留在测试里。
    """
    import os

    from app.config import get_settings
    from app.db import get_sessionmaker
    from app.models import Sheet

    sid = _upload(vip, grid_png).json()["id"]
    with get_sessionmaker()() as session:
        rel = session.get(Sheet, sid).image
    os.remove(os.path.join(get_settings().upload_dir, rel))
    assert vip.get(f"/api/sheets/{sid}/image").status_code == 404


# ------------------------------------------------------- 命名 / 排序 / 缩略图 --


def test_a_new_sheet_has_no_name(vip, grid_png):
    """没起名字就是空串，前端据此显示 #id。"""
    sid = _upload(vip, grid_png).json()["id"]
    assert vip.get(f"/api/sheets/{sid}").json()["name"] == ""


def test_naming_a_sheet_sticks(vip, grid_png):
    sid = _upload(vip, grid_png).json()["id"]
    r = vip.patch(f"/api/sheets/{sid}/name", json={"name": "  小熊  "}, headers=XRW)
    assert r.status_code == 200
    assert r.json()["name"] == "小熊"          # 两头的空格掐掉
    assert vip.get("/api/sheets").json()["sheets"][0]["name"] == "小熊"


def test_an_empty_name_clears_it(vip, grid_png):
    """取消命名要能做到——回到 #id，不是留一个空白标题。"""
    sid = _upload(vip, grid_png).json()["id"]
    vip.patch(f"/api/sheets/{sid}/name", json={"name": "小熊"}, headers=XRW)
    r = vip.patch(f"/api/sheets/{sid}/name", json={"name": ""}, headers=XRW)
    assert r.json()["name"] == ""


def test_naming_someone_elses_sheet_is_a_404(vip, grid_png):
    sid = _upload(vip, grid_png).json()["id"]
    vip.post("/api/auth/logout", headers=XRW)
    vip.post("/api/auth/register",
             json={"username": "other2", "password": "password123"}, headers=XRW)
    _set_vip("other2")
    r = vip.patch(f"/api/sheets/{sid}/name", json={"name": "抢过来"}, headers=XRW)
    assert r.status_code == 404


def test_without_reordering_the_newest_is_first(vip, grid_png):
    """加了 position 之后，没排过序的行为必须和以前**一模一样**。"""
    a = _upload(vip, grid_png).json()["id"]
    b = _upload(vip, grid_png).json()["id"]
    assert [s["id"] for s in vip.get("/api/sheets").json()["sheets"]] == [b, a]


def test_reordering_sticks(vip, grid_png):
    a = _upload(vip, grid_png).json()["id"]
    b = _upload(vip, grid_png).json()["id"]
    c = _upload(vip, grid_png).json()["id"]
    r = vip.put("/api/sheets/order", json={"ids": [a, c, b]}, headers=XRW)
    assert r.status_code == 204
    assert [s["id"] for s in vip.get("/api/sheets").json()["sheets"]] == [a, c, b]


def test_a_sheet_uploaded_after_reordering_goes_on_top(vip, grid_png):
    """排过序之后新传的图纸不能沉到底下——用户刚传完就是要接着弄它。"""
    a = _upload(vip, grid_png).json()["id"]
    b = _upload(vip, grid_png).json()["id"]
    vip.put("/api/sheets/order", json={"ids": [a, b]}, headers=XRW)
    c = _upload(vip, grid_png).json()["id"]
    assert vip.get("/api/sheets").json()["sheets"][0]["id"] == c


def test_reordering_ignores_ids_that_are_not_yours(vip, grid_png):
    """别人的 id 混进来直接跳过，而不是报错——也不该真的改到别人的东西。"""
    mine = _upload(vip, grid_png).json()["id"]
    vip.post("/api/auth/logout", headers=XRW)
    vip.post("/api/auth/register",
             json={"username": "other3", "password": "password123"}, headers=XRW)
    _set_vip("other3")
    theirs = _upload(vip, grid_png).json()["id"]

    vip.post("/api/auth/logout", headers=XRW)
    vip.post("/api/auth/login",
             json={"username": "vip", "password": "password123"}, headers=XRW)
    r = vip.put("/api/sheets/order", json={"ids": [theirs, mine]}, headers=XRW)
    assert r.status_code == 204
    assert [s["id"] for s in vip.get("/api/sheets").json()["sheets"]] == [mine]


def test_the_thumbnail_is_small(vip, grid_png):
    """列表里一次十几张，不能让它去下载几 MB 的原图。"""
    sid = _upload(vip, grid_png).json()["id"]
    r = vip.get(f"/api/sheets/{sid}/thumb")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    im = Image.open(io.BytesIO(r.content))
    assert max(im.size) <= 400
    assert len(r.content) < len(grid_png)


def test_the_thumbnail_is_cacheable(vip, grid_png):
    """图片上传之后不会再变，所以可以让浏览器留着——否则每次进列表都要重解一遍。"""
    sid = _upload(vip, grid_png).json()["id"]
    r = vip.get(f"/api/sheets/{sid}/thumb")
    assert "max-age" in r.headers.get("cache-control", "")


def test_another_users_thumbnail_is_a_404(vip, grid_png):
    sid = _upload(vip, grid_png).json()["id"]
    vip.post("/api/auth/logout", headers=XRW)
    vip.post("/api/auth/register",
             json={"username": "other4", "password": "password123"}, headers=XRW)
    _set_vip("other4")
    assert vip.get(f"/api/sheets/{sid}/thumb").status_code == 404


def test_a_missing_original_gives_a_404_thumbnail_not_a_500(vip, grid_png):
    import os

    from app.config import get_settings
    from app.db import get_sessionmaker
    from app.models import Sheet

    sid = _upload(vip, grid_png).json()["id"]
    with get_sessionmaker()() as session:
        rel = session.get(Sheet, sid).image
    os.remove(os.path.join(get_settings().upload_dir, rel))
    assert vip.get(f"/api/sheets/{sid}/thumb").status_code == 404


# ------------------------------------------------------------- id 会被重用 --


def test_sqlite_reuses_the_id_of_the_sheet_you_just_deleted(vip, grid_png):
    """删掉最后一张再传一张，新的那张会**拿到同一个 id**。

    id 是 SQLite 的 rowid，没加 AUTOINCREMENT，删掉最大的那行就把号腾出来了。
    于是新旧两张图纸的缩略图 URL 一模一样（/api/sheets/17/thumb），而那个响应带着
    一天的强缓存——浏览器压根不会再来问一次，用户在「我的图纸」里看到的还是被删掉
    那张的缩略图。

    这条钉住的是**前提**：只要 id 还会重用，按 id 拼出来的图片 URL 就必须带上
    一个能区分两张图纸的记号（前端用 created_at）。
    """
    first = _upload(vip, grid_png).json()["id"]
    second = _upload(vip, grid_png).json()["id"]
    assert second == first + 1

    vip.delete(f"/api/sheets/{second}", headers=XRW)
    again = _upload(vip, grid_png).json()["id"]
    assert again == second, "id 没被重用的话这条就该删掉，缓存那个坑也不存在了"


def test_two_sheets_sharing_an_id_differ_by_created_at(vip, grid_png):
    """前端拿 created_at 当缓存记号，所以它必须真的能区分开这两张。"""
    sid = _upload(vip, grid_png).json()["id"]
    before = vip.get(f"/api/sheets/{sid}").json()["created_at"]
    vip.delete(f"/api/sheets/{sid}", headers=XRW)
    again = _upload(vip, grid_png).json()["id"]
    after = vip.get(f"/api/sheets/{again}").json()["created_at"]
    assert again == sid
    assert after != before
