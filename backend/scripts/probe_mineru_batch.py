"""真的打一次 MinerU 多图批次接口，把返回结构原样记下来。

存在的理由：多图批次的响应长什么样**没法预测**。拿自己编的 mock 去测自己的代码，
只能证明代码和想象一致，证明不了它和服务端一致——这个项目在盲网格那件事上已经
栽过一次同样的跟头（带标注的图喂给 OCR 拿满分，读的是我们自己写的字）。

会真的消耗配额，所以不进测试套件，只在需要确认接口形状时手动跑。

    MINERU_TOKEN=... python scripts/probe_mineru_batch.py
    # 或者把 token 写进 ~/.mineru_token

输出落在 scripts/_mineru_probe.json，签名 URL 一律截断，不往外抛凭据。
"""

import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np

from app.sheet import mineru
from app.sheet.blindgrid import blind_grid, columns_for

OUT = Path(__file__).with_name("_mineru_probe.json")


def token() -> str:
    t = os.environ.get("MINERU_TOKEN", "").strip()
    if t:
        return t
    f = Path.home() / ".mineru_token"
    if f.is_file():
        return f.read_text(encoding="utf-8").strip()
    raise SystemExit("没有 token：设 MINERU_TOKEN，或写进 ~/.mineru_token")


def glyph(text: str, w: int = 60, h: int = 30) -> np.ndarray:
    """一块写着 text 的墨迹图，和 pipeline 里喂给盲网格的东西同构（0=底，高=墨）。"""
    import cv2

    # putText 只吃 uint8（cv2 5.0 会直接断言失败），画完再转成 pipeline 用的 float
    img = np.zeros((h, w), np.uint8)
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
    cv2.putText(img, text, ((w - tw) // 2, (h + th) // 2),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, 255, 2, cv2.LINE_AA)
    return img.astype(np.float32)


def redact(obj):
    """签名 URL 里带凭据，只留主机和路径头，别把它写进文件或打到屏幕上。"""
    if isinstance(obj, dict):
        return {k: redact(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [redact(v) for v in obj]
    if isinstance(obj, str) and obj.startswith("http") and len(obj) > 80:
        return obj.split("?")[0] + "?<已截断>"
    return obj


def main() -> None:
    tok = token()

    # 两页，各自内容不同且可辨认——这样既能看返回结构，也能看出页有没有错位。
    codes_a = [f"A{i + 1}" for i in range(32)]
    codes_b = ["M3", "C6", "H15"]                            # 1 行，明显不同
    pages_codes = [codes_a, codes_b]
    pngs = []
    for codes in pages_codes:
        import io

        buf = io.BytesIO()
        blind_grid([glyph(c) for c in codes]).save(buf, "PNG")
        pngs.append(buf.getvalue())
    print(f"两页：{len(codes_a)} 块 / {len(codes_b)} 块，"
          f"{[len(p) for p in pngs]} 字节")

    files = [{"name": f"page-{i}.png", "is_ocr": True, "data_id": f"page-{i}"}
             for i in range(len(pngs))]
    body = {"enable_formula": False, "enable_table": True, "language": "en",
            "model_version": "vlm", "no_cache": True, "files": files}

    print("\n=== 1. 申请上传地址 ===")
    r = mineru._post(f"{mineru.V4}/file-urls/batch", body, tok)
    print(json.dumps(redact(r), ensure_ascii=False, indent=2)[:1200])
    batch = r["data"]["batch_id"]
    urls = r["data"]["file_urls"]
    print(f"batch_id={batch}  拿到 {len(urls)} 个上传地址（提交了 {len(pngs)} 个文件）")

    print("\n=== 2. 上传 ===")
    for i, (url, png) in enumerate(zip(urls, pngs, strict=True)):
        mineru._put_signed(url, png, {"Content-Length": str(len(png))})
        print(f"  page-{i} 上传完成")

    print("\n=== 3. 轮询 ===")
    snapshots = []
    t0 = time.time()
    while time.time() - t0 < 600:
        s = mineru._get(f"{mineru.V4}/extract-results/batch/{batch}", tok)
        snapshots.append({"t": round(time.time() - t0, 1), "raw": redact(s)})
        results = s.get("data", {}).get("extract_result") or []
        states = [x.get("state") for x in results]
        print(f"  {time.time() - t0:5.1f}s  {len(results)} 条结果  states={states}")
        if results and all(x.get("state") in ("done", "failed") for x in results):
            break
        time.sleep(2.0)

    final = snapshots[-1]["raw"]
    print("\n=== 4. 最终响应（结构就是这一段，据此写解析）===")
    print(json.dumps(final, ensure_ascii=False, indent=2)[:4000])

    print("\n=== 5. 每条结果有哪些字段 ===")
    for i, res in enumerate(final.get("data", {}).get("extract_result") or []):
        print(f"  [{i}] keys = {sorted(res)}")

    print("\n=== 6. 各页解出来的表 ===")
    texts = []
    for i, res in enumerate(s.get("data", {}).get("extract_result") or []):
        if res.get("state") != "done":
            print(f"  [{i}] state={res.get('state')}，跳过")
            continue
        md = mineru._markdown_of(res)
        texts.append({"index": i, "data_id": res.get("data_id"),
                      "file_name": res.get("file_name"), "markdown": md})
        cells, why = mineru.table_cells(md, columns_for(32), 1)
        print(f"  [{i}] data_id={res.get('data_id')!r} "
              f"file_name={res.get('file_name')!r}")
        print(f"       表解析: {why}")
        print(f"       前 20 格: {(cells or [])[:20]}")

    OUT.write_text(json.dumps(
        {"submitted": [f["data_id"] for f in files],
         "page_contents": pages_codes,
         "snapshots": snapshots, "texts": texts},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n全部记录写入 {OUT}")


if __name__ == "__main__":
    main()
