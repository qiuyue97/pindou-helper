import { hexToLab } from '../color/color';

/**
 * Which text colour stays readable on a given block.
 * Uses CIELAB L* rather than naive RGB brightness, so mid-tone saturated
 * colours (which fool a plain luma test) land on the right side.
 */
export function swatchTextColor(hex: string): 'dark' | 'light' {
  return hexToLab(hex)[0] > 60 ? 'dark' : 'light';
}
