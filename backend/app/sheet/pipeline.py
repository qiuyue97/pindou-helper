"""编排。路由层唯一该 import 的模块。

三个入口：

  detect()     上传时跑，秒级以内，给用户一个初始框和吸附靶点
  analyse()    贵的那一半：采样、聚类、OCR。一张图只该跑一次
  finalise()   便宜的那一半：定案、交叉校验、对账。可以随先验反复调

**为什么要拆成 analyse / finalise。** 先验是并行跑的 AI 抽取给的，它比 CV 晚到。
如果只有一个 `recognise(prior=...)`，路由拿到先验后就只能整条重跑——那会**再发一次
MinerU 请求**，花第二份配额和钱，还要重新采样、重新聚类。界线画在「贵」和「便宜」
之间。

`analyse` **不抛异常表示识别失败**——识别不出来产出的是一张全红的矩阵，那是正常
产出。真正会抛的只有：图片解不开、几何参数不合法。
"""

import logging
from dataclasses import asdict, dataclass, field

import cv2
import numpy as np

from app.colour import load_palette
from app.sheet import mineru
from app.sheet.classes import (
    class_picture,
    class_stats,
    colour_classes,
    has_colour_structure,
)
from app.sheet.decide import decide
from app.sheet.lattice import Guess
from app.sheet.lattice import detect as _detect_lattice
from app.sheet.reconcile import reconcile
from app.sheet.sampling import build_glyphs, sample_cells

log = logging.getLogger("pindou.sheet")

#: 每类交给 OCR 的成员数。离类心最近的优先——那是这个色号 JPEG 损伤最轻的副本。
REPS = 5


@dataclass
class Geometry:
    rect: list[float]
    rows: int
    cols: int
    has_blanks: bool = False
    palette: str = "221"


@dataclass
class Analysis:
    """贵的那一半的产物：采样、聚类、OCR 都做完了，还没定案。"""

    labels: np.ndarray
    stats: list
    reads: list
    palette: object          # app.colour.Palette
    engine: str = "colour-only"
    structured: bool = True


@dataclass
class Recognition:
    labels: list[int] = field(default_factory=list)
    classes: list[dict] = field(default_factory=list)
    counts: list[dict] = field(default_factory=list)
    engine: str = ""
    structured: bool = True


def decode_image(data: bytes) -> np.ndarray:
    """字节 → BGR 数组。解不开抛 ValueError。"""
    im = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if im is None:
        raise ValueError("无法解码这张图片")
    return im


def detect(image: bytes) -> Guess | None:
    """初始猜测。找不到点阵返回 None——那是正常路径，用户自己拖框。"""
    return _detect_lattice(decode_image(image))


def _read_classes(pics, valid, token, timeout):
    """留一个接缝，方便测试替换整段 OCR。"""
    return mineru.read_classes(pics, valid, token=token, timeout=timeout)


def analyse(image: bytes, geom: Geometry, *, token: str = "",
            timeout: float = 600.0) -> Analysis:
    """贵的那一半：采样、聚类、OCR。一张图只该跑一次。"""
    im = decode_image(image)
    rows, cols = geom.rows, geom.cols
    if rows < 1 or cols < 1:
        raise ValueError("行列数必须为正")

    fill, inked = sample_cells(im, geom.rect, rows, cols)
    # 白豆和空格在像素上分不开，所以「这张图有空格子吗」只能由用户回答。
    # 他说没有，就把每一格都当作有豆子。
    live = inked if geom.has_blanks else np.ones_like(inked)
    labels, n = colour_classes(fill, live)
    palette = load_palette(geom.palette)

    structured = has_colour_structure(n, rows, cols)
    stats = [class_stats(fill, labels, k) for k in range(n)]

    reads: list[str | None] = [None] * n
    engine = "colour-only"
    if structured and token and n:
        # 墨迹图只在这里才需要——放在结构判定之后，没有结构的图完全不必付这份代价
        ink = build_glyphs(im, fill, geom.rect, rows, cols)
        pics = [class_picture(ink, st.order) for st in stats]
        got, info = _read_classes(pics, set(palette.codes), token, timeout)
        if got is not None:
            reads = got
            engine = f"mineru/{info.get('model', 'vlm')}"
        else:
            log.info("MinerU 放弃（%s），整张走颜色兜底", info.get("error"))
    elif not structured:
        log.info("这张图没有颜色结构：%d 格分出 %d 类，跳过 OCR", rows * cols, n)

    return Analysis(labels=labels, stats=stats, reads=reads, palette=palette,
                    engine=engine, structured=bool(structured))


def finalise(an: Analysis, prior: dict | None = None) -> Recognition:
    """便宜的那一半：定案、颜色交叉校验、颜色兜底、与先验对账。

    纯计算，没有 I/O，可以随先验反复调——用户每改一次基准数量都要重来一遍。
    """
    records = decide(an.stats, an.reads, an.palette, prior=prior)
    counts = reconcile(records, prior)
    return Recognition(
        labels=[int(v) for v in an.labels],
        classes=[r.as_dict() for r in records],
        counts=[asdict(c) for c in counts],
        engine=an.engine, structured=an.structured,
    )


def recognise(image: bytes, geom: Geometry, *, prior: dict | None = None,
              token: str = "", timeout: float = 600.0) -> Recognition:
    """一张图纸 → 每格的色号 + 每类的把握程度。

    先验在调用前就拿到了才用这个。先验要和 CV 并行取的话，分别调 analyse 和
    finalise——否则整条重跑会再发一次 MinerU 请求。
    """
    return finalise(analyse(image, geom, token=token, timeout=timeout), prior)
