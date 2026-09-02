"""拿真实图纸走完整条 pipeline，打真实 MinerU 接口，报识别率。

前面两个探针用的是合成字形（干净、清晰）。真实的类中位图来自被 JPEG 压过的图纸，
21 px 高、边缘发糊——**几何改动会不会伤到真实字形的识别率，只有这样才测得出来**。

IMG_8422/8423/8425 有人工确认的网格，而且早先用 10 列的旧几何测到过
99.83% / 100% / 44 个色号全对，是能对照的基准。

会真的消耗配额，手动跑。

    MINERU_TOKEN=... python scripts/probe_real_sheet.py [图纸名...]
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cv2
import numpy as np

from app.colour import load_palette
from app.sheet import pipeline
from app.sheet.blindgrid import columns_for, dedupe, pages
from scripts.probe_mineru_batch import token

GRIDS = Path(r"D:/wlh/code/fastgpt_code_sandbox_self/图纸切分/grids.json")
PRIORS = GRIDS.with_name("priors.json")
DIRS = [GRIDS.parent.parent / "images", GRIDS.parent.parent / "test_images"]
DEFAULT = ["IMG_8422", "IMG_8423", "IMG_8425"]


def find(name):
    for d in DIRS:
        for ext in (".jpg", ".jpeg", ".png", ".bmp", ".webp"):
            p = d / (name + ext)
            if p.is_file():
                return p
    return None


def main() -> None:
    tok = token()
    names = sys.argv[1:] or DEFAULT
    grids = json.loads(GRIDS.read_text(encoding="utf-8"))
    report = []

    for name in names:
        meta, path = grids.get(name), find(name)
        if not meta or path is None:
            print(f"{name}: 没有确认过的网格或找不到图，跳过")
            continue
        geom = pipeline.Geometry(rect=meta["rect"], rows=meta["rows"],
                                 cols=meta["cols"],
                                 has_blanks=meta["has_blanks"], palette="221")
        data = path.read_bytes()

        t0 = time.time()
        an = pipeline.analyse(data, geom, token=tok)
        dt = time.time() - t0

        # 复原这次实际送出去的分页形状，好把它记进报告
        im = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        from app.sheet.classes import class_picture
        from app.sheet.sampling import build_glyphs, sample_cells
        fill, _ = sample_cells(im, geom.rect, geom.rows, geom.cols)
        ink = build_glyphs(im, fill, geom.rect, geom.rows, geom.cols)
        pics = [class_picture(ink, st.order) for st in an.stats]
        tiles, _ = dedupe(pics)
        shape = [(len(c), columns_for(len(c))) for c in pages(tiles)]

        priors = json.loads(PRIORS.read_text(encoding="utf-8")) if PRIORS.is_file() else {}
        prior = priors.get(name)

        read = sum(1 for r in an.reads if r)
        pal = set(load_palette("221").codes)
        illegal = [r for r in an.reads if r and r not in pal]
        res = pipeline.finalise(an, prior)
        levels = {}
        for c in res.classes:
            levels[c["level"]] = levels.get(c["level"], 0) + 1
        cells_ok = sum(c["n"] for c in res.classes if c["level"] == "ok")
        total = geom.rows * geom.cols

        print(f"\n===== {name}  {geom.rows}x{geom.cols} =====")
        print(f"  引擎 {an.engine}   耗时 {dt:.1f}s")
        print(f"  {len(an.stats)} 个颜色类 -> {len(tiles)} 块瓦片 -> "
              f"{len(shape)} 页 {shape}")
        print(f"  读出色号的类: {read}/{len(an.reads)}"
              f"   非法色号: {len(illegal)}")
        print(f"  级别分布: {levels}")
        print(f"  绿色(ok)格子占比: {cells_ok}/{total} = {cells_ok / total:.2%}")

        acc = None
        if prior:
            tally = {}
            for c in res.classes:
                tally[c["code"]] = tally.get(c["code"], 0) + c["n"]
            same = [k for k in prior if tally.get(k) == prior[k]]
            wrong = {k: (prior[k], tally.get(k, 0)) for k in prior
                     if tally.get(k) != prior[k]}
            extra = {k: v for k, v in tally.items() if k not in prior}
            hit = sum(min(prior[k], tally.get(k, 0)) for k in prior)
            acc = hit / total
            print(f"  【对图例真值】{len(same)}/{len(prior)} 个色号数量完全吻合，"
                  f"逐格上限准确率 {hit}/{total} = {acc:.2%}")
            if wrong:
                items = list(wrong.items())[:8]
                print("    数量不符(真值->本图): "
                      + ", ".join(f"{k} {a}->{b}" for k, (a, b) in items)
                      + (f" …共 {len(wrong)} 个" if len(wrong) > 8 else ""))
            if extra:
                print(f"    图例里没有的色号: {list(extra)[:8]}")
        report.append({"name": name, "engine": an.engine, "seconds": round(dt, 1),
                       "classes": len(an.stats), "tiles": len(tiles),
                       "pages": shape, "read": read, "illegal": illegal,
                       "levels": levels, "ok_cells": cells_ok, "total": total,
                       "accuracy": acc})

    Path(__file__).with_name("_real_sheet.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n记录写入 scripts/_real_sheet.json")


if __name__ == "__main__":
    main()
