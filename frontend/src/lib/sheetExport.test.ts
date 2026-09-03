/**
 * 导出图纸的绘制。
 *
 * 画布内容测不了，但**画了什么**测得了：每个非空格子填一次色、印一次色号，
 * 网格线和标尺各画多少条，底部汇总有几项。这些正是「用户能不能照着拼」的全部依据。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  type ExportCell,
  type LegendEntry,
  drawSheet,
  inkOn,
  layout,
} from './sheetExport';

function cells(codes: (string | null)[]): ExportCell[] {
  return codes.map((c) => ({ code: c ?? '', hex: c ? '00FF00' : 'CCCCCC' }));
}

function ctxStub() {
  const texts: Array<{ text: string; x: number; y: number }> = [];
  const fills: string[] = [];
  /** 每次 stroke 时的画笔颜色。用来把背景斜纹和网格线分开数。 */
  const strokes: string[] = [];
  const ctx = {
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(() => strokes.push(String(ctx.strokeStyle))),
    // 背景斜纹要把自己裁在网格区域内
    save: vi.fn(),
    restore: vi.fn(),
    clip: vi.fn(),
    rect: vi.fn(),
    fillText: vi.fn((text: string, x: number, y: number) => texts.push({ text, x, y })),
    font: '',
    textAlign: '',
    textBaseline: '',
    strokeStyle: '',
    lineWidth: 0,
    texts,
    fills,
    strokes,
  } as unknown as CanvasRenderingContext2D & {
    texts: typeof texts;
    fills: string[];
    strokes: string[];
  };
  Object.defineProperty(ctx, 'fillStyle', {
    get: () => fills[fills.length - 1] ?? '',
    set: (v: string) => {
      fills.push(v);
    },
  });
  return ctx;
}

describe('layout', () => {
  it('留出四边标尺的位置', () => {
    const l = layout(10, 10, 3, { cell: 32, ruler: 26 });
    expect(l.width).toBe(10 * 32 + 26 * 2);
    expect(l.gridH).toBe(320);
  });

  it('大图纸缩格子而不是裁内容', () => {
    const l = layout(104, 104, 97, { cell: 32, ruler: 26, maxWidth: 1000 });
    expect(l.width).toBeLessThanOrEqual(1000);
    expect(l.cell).toBeLessThan(32);
    expect(l.gridW).toBe(104 * l.cell);
  });

  it('格子再小也留得下字', () => {
    const l = layout(400, 400, 10, { maxWidth: 1000 });
    expect(l.cell).toBeGreaterThanOrEqual(8);
  });

  it('底部汇总按图宽换行，高度跟着长', () => {
    const narrow = layout(10, 10, 40, { cell: 32, ruler: 26 });
    const wide = layout(10, 60, 40, { cell: 32, ruler: 26 });
    expect(narrow.legendRows).toBeGreaterThan(wide.legendRows);
    expect(narrow.height).toBeGreaterThan(narrow.legendTop);
  });
});

describe('inkOn', () => {
  it('浅底用黑字，深底用白字', () => {
    expect(inkOn('FFFFFF')).toBe('#111');
    expect(inkOn('000000')).toBe('#fff');
  });
});

describe('drawSheet', () => {
  const legend: LegendEntry[] = [{ code: 'H15', hex: '00FF00', count: 4 }];

  function draw(rows: number, cols: number, codes: (string | null)[], leg = legend) {
    const ctx = ctxStub();
    const lay = layout(rows, cols, leg.length, { cell: 32, ruler: 26 });
    drawSheet(ctx, { rows, cols, cells: cells(codes), legend: leg, layout: lay });
    return { ctx, lay };
  }

  it('每个非空格子填一次色、印一次色号', () => {
    const { ctx } = draw(2, 2, ['H15', 'H15', 'H15', 'H15']);
    const codeTexts = ctx.texts.filter((t) => t.text === 'H15');
    // 4 个格子 + 底部汇总里那一条
    expect(codeTexts).toHaveLength(5);
  });

  it('空格不填也不印', () => {
    const { ctx } = draw(2, 2, ['H15', null, null, null]);
    expect(ctx.texts.filter((t) => t.text === 'H15')).toHaveLength(2); // 1 格 + 汇总
  });

  it('字的颜色跟着底色走，不会白底白字', () => {
    const ctx = ctxStub();
    const lay = layout(1, 2, 0, { cell: 32, ruler: 26 });
    drawSheet(ctx, {
      rows: 1,
      cols: 2,
      cells: [
        { code: 'A1', hex: 'FFFFFF' },
        { code: 'B1', hex: '000000' },
      ],
      legend: [],
      layout: lay,
    });
    expect(ctx.fills).toContain('#111');
    expect(ctx.fills).toContain('#fff');
  });

  it('画出完整的网格线', () => {
    const { ctx } = draw(3, 4, Array(12).fill('H15'));
    // 竖线 cols+1、横线 rows+1，再加每 10 格的加粗线（这里各 1 条）。
    // 背景斜纹也在 stroke，按画笔颜色把它排除掉。
    const grid = ctx.strokes.filter((c) => !c.startsWith('rgba(0,0,0,0.0'));
    expect(grid).toHaveLength(4 + 1 + 3 + 1 + 1 + 1);
  });

  it('先铺背景斜纹，格子画在它上面', () => {
    // 白底上空格、调淡的格子、本来就接近白的豆子长得一模一样。斜纹给背景一点
    // 质感，被选中的色号于是成了画面上唯一平整实心的东西。
    const { ctx } = draw(3, 4, Array(12).fill('H15'));
    expect(ctx.clip).toHaveBeenCalled();
    const hatched = ctx.strokes.filter((c) => c.startsWith('rgba(0,0,0,0.0'));
    expect(hatched.length).toBeGreaterThan(0);
    // 斜纹全部画在格子之前
    const lastHatch = Math.max(
      ...(ctx.stroke as unknown as { mock: { invocationCallOrder: number[] } }).mock
        .invocationCallOrder.slice(0, hatched.length),
    );
    const firstCell = (
      ctx.fillRect as unknown as { mock: { invocationCallOrder: number[] } }
    ).mock.invocationCallOrder[1]!;
    expect(lastHatch).toBeLessThan(firstCell);
  });

  it('四边都有坐标标尺', () => {
    const { ctx, lay } = draw(2, 2, Array(4).fill('H15'));
    const ones = ctx.texts.filter((t) => t.text === '1');
    // 第 1 列上下各一个、第 1 行左右各一个
    expect(ones).toHaveLength(4);
    const xs = ones.map((t) => t.x);
    expect(Math.min(...xs)).toBeLessThan(lay.ruler);
    expect(Math.max(...xs)).toBeGreaterThan(lay.ruler + lay.gridW);
  });

  it('列多的时候标尺隔几格标一次，不糊成一片', () => {
    const { ctx } = draw(1, 100, Array(100).fill(null), []);
    const ticks = ctx.texts.map((t) => Number(t.text)).filter((n) => !Number.isNaN(n));
    // 100 列每 5 格标一次 = 20 个，上下两条边共 40；行只有 1 行，左右各 1
    expect(ticks.length).toBeLessThan(100);
  });

  it('底部汇总每项有色块、色号和数量', () => {
    const { ctx, lay } = draw(1, 1, ['H15'], [
      { code: 'H15', hex: '00FF00', count: 4 },
      { code: 'B8', hex: '0000FF', count: 7 },
    ]);
    expect(ctx.texts.some((t) => t.text === '4 颗')).toBe(true);
    expect(ctx.texts.some((t) => t.text === '7 颗')).toBe(true);
    // 汇总画在网格下方
    const summary = ctx.texts.find((t) => t.text === '7 颗')!;
    expect(summary.y).toBeGreaterThanOrEqual(lay.legendTop);
  });

  it('汇总为空时不画汇总，也不崩', () => {
    const { ctx } = draw(1, 1, ['H15'], []);
    expect(ctx.texts.some((t) => t.text.endsWith('颗'))).toBe(false);
  });
});
