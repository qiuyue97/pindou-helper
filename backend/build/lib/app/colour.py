"""sRGB → CIELAB(D65) 与 CIEDE2000，以及色卡加载。

和前端 `src/color/color.ts` 是同一套变换——两边算出不同的色差会让「配色」和
「图纸识别」对同一对颜色给出不同结论，那是最难查的一类 bug。

全部向量化：一万格逐个算 dE00 在 NAS 上要几十秒，广播版本是毫秒级。
"""

from dataclasses import dataclass

import numpy as np

from app.catalog import BASE, SERIES_221

_M = np.array([[0.4124564, 0.3575761, 0.1804375],
               [0.2126729, 0.7151522, 0.0721750],
               [0.0193339, 0.1191920, 0.9503041]])
_WP = np.array([95.047, 100.0, 108.883])


def srgb_to_lab(rgb):
    """sRGB (0-255) → CIELAB, D65。末维必须是 3，前面的维度随意。"""
    c = np.asarray(rgb, float) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    xyz = lin @ _M.T * 100.0
    t = xyz / _WP
    d = 6 / 29
    f = np.where(t > d ** 3, np.cbrt(t), t / (3 * d * d) + 4 / 29)
    return np.stack([116 * f[..., 1] - 16,
                     500 * (f[..., 0] - f[..., 1]),
                     200 * (f[..., 1] - f[..., 2])], axis=-1)


def delta_e00(lab1, lab2):
    """CIEDE2000。两个参数按 numpy 规则广播。"""
    lab1, lab2 = np.asarray(lab1, float), np.asarray(lab2, float)
    L1, a1, b1 = lab1[..., 0], lab1[..., 1], lab1[..., 2]
    L2, a2, b2 = lab2[..., 0], lab2[..., 1], lab2[..., 2]
    C1, C2 = np.hypot(a1, b1), np.hypot(a2, b2)
    Cbar = (C1 + C2) / 2
    G = 0.5 * (1 - np.sqrt(Cbar ** 7 / (Cbar ** 7 + 25.0 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = np.hypot(a1p, b1), np.hypot(a2p, b2)

    def hue(b, ap):
        h = np.degrees(np.arctan2(b, ap))
        h = np.where(h < 0, h + 360, h)
        return np.where((b == 0) & (ap == 0), 0.0, h)

    h1p, h2p = hue(b1, a1p), hue(b2, a2p)
    zero = (C1p * C2p) == 0

    dh = h2p - h1p
    dh = np.where(dh > 180, dh - 360, np.where(dh < -180, dh + 360, dh))
    dhp = np.where(zero, 0.0, dh)
    dLp, dCp = L2 - L1, C2p - C1p
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(np.radians(dhp) / 2)

    Lbar, Cbarp = (L1 + L2) / 2, (C1p + C2p) / 2
    hsum, hdiff = h1p + h2p, np.abs(h1p - h2p)
    hbar = np.where(zero, hsum,
                    np.where(hdiff <= 180, hsum / 2,
                             np.where(hsum < 360, (hsum + 360) / 2,
                                      (hsum - 360) / 2)))
    T = (1 - 0.17 * np.cos(np.radians(hbar - 30))
         + 0.24 * np.cos(np.radians(2 * hbar))
         + 0.32 * np.cos(np.radians(3 * hbar + 6))
         - 0.20 * np.cos(np.radians(4 * hbar - 63)))
    dtheta = 30 * np.exp(-(((hbar - 275) / 25) ** 2))
    Rc = 2 * np.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25.0 ** 7))
    Sl = 1 + (0.015 * (Lbar - 50) ** 2) / np.sqrt(20 + (Lbar - 50) ** 2)
    Sc = 1 + 0.045 * Cbarp
    Sh = 1 + 0.015 * Cbarp * T
    Rt = -np.sin(np.radians(2 * dtheta)) * Rc
    tL, tC, tH = dLp / Sl, dCp / Sc, dHp / Sh
    return np.sqrt(tL ** 2 + tC ** 2 + tH ** 2 + Rt * tC * tH)


@dataclass(frozen=True)
class Palette:
    """一本色卡。三个数组的第 k 项永远指同一个色号。"""

    codes: list[str]
    rgb: np.ndarray   # (N, 3) float, 0-255
    lab: np.ndarray   # (N, 3)


def load_palette(candidate_set: str = "221") -> Palette:
    """按 221 / 291 取一本色卡。

    用 BASE 的原始色值，**不套用「我的色卡」的 override 和自定义色**：图纸是第三方
    生成器按标准色卡印的，拿用户自己量出来的豆子色去反推印刷色只会引入偏差。
    """
    if candidate_set not in ("221", "291"):
        raise ValueError(f"未知的色卡范围: {candidate_set}")
    rows = [c for c in BASE
            if candidate_set == "291" or c["series"] in SERIES_221]
    rgb = np.array([[int(c["hex"][i:i + 2], 16) for i in (0, 2, 4)] for c in rows],
                   float)
    return Palette([c["code"] for c in rows], rgb, srgb_to_lab(rgb))
