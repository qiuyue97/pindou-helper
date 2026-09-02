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


def test_a_missing_original_is_a_404_not_a_500(vip, grid_png, tmp_path):
    """卷被清过之后记录还在。要报「图片已不存在」，不是崩掉。"""
    import os

    from app.config import get_settings

    sid = _upload(vip, grid_png).json()["id"]
    for root, _dirs, files in os.walk(get_settings().upload_dir):
        for f in files:
            os.remove(os.path.join(root, f))
    assert vip.get(f"/api/sheets/{sid}/image").status_code == 404
