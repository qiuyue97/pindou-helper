"""MinerU v4 客户端。

**全程打桩，绝不发真实请求。** 这里钉的是两个真金白银换来的坑，和一条纪律：

  1. 签名上传**不能带 Content-Type**。OSS 的签名按空 Content-Type 算，而 urllib
     会自动补 application/x-www-form-urlencoded，结果是 403 —— 一个和凭据毫无
     关系的 403。
  2. no_cache 必须开。服务端会缓存 URL 内容十五分钟，重试会拿回同一份坏解析，
     看起来像一个「重试也没用」的失败。
  3. 失败到底就返回 None，让调用方走颜色兜底，而不是抛出去炸掉整个任务。
"""

import io
import zipfile

import numpy as np
import pytest

from app.sheet import mineru


def _glyph(seed):
    return np.random.default_rng(seed).random((30, 60)).astype(np.float32) * 255


def _row(*cells):
    """一整行 PER_ROW 个单元格的 HTML，不足的补空。"""
    pad = list(cells) + [""] * (mineru.PER_ROW - len(cells))
    return "<table><tr>" + "".join(f"<td>{c}</td>" for c in pad) + "</tr></table>"


@pytest.fixture
def fake_service(monkeypatch):
    """一个可编程的假 MinerU。记下每次调用，按脚本返回。"""

    class Fake:
        def __init__(self):
            self.puts, self.posts, self.md = [], [], ""
            self.fail_times, self.calls = 0, 0

        def post(self, url, body, token=None):
            self.posts.append((url, body, token))
            return {"code": 0,
                    "data": {"batch_id": "b1",
                             "file_urls": ["https://oss.example/x?sig=1"]}}

        def get(self, url, token=None):
            self.calls += 1
            if self.calls <= self.fail_times:
                raise OSError("connection reset")
            return {"code": 0, "data": {"extract_result": [
                {"state": "done", "full_zip_url": "https://oss.example/z.zip"}]}}

        def put(self, url, data, headers):
            self.puts.append((url, data, headers))

        def fetch(self, url, timeout=0):
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w") as z:
                z.writestr("full.md", self.md)
            return buf.getvalue()

    f = Fake()
    monkeypatch.setattr(mineru, "_post", f.post)
    monkeypatch.setattr(mineru, "_get", f.get)
    monkeypatch.setattr(mineru, "_put_signed", f.put)
    monkeypatch.setattr(mineru, "_fetch", f.fetch)
    monkeypatch.setattr(mineru.time, "sleep", lambda _s: None)
    return f


def test_the_signed_upload_sends_no_content_type(fake_service):
    """这是花了真金白银才找到的 403 根因。改掉它就等于把那个 bug 放回来。"""
    fake_service.md = _row("A1")
    mineru.parse(b"png-bytes", token="t")
    _url, _data, headers = fake_service.puts[0]
    assert "content-type" not in {k.lower() for k in headers}
    assert headers["Content-Length"] == "9"


def test_the_submission_disables_caching_and_formulas(fake_service):
    fake_service.md = _row("A1")
    mineru.parse(b"png", token="t", model="vlm")
    _url, body, token = fake_service.posts[0]
    assert body["no_cache"] is True
    # 这张网格是一堆短字母数字串，公式检测无事可做却能把 B11 读成公式标记
    assert body["enable_formula"] is False
    assert body["enable_table"] is True
    assert body["model_version"] == "vlm"
    assert token == "t"


def test_read_classes_maps_tiles_back_to_every_class(fake_service):
    """去重把三个类折成两块瓦片，回来要摊回三个类。"""
    g1, g2 = _glyph(1), _glyph(2)
    fake_service.md = _row("H15", "A11")
    reads, info = mineru.read_classes([g1, g1.copy(), g2], {"H15", "A11"},
                                      token="t")
    assert reads is not None
    assert info["tiles"] == 2 and info["classes"] == 3
    assert reads[0] == reads[1] == "H15"
    assert reads[2] == "A11"


def test_an_unreadable_cell_becomes_none_not_a_guess(fake_service):
    fake_service.md = _row("ZZZZ")
    reads, _ = mineru.read_classes([_glyph(3)], {"H15"}, token="t")
    assert reads == [None]


def test_a_wrong_shaped_table_is_retried_then_given_up_on(fake_service):
    fake_service.md = "<table><tr><td>A1</td><td>B2</td></tr></table>"  # 宽度不对
    reads, info = mineru.read_classes([_glyph(4)], {"A1"}, token="t", attempts=3)
    assert reads is None
    assert info["attempts"] == 3
    assert "expected 10" in info["error"]


def test_transport_failures_are_retried_and_then_succeed(fake_service):
    fake_service.fail_times = 2
    fake_service.md = _row("A1")
    reads, info = mineru.read_classes([_glyph(5)], {"A1"}, token="t", attempts=5)
    assert reads == ["A1"]
    assert info["attempts"] == 3


def test_no_token_gives_up_immediately_without_calling_out(fake_service):
    reads, info = mineru.read_classes([_glyph(6)], {"A1"}, token="")
    assert reads is None
    assert info["error"] == "no token"
    assert fake_service.posts == []


def test_giving_up_never_raises(fake_service):
    """识别失败必须降级成颜色兜底，不能把整个后台任务炸掉。"""
    fake_service.fail_times = 99
    reads, info = mineru.read_classes([_glyph(7)], {"A1"}, token="t", attempts=2)
    assert reads is None
    assert info["error"]
