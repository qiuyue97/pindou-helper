/**
 * 分组与排序。
 *
 * 一个色号名下有多个类是**常态**：颜色的切口故意很紧，把一个色号裂成两三类是
 * 设计出来的预期结果。两个类独立读出同一个色号是一致的证据，不是可疑信号——
 * 相信 OCR，合并成一行。
 *
 * 唯一的例外是这些类彼此颜色差得远（dup 有值），那时它们不可能是同一个色号。
 */
import { describe, expect, it } from 'vitest';
import type { SheetClass } from '../api/types';
import { byCode, codeKey, groupByCode } from './sheetSort';

function cls(p: Partial<SheetClass> & { klass: number; code: string }): SheetClass {
  return {
    source: 'ocr',
    level: 'ok',
    de: 0.5,
    n: 10,
    radius: 1,
    rgb: [1, 2, 3],
    nearest: p.code,
    nearest_de: 0.5,
    read_full: p.code,
    off_list: false,
    dup: null,
    cells: [],
    ...p,
  };
}

describe('codeKey / byCode', () => {
  it('先系列，再序号升序', () => {
    expect(codeKey('A10')).toEqual(['A', 10, '']);
    expect(codeKey('H15')).toEqual(['H', 15, '']);
  });

  it('A10 排在 A2 后面，不是按字符串排', () => {
    expect(['A10', 'A2', 'A1'].sort(byCode)).toEqual(['A1', 'A2', 'A10']);
  });

  it('系列优先于序号', () => {
    expect(['B1', 'A99'].sort(byCode)).toEqual(['A99', 'B1']);
  });

  it('多字母系列按整个前缀分组', () => {
    expect(['ZG1', 'A1', 'Z1'].sort(byCode)).toEqual(['A1', 'Z1', 'ZG1']);
  });

  it('没有序号的色号也不会崩', () => {
    expect(['X', 'A1'].sort(byCode)).toEqual(['A1', 'X']);
  });
});

describe('groupByCode', () => {
  it('同一色号的多个类合并成一组，数量求和', () => {
    const g = groupByCode([
      cls({ klass: 0, code: 'H15', n: 20 }),
      cls({ klass: 1, code: 'H15', n: 14 }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.n).toBe(34);
    expect(g[0]!.classes.map((c) => c.klass)).toEqual([0, 1]);
  });

  it('合并组取名下最严重的级别', () => {
    const g = groupByCode([
      cls({ klass: 0, code: 'H15', level: 'ok' }),
      cls({ klass: 1, code: 'H15', level: 'guess' }),
    ]);
    expect(g[0]!.level).toBe('guess');
  });

  it('告警优先：红 → 紫 → 橙 → 绿', () => {
    const g = groupByCode([
      cls({ klass: 0, code: 'A1', level: 'ok' }),
      cls({ klass: 1, code: 'B1', level: 'warn' }),
      cls({ klass: 2, code: 'C1', level: 'guess' }),
      cls({ klass: 3, code: 'D1', level: 'count' }),
    ]);
    expect(g.map((x) => x.code)).toEqual(['C1', 'D1', 'B1', 'A1']);
  });

  it('同级别内按色号顺序', () => {
    const g = groupByCode([cls({ klass: 0, code: 'A10' }), cls({ klass: 1, code: 'A2' })]);
    expect(g.map((x) => x.code)).toEqual(['A2', 'A10']);
  });

  it('颜色差得远的同码多类带出 spread', () => {
    const g = groupByCode([
      cls({ klass: 0, code: 'H15', dup: 9.4 }),
      cls({ klass: 1, code: 'H15', dup: 9.4 }),
    ]);
    expect(g[0]!.spread).toBe(9.4);
  });

  it('颜色接近的同码多类没有 spread——那是预期结果，不该报警', () => {
    const g = groupByCode([cls({ klass: 0, code: 'H15' }), cls({ klass: 1, code: 'H15' })]);
    expect(g[0]!.spread).toBeNull();
  });

  it('名下所有类的格子合并并排好序', () => {
    const g = groupByCode([
      cls({ klass: 0, code: 'H15', cells: [5, 1] }),
      cls({ klass: 1, code: 'H15', cells: [3] }),
    ]);
    expect(g[0]!.cells).toEqual([1, 3, 5]);
  });
});
