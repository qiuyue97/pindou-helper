"""MinerU 精准解析 v4：一张盲网格一个请求。

流程是三步：申请一个带签名的上传地址、PUT 上去、轮询批次结果。

凭据只从调用方传进来（最终来自环境变量 `PINDOU_MINERU_TOKEN`），这个文件里不写
任何 token。
"""

import http.client
import io
import json
import logging
import time
import urllib.parse
import urllib.request
import zipfile

from app.sheet.blindgrid import PER_ROW, blind_grid, dedupe, table_cells
from app.sheet.codes import candidates

log = logging.getLogger("pindou.sheet.mineru")

V4 = "https://mineru.net/api/v4"


class MineruError(Exception):
    pass


def _post(url, body, token=None):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json",
                 **({"Authorization": "Bearer " + token} if token else {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def _get(url, token=None):
    req = urllib.request.Request(
        url, headers={"Authorization": "Bearer " + token} if token else {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def _fetch(url, timeout=180):
    with urllib.request.urlopen(url, timeout=timeout) as h:
        return h.read()


def _put_signed(url, data, headers):
    """往签名 URL PUT 字节，**一个 Content-Type 都不带**。

    urllib 会给任何带 body 的请求补上 `Content-Type:
    application/x-www-form-urlencoded`，而这些 URL 的签名是按**空**内容类型算的
    —— 于是上传回来一个 403，原因和凭据毫无关系。http.client 只发给它的头，
    一个都不多。
    """
    u = urllib.parse.urlsplit(url)
    cls = (http.client.HTTPSConnection if u.scheme == "https"
           else http.client.HTTPConnection)
    conn = cls(u.netloc, timeout=300)
    try:
        conn.putrequest("PUT", u.path + ("?" + u.query if u.query else ""),
                        skip_host=False, skip_accept_encoding=True)
        for k, v in headers.items():
            conn.putheader(k, v)
        conn.endheaders()
        conn.send(data)
        r = conn.getresponse()
        text = r.read().decode("utf-8", "replace")
        if r.status not in (200, 201, 204):
            raise MineruError(f"upload failed {r.status}: {text[:300]}")
    finally:
        conn.close()


def parse(png: bytes, token: str, *, model: str = "vlm", poll: float = 1.0,
          timeout: float = 600.0) -> str:
    """提交一张 PNG，返回解析出的 markdown/HTML 文本。

    `enable_formula` 关掉是刻意的：这张网格是一堆短字母数字串，公式检测无事可找
    却大有可坏——一个读作 B11 的格子能回来一段公式标记。

    `no_cache` 打开也是刻意的：服务端会把解析过的 URL 内容缓存十五分钟，重试会被
    发回同一份坏解析，看起来就像一个重试也没用的失败。
    """
    r = _post(f"{V4}/file-urls/batch",
              {"enable_formula": False, "enable_table": True, "language": "en",
               "model_version": model, "no_cache": True,
               "files": [{"name": "grid.png", "is_ocr": True}]}, token)
    if r.get("code") not in (0, "0"):
        raise MineruError(f"submit failed: {r}")
    batch = r["data"]["batch_id"]
    _put_signed(r["data"]["file_urls"][0], png,
                {"Content-Length": str(len(png))})

    t0 = time.time()
    while time.time() - t0 < timeout:
        s = _get(f"{V4}/extract-results/batch/{batch}", token)
        res = (s.get("data", {}).get("extract_result") or [{}])[0]
        if res.get("state") == "done":
            z = zipfile.ZipFile(io.BytesIO(_fetch(res["full_zip_url"])))
            md = [n for n in z.namelist() if n.endswith(".md")]
            if not md:
                raise MineruError("result zip has no markdown")
            return z.read(md[0]).decode("utf-8", "replace")
        if res.get("state") == "failed":
            raise MineruError(f"parse failed: {s}")
        time.sleep(poll)
    raise MineruError(f"batch {batch} did not finish in {timeout}s")


def read_classes(pics, valid, token: str, *, model: str = "vlm",
                 attempts: int = 5, timeout: float = 600.0):
    """一次请求读完所有类的字形，或者放弃并说清楚原因。

    返回 `(每个类的色号或 None, info)`。整体返回 `None` 表示服务用不了，调用方
    应当走颜色兜底——**这个函数不抛异常**，识别不出来是正常路径。

    重试同时覆盖传输失败和「表格形状不对」：两者的偶发性是一样的，而每次提交都带
    no_cache，所以重试是真的重新解析，不是把上一份坏答案从缓存里端回来。
    """
    info = {"engine": "mineru", "model": model, "attempts": 0, "error": None,
            "classes": len(pics), "tiles": 0}
    if not token:
        info["error"] = "no token"
        return None, info

    tiles, group = dedupe(pics)
    info["tiles"] = len(tiles)
    buf = io.BytesIO()
    blind_grid(tiles).save(buf, "PNG")
    png = buf.getvalue()

    for attempt in range(1, attempts + 1):
        info["attempts"] = attempt
        try:
            md = parse(png, token, model=model, timeout=timeout)
            cells, why = table_cells(md, PER_ROW, len(tiles))
            if cells is None:
                raise MineruError(f"unusable table: {why}")
        except Exception as e:  # noqa: BLE001 — 传输和形状两类都要重试
            info["error"] = f"{type(e).__name__}: {e}"
            log.info("mineru 第 %d/%d 次失败：%s", attempt, attempts, info["error"])
            if attempt < attempts:
                time.sleep(min(2 ** attempt, 20))
            continue

        info["error"] = None
        per_tile = [next(iter(candidates(c, valid)), None) for c in cells]
        return [per_tile[group[k]] for k in range(len(pics))], info
    return None, info
