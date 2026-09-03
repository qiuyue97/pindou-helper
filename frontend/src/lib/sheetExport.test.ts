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
  dimHex,
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
  const alphas: number[] = [];
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
    alphas,
  } as unknown as CanvasRenderingContext2D & {
    texts: typeof texts;
    fills: string[];
    strokes: string[];
    alphas: number[];
  };
  Object.defineProperty(ctx, 'globalAlpha', {
    get: () => alphas[alphas.length - 1] ?? 1,
    set: (v: number) => {
      alphas.push(v);
    },
  });
  Object.defineProperty(ctx, 'fillStyle', {
    get: () => fills[fills.length - 1] ?? '',
    set: (v: string) => {
      fills.push(v);
    },
  });
  return ctx;
}

describe('layout', () => {
  it('只有最外一圈逐格坐标（占一格宽），没有中间的粗刻度', () => {
    const l = layout(10, 10, 3, { cell: 32 });
    expect(l.ring).toBe(32);
    expect(l.pad).toBe(32); // 外圈就是全部，没有额外的标尺带
    expect(l.width).toBe((10 + 2) * 32);
    expect(l.gridH).toBe(320);
  });

  it('大图纸缩格子而不是裁内容', () => {
    const l = layout(104, 104, 97, { cell: 32, maxWidth: 1000 });
    expect(l.width).toBeLessThanOrEqual(1000);
    expect(l.cell).toBeLessThan(32);
    expect(l.gridW).toBe(104 * l.cell);
  });

  it('格子再小也留得下字', () => {
    const l = layout(400, 400, 10, { maxWidth: 1000 });
    expect(l.cell).toBeGreaterThanOrEqual(8);
  });

  it('底部汇总按图宽换行，高度跟着长', () => {
    const narrow = layout(10, 10, 40, { cell: 32 });
    const wide = layout(10, 60, 40, { cell: 32 });
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

describe('dimHex', () => {
  const ch = (hex: string, i: number) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);

  it('只降明度，颜色不动——变灰不等于变暗', () => {
    // 三个通道同乘一个倍率：HSV 里只有 V 变了，色相和饱和度原样
    const red = dimHex('FF0000');
    expect(ch(red, 0)).toBeGreaterThan(0);
    expect(ch(red, 1)).toBe(0);
    expect(ch(red, 2)).toBe(0);
  });

  it('通道之间的比例不变，所以色相不漂', () => {
    const c = dimHex('CC6633');
    expect(ch(c, 0) / ch(c, 1)).toBeCloseTo(0xcc / 0x66, 1);
    expect(ch(c, 1) / ch(c, 2)).toBeCloseTo(0x66 / 0x33, 1);
  });

  it('调淡只压一点点亮度——0.9/0.1 是拉滑杆试出来的，主要靠满色和格内色号立起来', () => {
    // 之前压得很狠（>60 级），实际拉下来发现太重；现在几乎只留一层影子
    const drop = 255 - ch(dimHex('FFFFFF'), 0);
    expect(drop).toBeGreaterThan(0);
    expect(drop).toBeLessThan(40);
  });

  it('亮度顺序保留下来，图形轮廓还看得出', () => {
    expect(ch(dimHex('202020'), 0)).toBeLessThan(ch(dimHex('E0E0E0'), 0));
  });
});

describe('drawSheet', () => {
  const legend: LegendEntry[] = [{ code: 'H15', hex: '00FF00', count: 4 }];

  function draw(rows: number, cols: number, codes: (string | null)[], leg = legend) {
    const ctx = ctxStub();
    const lay = layout(rows, cols, leg.length, { cell: 32 });
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
    const lay = layout(1, 2, 0, { cell: 32 });
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

  it('最外一圈逐格标号，最大值落在左上和右下', () => {
    const { ctx, lay } = draw(6, 8, Array(48).fill('H15'));
    // 上边降序：最左那格是 cols(8)；下边升序：最右那格是 cols(8)
    // 左边降序：最上那格是 rows(6)；右边升序：最下那格是 rows(6)
    const topLeftMost = ctx.texts
      .filter((t) => t.y < lay.pad && t.x < lay.pad + lay.cell)
      .map((t) => Number(t.text));
    expect(topLeftMost).toContain(8);

    const bottomRightMost = ctx.texts
      .filter((t) => t.y > lay.pad + lay.gridH && t.x > lay.pad + lay.gridW - lay.cell)
      .map((t) => Number(t.text));
    expect(bottomRightMost).toContain(8);
  });

  it('外圈每一格都有号（100 列 -> 上下各 100 个），没有别的刻度', () => {
    const { ctx } = draw(1, 100, Array(100).fill(null), []);
    const ticks = ctx.texts.map((t) => Number(t.text)).filter((n) => !Number.isNaN(n));
    // 上下各 100 + 左右各 1 = 202，一个不多一个不少
    expect(ticks.length).toBe(202);
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

  // ---------- 突出显示 ----------

  it('没选色号时一切照常', () => {
    const ctx = ctxStub();
    const lay = layout(1, 2, 0, { cell: 32 });
    drawSheet(ctx, {
      rows: 1,
      cols: 2,
      cells: [
        { code: 'A1', hex: 'FF0000' },
        { code: 'B1', hex: '0000FF' },
      ],
      legend: [],
      layout: lay,
    });
    expect(ctx.fills).toContain('#FF0000');
    expect(ctx.fills).toContain('#0000FF');
  });

  it('没选中的格子既调暗、又叠透明——两步缺一不可', () => {
    const ctx = ctxStub();
    const lay = layout(1, 2, 0, { cell: 32 });
    drawSheet(ctx, {
      rows: 1,
      cols: 2,
      cells: [
        { code: 'A1', hex: 'FF0000' },
        { code: 'B1', hex: '0000FF' },
      ],
      legend: [],
      layout: lay,
      focus: new Set(['A1']),
    });
    expect(ctx.fills).toContain('#FF0000');
    expect(ctx.fills).not.toContain('#0000FF');
    // 先调暗
    expect(ctx.fills).toContain(`#${dimHex('0000FF')}`);
    // 再叠透明：只调暗的话，整片深色照样抢戏
    expect(ctx.alphas.some((a) => a < 1)).toBe(true);
    // 选中的那一格是全不透明的
    expect(ctx.alphas[ctx.alphas.length - 1]).toBe(1);
  });

  it('没选中的格子不印色号——满屏灰字比颜色还抢眼', () => {
    const ctx = ctxStub();
    const lay = layout(1, 2, 0, { cell: 32 });
    drawSheet(ctx, {
      rows: 1,
      cols: 2,
      cells: [
        { code: 'A1', hex: 'FF0000' },
        { code: 'B1', hex: '0000FF' },
      ],
      legend: [],
      layout: lay,
      focus: new Set(['A1']),
    });
    expect(ctx.texts.some((t) => t.text === 'A1')).toBe(true);
    expect(ctx.texts.some((t) => t.text === 'B1')).toBe(false);
  });
});
