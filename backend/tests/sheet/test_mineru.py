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
from app.sheet.blindgrid import PER_PAGE


def _glyph(seed):
    return np.random.default_rng(seed).random((30, 60)).astype(np.float32) * 255


def _table(codes):
    """按生产里真实的排布造一张 HTML 表：列数 = columns_for(块数)，末行补空。"""
    codes = list(codes)
    per_row = mineru.columns_for(len(codes))
    rows = []
    for r in range(0, len(codes), per_row):
        chunk = codes[r:r + per_row]
        chunk += [""] * (per_row - len(chunk))
        rows.append("<tr>" + "".join(f"<td>{c}</td>" for c in chunk) + "</tr>")
    return "<table>" + "".join(rows) + "</table>"


@pytest.fixture
def fake_service(monkeypatch):
    """一个可编程的假 MinerU。按提交的文件数返回同样多的上传地址和结果。

    `md` 是所有页共用的返回文本；`md_by_page` 可以逐页指定，用来构造「只有某一页
    坏了」的情形。`shuffle` 让结果乱序返回，验证按 data_id 归位。
    """

    class Fake:
        def __init__(self):
            self.puts, self.posts = [], []
            self.md = ""
            self.md_by_page = {}          # data_id -> 文本
            self.fail_times, self.calls = 0, 0
            self.shuffle = False
            self.submitted = []           # 每次提交的 data_id 列表
            self._pending = []

        def post(self, url, body, token=None):
            self.posts.append((url, body, token))
            ids = [f["data_id"] for f in body["files"]]
            self.submitted.append(ids)
            self._pending = ids
            return {"code": 0,
                    "data": {"batch_id": "b1",
                             "file_urls": [f"https://oss.example/{i}?sig=1"
                                           for i in ids]}}

        def get(self, url, token=None):
            self.calls += 1
            if self.calls <= self.fail_times:
                raise OSError("connection reset")
            res = [{"state": "done", "data_id": i,
                    "full_zip_url": f"https://oss.example/{i}.zip"}
                   for i in self._pending]
            if self.shuffle:
                res = list(reversed(res))
            return {"code": 0, "data": {"extract_result": res}}

        def put(self, url, data, headers):
            self.puts.append((url, data, headers))

        def fetch(self, url, timeout=0):
            page = url.rsplit("/", 1)[-1].removesuffix(".zip")
            text = self.md_by_page.get(page, self.md)
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w") as z:
                z.writestr("full.md", text)
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
    fake_service.md = _table(["A1"])
    mineru.parse(b"png-bytes", token="t")
    _url, _data, headers = fake_service.puts[0]
    assert "content-type" not in {k.lower() for k in headers}
    assert headers["Content-Length"] == "9"


def test_the_submission_disables_caching_and_formulas(fake_service):
    fake_service.md = _table(["A1"])
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
    fake_service.md = _table(["H15", "A11"])
    reads, info = mineru.read_classes([g1, g1.copy(), g2], {"H15", "A11"},
                                      token="t")
    assert reads is not None
    assert info["tiles"] == 2 and info["classes"] == 3
    assert reads[0] == reads[1] == "H15"
    assert reads[2] == "A11"


def test_an_unreadable_cell_becomes_none_not_a_guess(fake_service):
    fake_service.md = _table(["ZZZZ"])
    reads, _ = mineru.read_classes([_glyph(3)], {"H15"}, token="t")
    assert reads == [None]


def test_a_wrong_shaped_table_is_retried_then_given_up_on(fake_service):
    fake_service.md = "<table><tr><td>A1</td><td>B2</td></tr></table>"  # 宽度不对
    reads, info = mineru.read_classes([_glyph(4)], {"A1"}, token="t", attempts=3)
    assert reads is None
    assert info["attempts"] == 3
    assert "expected 1" in info["error"]   # 1 块瓦片的页就是 1 列


def test_transport_failures_are_retried_and_then_succeed(fake_service):
    fake_service.fail_times = 2
    fake_service.md = _table(["A1"])
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


# ---------- 分页 ----------

def _full_page(n=None):
    """一整页的表。列数按 columns_for 算，和 blind_grid 画出来的一致。"""
    n = PER_PAGE if n is None else n
    return _table([f"A{i % 20 + 1}" for i in range(n)])

def test_many_classes_are_submitted_as_several_pages_in_one_batch(fake_service):
    """一千多个类是几页，不是一张巨图；而且一次请求带上所有页，不是一页一个请求。"""
    n = PER_PAGE + 5
    fake_service.md_by_page = {"page-0": _full_page(),
                               "page-1": _full_page(5)}
    pics = [_glyph(i) for i in range(n)]
    reads, info = mineru.read_classes(pics, {f"A{i}" for i in range(1, 21)},
                                      token="t")
    assert info["pages"] == 2
    assert len(fake_service.posts) == 1, "所有页要在同一批里提交"
    assert len(fake_service.puts) == 2
    assert reads is not None and len(reads) == n


def test_only_the_bad_page_is_read_again(fake_service):
    """重发整批等于为一页的失败付全批的钱。"""
    n = PER_PAGE + 5
    fake_service.md_by_page = {"page-0": _full_page(),
                               "page-1": "<table><tr><td>A1</td></tr></table>"}
    pics = [_glyph(i) for i in range(n)]
    mineru.read_classes(pics, {f"A{i}" for i in range(1, 21)}, token="t",
                        attempts=3)
    assert fake_service.submitted[0] == ["page-0", "page-1"]
    # 第一页读好了，之后每次只重提交坏掉的那一页
    assert all(ids == ["page-0"] for ids in fake_service.submitted[1:])


# 注：**多图批次的返回结构不在这里断言。**
#
# 它长什么样没法预测，拿自己编的 mock 去测只能证明代码和想象一致。上面那个假服务
# 现在只用来验「我们发出去了什么」——一批里提交几个文件、只重读坏掉的那一页——
# 那部分是我们自己的行为，mock 得起。
#
# 「回来的是什么」由 scripts/probe_mineru_batch.py 打真实接口确认，据此再写解析。
