"""图片类型判定与"塞进内联预算"的压缩。

两件事，都只解决一个具体的线上故障：

1. 类型判定按内容而不是按文件名。FastGPT 上传时会嗅探内容，后缀与真实类型对不
   上就抛 UploadFileTypeMismatch 返回 500，而且它故意不帮忙静默改名。用户的图纸
   大量来自微信/QQ 转存，JPEG 被存成 .png 是常态。

2. 压到内联预算以内。走 Kimi 的那条链路上，LiteLLM 会把图片转成 base64 内联，
   上游对"一次请求内所有内联媒体的原始字节之和"卡 2 MiB，超了直接 400。

关于第 2 点的取舍，是量出来的，不是拍的（6 张真实图纸，全程不改分辨率）：

  无损 PNG 重压   6 张里 3 张就此过线，最好的一张 2.01M -> 0.24M，像素一个没变
  PNG-8 256 色    全部过线，但色差因图而异：颜色少的那几张 dE 均值 0.00-0.28，
                  照片感强的那张 dE 均值 1.22、p99 11.54
  JPEG            反效果：平涂色块加密集格线正是 DCT 最不擅长的，同一张图
                  q92 反而从 2.01M 涨到 5.77M，所以这条路根本不在阶梯里

阶梯到 PNG-8 为止。再超也不降分辨率——图纸的信息就在那些细小的色号文字上，
降采样是拿识别率换体积。超了就交给不受这个上限约束的模型（GPT 直接吃 URL）。

参照系：decode 那边两个不同色号在图上最近只差 dE00 2.67，所以 p99 越过 2.5 就
值得提醒——那个程度的量化足以把相邻色号搅在一起。
"""

from __future__ import annotations

import io
import logging
import mimetypes
import os
from dataclasses import dataclass, field

log = logging.getLogger("pindou.imaging")

# 一次请求内**所有内联图片之和**的上限，上游硬限制。
#
# "cumulative" 这个词在报错里容易被读成"单张"，但线上日志两次独立证实是累计：
# 一次 3 张的请求报 2,244,894，正好等于其中两张之和；一次 6 张的报 3,609,950，
# 正好等于前五张之和。报错里的 content[N] 是"累加到第 N 张时越线"的位置，不是
# 第 N 张自己超了。
INLINE_LIMIT = 2 * 1024 * 1024
# 量化后色差超过这个值就提醒：见模块开头关于 dE00 2.67 的说明
DE_WARN = 2.5

# 文件头 -> (后缀, MIME)，先匹配到的算数
_MAGIC: tuple[tuple[bytes, str, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", ".png", "image/png"),
    (b"\xff\xd8\xff", ".jpg", "image/jpeg"),
    (b"GIF87a", ".gif", "image/gif"),
    (b"GIF89a", ".gif", "image/gif"),
    (b"BM", ".bmp", "image/bmp"),
)


def sniff_image(data: bytes) -> tuple[str, str] | None:
    """从字节本身判断图片类型，返回 (后缀, MIME)；不认识就返回 None。"""
    for magic, ext, mime in _MAGIC:
        if data.startswith(magic):
            return ext, mime
    # WebP 是 RIFF 容器，类型标在第 8-12 字节
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp", "image/webp"
    return None


def normalise_name(filename: str, data: bytes) -> tuple[str, str]:
    """把文件名的后缀改成和内容一致，返回 (文件名, MIME)。

    认不出类型时保持原样，把判断交给服务端——这里的职责是消除"后缀在说谎"这一种
    情况，不是替服务端做格式白名单。
    """
    sniffed = sniff_image(data)
    if sniffed is None:
        return filename, mimetypes.guess_type(filename)[0] or "application/octet-stream"
    ext, mime = sniffed
    stem = os.path.splitext(filename or "")[0] or "image"
    return stem + ext, mime


@dataclass
class Fitted:
    """一张图压缩之后的样子，以及为压它付出了什么。"""

    data: bytes
    ext: str
    mime: str
    #: original | png-recompress | png8
    step: str
    #: 阶梯走完之后是否还超预算——超了就只能交给不吃内联的模型
    within_budget: bool
    de_mean: float = 0.0
    de_p99: float = 0.0
    #: 排查用的说明，只进日志。压缩做了什么是我们的实现细节，用户对着它做不了
    #: 任何决定——真要提醒的是"这张图没认出来"，那是 status 的事。
    notes: list[str] = field(default_factory=list)

    @property
    def size(self) -> int:
        return len(self.data)

    @property
    def lossless(self) -> bool:
        return self.step != "png8" or self.de_p99 == 0.0


def _png(im, **kw) -> bytes:
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True, compress_level=9, **kw)
    return buf.getvalue()


def _colour_shift(before, after, samples: int = 120_000) -> tuple[float, float]:
    """量化前后的 CIEDE2000 色差 (均值, p99)。

    最近邻缩小来抽样，而不是取平均缩小：平均会把量化误差抹平，测出来的损失就偏
    小了。抽样是因为 4096x6044 全图换算成 Lab 要 600 MB，而这里要的是"损失有多
    大"这个量级。
    """
    import numpy as np
    from PIL import Image

    # 和「图纸识别」共用同一套 Lab/CIEDE2000。两处各留一份副本的话，改了一处
    # 忘了另一处，压缩报出的色差和识别用的色差就会悄悄对不上。
    from app.colour import delta_e00, srgb_to_lab

    w, h = before.size
    k = max(1, int((w * h / samples) ** 0.5))
    size = (max(1, w // k), max(1, h // k))
    a = np.asarray(before.resize(size, Image.NEAREST).convert("RGB"), dtype=np.float64)
    b = np.asarray(after.resize(size, Image.NEAREST).convert("RGB"), dtype=np.float64)
    d = delta_e00(srgb_to_lab(a.reshape(-1, 3)), srgb_to_lab(b.reshape(-1, 3)))
    return float(d.mean()), float(np.percentile(d, 99))


def fit_inline(data: bytes, budget: int = INLINE_LIMIT) -> Fitted:
    """把一张图压进 budget，全程不改分辨率。

    走不到预算以内时不会降采样，而是 within_budget=False 交回给调用方——由它决定
    改喂哪个模型。这里宁可交出一张"太大但完整"的图，也不交一张"够小但字糊了"的。
    """
    ext, mime = sniff_image(data) or (".bin", "application/octet-stream")

    if len(data) <= budget:
        return Fitted(data, ext, mime, "original", True)

    try:
        from PIL import Image
    except ImportError:  # pragma: no cover - 部署漏装依赖时不该连原图都发不出去
        log.warning("没装 Pillow，图片无法压缩")
        return Fitted(data, ext, mime, "original", False, notes=["未安装 Pillow，无法压缩"])

    try:
        im = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception as exc:  # noqa: BLE001 - 解不开就原样交出去，让上游报错
        log.warning("图片解码失败，跳过压缩: %s", exc)
        return Fitted(data, ext, mime, "original", False, notes=["图片无法解码"])

    # 1. 无损重压：像素完全不变
    small = _png(im)
    if len(small) <= budget:
        return Fitted(small, ".png", "image/png", "png-recompress", True)

    # 2. 调色板：过线了，但要说清楚代价
    pal = im.quantize(colors=256, method=Image.MEDIANCUT, dither=Image.NONE)
    p8 = _png(pal)
    if len(p8) <= budget:
        mean, p99 = _colour_shift(im, pal)
        note = (f"压到 {budget / 1048576:.1f}MB 以内做了 256 色量化，"
                f"色差 dE 均值 {mean:.2f} p99 {p99:.1f}"
                + ("（超过 %.1f，只够读文字，不能拿来取色）" % DE_WARN
                   if p99 > DE_WARN else ""))
        (log.warning if p99 > DE_WARN else log.info)("%s", note)
        return Fitted(p8, ".png", "image/png", "png8", True, mean, p99, [note])

    # 3. 还超。不降分辨率，交给不吃内联的模型。
    best, step = min(((data, "original"), (small, "png-recompress"), (p8, "png8")),
                     key=lambda t: len(t[0]))
    return Fitted(
        best,
        ".png" if step != "original" else ext,
        "image/png" if step != "original" else mime,
        step,
        False,
        notes=[f"压到 {len(best) / 1048576:.1f}MB 仍超出 {budget / 1048576:.1f}MB 预算，"
               f"改用不受内联上限约束的模型"],
    )
