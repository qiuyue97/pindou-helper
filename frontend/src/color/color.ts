export type RGB = [number, number, number];
export type Lab = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`invalid hex colour: ${JSON.stringify(hex)}`);
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function rgbToHex(rgb: RGB): string {
  return rgb
    .map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function srgbChannelToLinear(v255: number): number {
  const c = v255 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function rgbToXyz(rgb: RGB): [number, number, number] {
  const r = srgbChannelToLinear(rgb[0]);
  const g = srgbChannelToLinear(rgb[1]);
  const b = srgbChannelToLinear(rgb[2]);
  return [
    (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) * 100,
    (r * 0.2126729 + g * 0.7151522 + b * 0.072175) * 100,
    (r * 0.0193339 + g * 0.119192 + b * 0.9503041) * 100,
  ];
}

const Xn = 95.047;
const Yn = 100.0;
const Zn = 108.883;

function fLab(t: number): number {
  const d = 6 / 29;
  return t > d * d * d ? Math.cbrt(t) : t / (3 * d * d) + 4 / 29;
}

export function xyzToLab(xyz: [number, number, number]): Lab {
  const fx = fLab(xyz[0] / Xn);
  const fy = fLab(xyz[1] / Yn);
  const fz = fLab(xyz[2] / Zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function rgbToLab(rgb: RGB): Lab {
  return xyzToLab(rgbToXyz(rgb));
}

export function hexToLab(hex: string): Lab {
  return rgbToLab(hexToRgb(hex));
}

export function deltaE76(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const rad = (deg: number) => (deg * Math.PI) / 180;

function hueDegrees(b: number, aPrime: number): number {
  if (b === 0 && aPrime === 0) return 0;
  const h = (Math.atan2(b, aPrime) * 180) / Math.PI;
  return h >= 0 ? h : h + 360;
}

export function deltaE00(lab1: Lab, lab2: Lab): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const kL = 1;
  const kC = 1;
  const kH = 1;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const cBar = (C1 + C2) / 2;
  const cBar7 = Math.pow(cBar, 7);
  const G = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + Math.pow(25, 7))));

  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = hueDegrees(b1, a1p);
  const h2p = hueDegrees(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp: number;
  if (C1p * C2p === 0) dhp = 0;
  else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
  else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
  else dhp = h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2);

  const lBarp = (L1 + L2) / 2;
  const cBarp = (C1p + C2p) / 2;

  let hBarp: number;
  if (C1p * C2p === 0) hBarp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hBarp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hBarp = (h1p + h2p + 360) / 2;
  else hBarp = (h1p + h2p - 360) / 2;

  const T =
    1 -
    0.17 * Math.cos(rad(hBarp - 30)) +
    0.24 * Math.cos(rad(2 * hBarp)) +
    0.32 * Math.cos(rad(3 * hBarp + 6)) -
    0.2 * Math.cos(rad(4 * hBarp - 63));

  const dTheta = 30 * Math.exp(-Math.pow((hBarp - 275) / 25, 2));
  const cBarp7 = Math.pow(cBarp, 7);
  const Rc = 2 * Math.sqrt(cBarp7 / (cBarp7 + Math.pow(25, 7)));
  const Rt = -Rc * Math.sin(rad(2 * dTheta));

  const Sl = 1 + (0.015 * Math.pow(lBarp - 50, 2)) / Math.sqrt(20 + Math.pow(lBarp - 50, 2));
  const Sc = 1 + 0.045 * cBarp;
  const Sh = 1 + 0.015 * cBarp * T;

  const termL = dLp / (kL * Sl);
  const termC = dCp / (kC * Sc);
  const termH = dHp / (kH * Sh);

  return Math.sqrt(termL * termL + termC * termC + termH * termH + Rt * termC * termH);
}
