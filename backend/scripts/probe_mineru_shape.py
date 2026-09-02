"""盲网格的几何对 MinerU 读得动读不动有多大影响——真的打接口测。

第一次探针（probe_mineru_batch.py）发现 16 列 x 2 行那张（4802x302）**丢了整整
一行**，3 块瓦片那张（4802x152 的细缝）直接返回空。怀疑是长宽比：不管有几块瓦片
都铺满 16 列，图就变成又宽又扁的一条，解析器缩到标准宽度后字形糊没了。

这个脚本把几个几何放进同一批一次问清楚。会真的消耗配额，手动跑。

    MINERU_TOKEN=... python scripts/probe_mineru_shape.py
"""

import io
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
from PIL import Image, ImageDraw

from app.sheet import mineru
from scripts.probe_mineru_batch import glyph, redact, token

OUT = Path(__file__).with_name("_mineru_shape.json")

#: (标签, 瓦片数, 每行几列, 格宽, 格高)
CASES = [
    ("256块-16列-300x150(满页,大格)", 256, 16, 300, 150),
    ("256块-16列-150x100(满页,小格)", 256, 16, 150, 100),
    ("100块-10列-200x120(中等)",      100, 10, 200, 120),
    ("64块-8列-150x100(小页)",         64,  8, 150, 100),
]


def grid(pics, per_row, cw, ch):
    """和 app.sheet.blindgrid.blind_grid 同构，但列数和格子尺寸可调。"""
    rows = (len(pics) + per_row - 1) // per_row
    img = Image.new("RGB", (per_row * cw + 2, rows * ch + 2), "white")
    d = ImageDraw.Draw(img)
    for i, pic in enumerate(pics):
        x, y = 1 + (i % per_row) * cw, 1 + (i // per_row) * ch
        a = np.asarray(pic, np.float32)
        hi = max(float(np.percentile(a, 99.5)), 1e-6)
        g = np.clip(255 - a / hi * 255, 0, 255).astype(np.uint8)
        tile = Image.fromarray(g).convert("RGB")
        k = min((cw - 24) / tile.width, (ch - 24) / tile.height)
        tile = tile.resize((max(1, int(tile.width * k)),
                            max(1, int(tile.height * k))), Image.LANCZOS)
        img.paste(tile, (x + (cw - tile.width) // 2, y + (ch - tile.height) // 2))
    for r in range(rows + 1):
        d.line([(0, r * ch), (img.width, r * ch)], fill=(0, 0, 0), width=2)
    for c in range(per_row + 1):
        d.line([(c * cw, 0), (c * cw, img.height)], fill=(0, 0, 0), width=2)
    return img


def main() -> None:
    tok = token()
    pngs, meta = [], []
    for label, n, per_row, cw, ch in CASES:
        codes = [f"A{i + 1}" for i in range(n)]
        img = grid([glyph(c) for c in codes], per_row, cw, ch)
        buf = io.BytesIO()
        img.save(buf, "PNG")
        pngs.append(buf.getvalue())
        meta.append({"label": label, "codes": codes, "per_row": per_row,
                     "size": img.size, "bytes": len(buf.getvalue())})
        print(f"{label:34s} {img.size[0]:5d}x{img.size[1]:<5d} "
              f"宽高比 {img.size[0] / img.size[1]:5.1f}  {len(buf.getvalue()) // 1024:5d}KB")

    files = [{"name": f"shape-{i}.png", "is_ocr": True, "data_id": f"shape-{i}"}
             for i in range(len(pngs))]
    r = mineru._post(f"{mineru.V4}/file-urls/batch",
                     {"enable_formula": False, "enable_table": True,
                      "language": "en", "model_version": "vlm",
                      "no_cache": True, "files": files}, tok)
    if r.get("code") not in (0, "0"):
        raise SystemExit(f"submit failed: {redact(r)}")
    batch = r["data"]["batch_id"]
    for url, png in zip(r["data"]["file_urls"], pngs, strict=True):
        mineru._put_signed(url, png, {"Content-Length": str(len(png))})
    print(f"\n已提交 batch={batch}，轮询中…")

    t0 = time.time()
    while time.time() - t0 < 600:
        s = mineru._get(f"{mineru.V4}/extract-results/batch/{batch}", tok)
        res = s.get("data", {}).get("extract_result") or []
        if res and all(x.get("state") in ("done", "failed") for x in res):
            break
        print(f"  {time.time() - t0:5.1f}s  {[x.get('state') for x in res]}")
        time.sleep(2.0)

    by_id = {x.get("data_id"): x for x in res}
    out = []
    print()
    for i, m in enumerate(meta):
        x = by_id.get(f"shape-{i}", {})
        md = mineru._markdown_of(x) if x.get("state") == "done" else ""
        import re as _re
        got_codes = _re.findall(r"A[0-9]+", md)
        got = len(got_codes)
        missing = [c for c in m["codes"] if c not in set(got_codes)]
        print(f"=== {m['label']} ===")
        print(f"    {m['size'][0]}x{m['size'][1]}  期望 {len(m['codes'])} 个色号，"
              f"回来 {got} 个   state={x.get('state')} {x.get('err_msg', '')}")
        print(f"    漏掉 {len(missing)} 个" + (f"：{missing[:12]}" if missing else "")) 
        print(f"    是 HTML 表格: {'<table' in md}   原文前 160 字: {md[:160]!r}")
        out.append({**m, "state": x.get("state"), "markdown": md,
                    "found": got, "missing": missing})
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n记录写入 {OUT}")


if __name__ == "__main__":
    main()
