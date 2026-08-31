import baseData from '../data/catalog.json';
import { hexToRgb, rgbToLab, type RGB, type Lab } from './color';

export interface BaseColor {
  code: string;
  series: string;
  hex: string;
}

export interface UserColor {
  code: string;
  hex: string;
  source: 'override' | 'custom';
  base_hex?: string;
}

export interface EffectiveColor {
  code: string;
  series: string;
  hex: string;
  rgb: RGB;
  lab: Lab;
  source: 'base' | 'override' | 'custom';
}

export function loadBaseCatalog(): BaseColor[] {
  return (baseData as BaseColor[]).map((c) => ({ ...c }));
}

export function seriesOf(code: string): string {
  const m = code.trim().match(/^[A-Za-z]+/);
  return m ? m[0].toUpperCase() : '自定义';
}

function toEffective(
  code: string,
  series: string,
  hex: string,
  source: EffectiveColor['source'],
): EffectiveColor {
  const rgb = hexToRgb(hex);
  return { code, series, hex: hex.toUpperCase(), rgb, lab: rgbToLab(rgb), source };
}

export function buildEffectiveCatalog(base: BaseColor[], userColors: UserColor[]): EffectiveColor[] {
  const overrides = new Map<string, string>();
  const customs: UserColor[] = [];
  const baseCodes = new Set(base.map((c) => c.code));

  for (const uc of userColors) {
    if (baseCodes.has(uc.code)) overrides.set(uc.code, uc.hex);
    else customs.push(uc);
  }

  const result: EffectiveColor[] = base.map((c) => {
    const overrideHex = overrides.get(c.code);
    return overrideHex
      ? toEffective(c.code, c.series, overrideHex, 'override')
      : toEffective(c.code, c.series, c.hex, 'base');
  });

  for (const uc of customs) {
    result.push(toEffective(uc.code, seriesOf(uc.code), uc.hex, 'custom'));
  }

  return result;
}
