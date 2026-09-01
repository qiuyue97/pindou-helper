import { describe, expect, test } from 'vitest';
import { imageIndexOf, isSummaryRow, parseMdTable } from './mdTable';

/** Exactly what FastGPT's code node emits for a three-image run. */
const SAMPLE = `| 色号 | 图片1 | 图片2 | 图片3 |
| --- | --- | --- | --- |
| A3 |  |  | 105 |
| F10 | 216 | 174 | 69 |
| 色号数量 | 14 | 7 | 6 |
| 总豆数 | 2268 | 1200 | 900 |`;

describe('parseMdTable', () => {
  test('reads the header and every data row', () => {
    const t = parseMdTable(SAMPLE)!;
    expect(t.headers).toEqual(['色号', '图片1', '图片2', '图片3']);
    expect(t.rows).toHaveLength(4);
    expect(t.rows[0]).toEqual(['A3', '', '', '105']);
    expect(t.rows[1]).toEqual(['F10', '216', '174', '69']);
  });

  test('drops the --- rule line rather than treating it as data', () => {
    const t = parseMdTable(SAMPLE)!;
    expect(t.rows.some((r) => r[0] === '---')) .toBe(false);
  });

  test('pads a short row so it still lines up with the header', () => {
    const t = parseMdTable('| a | b | c |\n| --- | --- | --- |\n| 1 |')!;
    expect(t.rows[0]).toEqual(['1', '', '']);
  });

  test('ignores anything that is not a table row', () => {
    const t = parseMdTable('随便一句话\n| a | b |\n| --- | --- |\n| 1 | 2 |')!;
    expect(t.headers).toEqual(['a', 'b']);
    expect(t.rows).toEqual([['1', '2']]);
  });

  test('returns null when there is no table at all', () => {
    expect(parseMdTable('')).toBeNull();
    expect(parseMdTable('就是一段话')).toBeNull();
  });
});

describe('imageIndexOf', () => {
  test('maps 图片N to a zero-based index for the image endpoint', () => {
    expect(imageIndexOf('图片1')).toBe(0);
    expect(imageIndexOf('图片3')).toBe(2);
    expect(imageIndexOf(' 图片 2 ')).toBe(1);
  });

  test('leaves other headers alone', () => {
    expect(imageIndexOf('色号')).toBeNull();
    expect(imageIndexOf('图片')).toBeNull();
    expect(imageIndexOf('图片0')).toBeNull();
  });
});

describe('isSummaryRow', () => {
  test('recognises the two totals rows the code node appends', () => {
    expect(isSummaryRow(['色号数量', '14'])).toBe(true);
    expect(isSummaryRow(['总豆数', '2268'])).toBe(true);
  });

  test('a colour code is not a summary row', () => {
    expect(isSummaryRow(['A3', '105'])).toBe(false);
  });
});
