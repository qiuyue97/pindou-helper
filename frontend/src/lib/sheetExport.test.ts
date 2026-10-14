/**
 * 导出图纸的绘制。
 *
 * 画布内容测不了，但**画了什么**测得了：每个非空格子填一次色、印一次色号，
 * 网格线和标尺各画多少条，底部汇总有几项。这些正是「用户能不能照着拼」的全部依据。
 */
import { describe, expect, it, vi } from 'vitest';
import { BLANK_CODE } from './sheetSort';
import {
  type ExportCell,
  type LegendEntry,
  type RingView,
  codeFont,
  dimHex,
  drawRingOverlay,
  drawSheet,
  inkOn,
  layout,
  sheetToDrawing,
} from './sheetExport';

function cells(codes: (string | null)[]): ExportCell[] {
  return codes.map((c) => ({ code: c ?? '', hex: c ? '00FF00' : 'CCCCCC' }));
}

function ctxStub() {
  /** 印字那一刻的字色（fill）和透明度（alpha）也记下来。 */
  const texts: Array<{ text: string; x: number; y: number; fill: string; alpha: number }> = [];
  const fills: string[] = [];
  /** 每次 stroke 时的画笔颜色。用来把背景斜纹和网格线分开数。 */
  const strokes: string[] = [];
  const alphas: number[] = [];
  /** 每次 stroke 时的虚线设置。空数组 = 实线。 */
  const dashes: number[][] = [];
  let dash: number[] = [];
  const ctx = {
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(() => {
      strokes.push(String(ctx.strokeStyle));
      dashes.push(dash);
    }),
    setLineDash: vi.fn((d: number[]) => {
      dash = [...d];
    }),
    // 背景斜纹要把自己裁在网格区域内
    save: vi.fn(),
    restore: vi.fn(),
    clip: vi.fn(),
    rect: vi.fn(),
    fillText: vi.fn((text: string, x: number, y: number) =>
      texts.push({ text, x, y, fill: String(ctx.fillStyle), alpha: Number(ctx.globalAlpha) }),
    ),
    font: '',
    textAlign: '',
    textBaseline: '',
    strokeStyle: '',
    lineWidth: 0,
    texts,
    fills,
    strokes,
    alphas,
    dashes,
  } as unknown as CanvasRenderingContext2D & {
    texts: typeof texts;
    fills: string[];
    strokes: string[];
    alphas: number[];
    dashes: number[][];
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

  it('关掉外圈就一点都不留：预览的外圈是贴边浮层，不占图里的地方', () => {
    const l = layout(10, 10, 3, { cell: 32, ring: false });
    expect(l.ring).toBe(0);
    expect(l.pad).toBe(0);
    expect(l.width).toBe(10 * 32);
  });

  it('minCell 放开后能缩到 8 以下——预览必须一屏看全，导出不必', () => {
    // 手机：一百来列摊在 320 像素里，卡在 8 上整张图会被取景框裁掉右边一大截
    const shown = layout(104, 104, 20, { maxWidth: 320, ring: false, minCell: 2 });
    expect(shown.width).toBeLessThanOrEqual(320);
    expect(shown.cell).toBeLessThan(8);
    // 导出还是老样子
    expect(layout(104, 104, 20, { maxWidth: 320 }).cell).toBe(8);
  });

  it('底部汇总按图宽换行，高度跟着长', () => {
    const narrow = layout(10, 10, 40, { cell: 32 });
    const wide = layout(10, 60, 40, { cell: 32 });
    expect(narrow.legendRows).toBeGreaterThan(wide.legendRows);
    expect(narrow.height).toBeGreaterThan(narrow.legendTop);
  });
});

describe('codeFont', () => {
  it('格子够大就按格子取字号', () => {
    expect(codeFont('H15', 32)).toBe(12);
  });

  it('塞不下先缩字号，而不是让字捅出格子', () => {
    // 长色号在同样大的格子里要小一号
    expect(codeFont('ABCDE', 32)).toBeLessThan(codeFont('H15', 32));
    expect(codeFont('ABCDE', 32)).toBeGreaterThan(0);
  });

  it('缩到看不清就干脆不印——手机上一格三四个像素，硬印是一团糊', () => {
    expect(codeFont('H15', 4)).toBe(0);
    expect(codeFont('H15', 12)).toBe(0);
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
    // 竖线 cols+1、横线 rows+1，再加每 5 格的加粗线（这里各 1 条）。
    // 背景斜纹也在 stroke，按画笔颜色把它排除掉。
    const grid = ctx.strokes.filter((c) => !c.startsWith('rgba(0,0,0,0.0'));
    expect(grid).toHaveLength(4 + 1 + 3 + 1 + 1 + 1);
  });

  it('从左上角起每 10 格一条粗实线，中间每 5 格一条粗虚线', () => {
    const { ctx } = draw(12, 13, Array(156).fill(null), []);
    const starts = vi.mocked(ctx.moveTo).mock.calls;
    const thick = ctx.strokes.flatMap((color, i) =>
      color === 'rgba(0,0,0,0.55)' ? [{ at: starts[i], dashed: ctx.dashes[i]!.length > 0 }] : [],
    );
    expect(thick).toEqual([
      { at: [32, 32], dashed: false }, { at: [192, 32], dashed: true }, { at: [352, 32], dashed: false },
      { at: [32, 32], dashed: false }, { at: [32, 192], dashed: true }, { at: [32, 352], dashed: false },
    ]);
    // 逐格细线永远是实线：虚线设置画完粗线要还原，不能漏到后面
    const thin = ctx.strokes.flatMap((color, i) => (color === 'rgba(0,0,0,0.28)' ? [ctx.dashes[i]!] : []));
    expect(thin.every((d) => d.length === 0)).toBe(true);
    expect(vi.mocked(ctx.setLineDash).mock.calls.at(-1)).toEqual([[]]);
  });

  it('格子小到逐格网格线比豆子还显眼时，只留每 5 格那条粗线', () => {
    const ctx = ctxStub();
    const lay = layout(20, 20, 0, { cell: 3, ring: false });
    drawSheet(ctx, { rows: 20, cols: 20, cells: cells(Array(400).fill('H15')), legend: [], layout: lay });
    const grid = ctx.strokes.filter((c) => !c.startsWith('rgba(0,0,0,0.0'));
    // 逐格线（0.28）一条不画，只剩每 5 格的粗线（0.55，10 格实线 + 5 格虚线）：横竖各 5 条
    expect(grid.filter((c) => c === 'rgba(0,0,0,0.28)')).toHaveLength(0);
    expect(grid.filter((c) => c === 'rgba(0,0,0,0.55)')).toHaveLength(10);
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

  it('导出四边从左上角逐格升序标号，上下列号一致、左右行号一致', () => {
    const { ctx, lay } = draw(6, 8, Array(48).fill('H15'));
    const top = ctx.texts.filter((t) => t.y < lay.pad).map((t) => t.text);
    const bottom = ctx.texts.filter((t) =>
      t.y > lay.pad + lay.gridH && t.y < lay.legendTop,
    ).map((t) => t.text);
    const left = ctx.texts.filter((t) => t.x < lay.pad).map((t) => t.text);
    const right = ctx.texts.filter((t) => t.x > lay.pad + lay.gridW).map((t) => t.text);
    expect(top).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(bottom).toEqual(top);
    expect(left).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(right).toEqual(left);
  });

  it('外圈每一格都有号（100 列 -> 上下各 100 个），没有别的刻度', () => {
    const { ctx } = draw(1, 100, Array(100).fill(null), []);
    const ticks = ctx.texts.map((t) => Number(t.text)).filter((n) => !Number.isNaN(n));
    // 上下各 100 + 左右各 1 = 202，一个不多一个不少
    expect(ticks.length).toBe(202);
  });

  it('关掉外圈就一个坐标都不画（预览用贴边浮层顶上）', () => {
    const ctx = ctxStub();
    const lay = layout(6, 8, 0, { cell: 32, ring: false });
    drawSheet(ctx, { rows: 6, cols: 8, cells: cells(Array(48).fill('H15')), legend: [], layout: lay });
    const ticks = ctx.texts.map((t) => Number(t.text)).filter((n) => !Number.isNaN(n));
    expect(ticks).toHaveLength(0);
  });

  it('格子小到印不下色号就不印——手机上那一层糊字比没有还糟', () => {
    const ctx = ctxStub();
    const lay = layout(2, 2, 0, { cell: 6, ring: false });
    drawSheet(ctx, { rows: 2, cols: 2, cells: cells(Array(4).fill('H15')), legend: [], layout: lay });
    expect(ctx.texts.some((t) => t.text === 'H15')).toBe(false);
    // 颜色照画——缩略图靠的就是这片颜色
    expect(ctx.fills).toContain('#00FF00');
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

  it('没选中的格子先垫一层白再上色——斜纹只在空格里露出来', () => {
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
    const rects = vi.mocked(ctx.fillRect).mock.calls;
    const at = (x: number) => rects.filter(([rx, ry]) => rx === x && ry === lay.pad).length;
    expect(at(lay.pad)).toBe(1); // 选中的那格不透明，一次就盖住斜纹
    expect(at(lay.pad + 32)).toBe(2); // 没选中的：先白底、再调淡色
  });

  it('调淡的亮度和不透明度可以从外面传进来（预览的滑杆）', () => {
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
      dim: { v: 0.5, a: 0.6 },
    });
    expect(ctx.fills).toContain(`#${dimHex('0000FF', 0.5)}`);
    expect(ctx.alphas).toContain(0.6);
  });

  it('没选中的格子也印色号，只是用淡一档的深色字', () => {
    const ctx = ctxStub();
    const lay = layout(1, 2, 0, { cell: 32 });
    drawSheet(ctx, {
      rows: 1,
      cols: 2,
      cells: [
        { code: 'A1', hex: 'FF0000' },
        { code: 'B1', hex: '000000' },
      ],
      legend: [],
      layout: lay,
      focus: new Set(['A1']),
    });
    const a1 = ctx.texts.find((t) => t.text === 'A1')!;
    const b1 = ctx.texts.find((t) => t.text === 'B1')!;
    expect(a1.alpha).toBe(1);
    expect(b1).toBeDefined();
    expect(b1.alpha).toBeGreaterThan(0);
    expect(b1.alpha).toBeLessThan(1);
    // 按调淡后的底色选字色：黑豆调淡后几乎是白底，还印白字就看不见了
    expect(b1.fill).toBe('#111');
    expect(ctx.alphas.at(-1)).toBe(1); // 印完要把透明度还原
  });
});

/**
 * 贴边坐标圈。
 *
 * 它存在的理由就一条：图里画的那圈一放大就滚出视野，而放大恰恰是「我在数第几行
 * 第几列」的时候。所以这里盯的全是「跟着视野走」——滚过去以后报的是**当前这块**
 * 的行列号，不是图纸开头那几列。
 */
describe('drawRingOverlay', () => {
  function ring(over: Partial<RingView> = {}) {
    const ctx = ctxStub();
    const v: RingView = {
      rows: 20, cols: 30, cell: 20,
      scrollX: 0, scrollY: 0,
      viewW: 600, viewH: 400, ring: 22,
      ...over,
    };
    drawRingOverlay(ctx, v);
    return { ctx, v };
  }
  const nums = (ctx: ReturnType<typeof ctxStub>) =>
    ctx.texts.map((t) => Number(t.text)).filter((n) => !Number.isNaN(n));

  it('预览四边从左上角升序标号，上下列号一致、左右行号一致', () => {
    const { ctx } = ring({ rows: 6, cols: 8, cell: 40, viewW: 320, viewH: 240 });
    const top = ctx.texts.filter((t) => t.y < 22);
    const bottom = ctx.texts.filter((t) => t.y > 262);
    const left = ctx.texts.filter((t) => t.x < 22);
    const right = ctx.texts.filter((t) => t.x > 342);
    expect(top.map((t) => t.text)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(bottom.map((t) => t.text)).toEqual(top.map((t) => t.text));
    expect(left.map((t) => t.text)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(right.map((t) => t.text)).toEqual(left.map((t) => t.text));
  });

  it('滚过去以后报的是**当前视野**里的列号，不是图纸开头那几列', () => {
    // 2 倍（cell 40），横向滚掉 400 -> 视野落在第 10..24 列
    const { ctx } = ring({ cell: 40, scrollX: 400, scrollY: 200 });
    const top = ctx.texts.filter((t) => t.y < 22).map((t) => Number(t.text));
    const left = ctx.texts.filter((t) => t.x < 22).map((t) => Number(t.text));
    expect(top).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
    expect(left).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it('格子小到挤不下就跳着标，不糊成一条灰线', () => {
    const { ctx } = ring({ cols: 100, cell: 3, viewW: 300 });
    const top = ctx.texts.filter((t) => t.y < 22);
    expect(top.length).toBeGreaterThan(0);
    expect(top.length).toBeLessThan(100 / 4); // 逐格标是 100 个
    const xs = top.map((t) => t.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(20);
  });

  it('字号和带厚不随缩放变——放大是为了看清格子，不是把标尺也撑大', () => {
    const a = ring({ cell: 20 }).ctx.font;
    const b = ring({ cell: 80 }).ctx.font;
    expect(a).toBe(b);
  });

  it('外圈贴着**看得见的那块网格**，图纸没铺满取景框时不会孤零零挂在框边上', () => {
    // 网格只有 200 宽，取景框 600：右边那条带应该贴在 22+200 处，不是 22+600
    const { ctx } = ring({ cols: 10, rows: 5, cell: 20 });
    const right = ctx.texts.filter((t) => t.x > 22 + 200);
    expect(right.length).toBeGreaterThan(0);
    expect(Math.min(...right.map((t) => t.x))).toBeLessThan(22 + 300);
  });

  it('网格整个滚出视野就什么都不画', () => {
    const { ctx } = ring({ scrollY: 99999 });
    expect(ctx.texts).toHaveLength(0);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});

/**
 * 两种空格必须画成同一个样子。
 *
 * 「人工标成空白」和「检测出来就是空的」是同一回事——后端的 matrix._code() 早就
 * 把它们并成空串了。前端漏了这一步的话，人工标的那些会被当成一个叫「-」的色号：
 * 色卡里查不到就退回灰色，格子里还印个 `-`，旁边检测出来的空格却是一片留白透出
 * 背景斜纹，同一张图上两种空格长得完全不一样。
 */
describe('sheetToDrawing', () => {
  const HEX: Record<string, string> = { H15: '00FF00', B8: '0000FF' };
  const draw = (over: Record<string, string>) =>
    sheetToDrawing(
      {
        rows: 1,
        cols: 3,
        labels: [0, 1, -1],
        classes: [
          { klass: 0, code: 'H15' },
          { klass: 1, code: 'B8' },
        ],
        overrides: over,
        tally: { H15: 1, B8: 1 },
      },
      (c) => HEX[c],
      (a, b) => a.localeCompare(b),
    );

  it('人工标成空白的格子和检测出来的空格一模一样', () => {
    const { cells } = draw({ '0,1': BLANK_CODE });
    expect(cells[1]).toEqual(cells[2]); // 人工标的 == 检测出来的
    expect(cells[1]!.code).toBe('');
  });

  it('整类改成空白也一样——classes 里也可能存着这个记号', () => {
    const d = sheetToDrawing(
      {
        rows: 1,
        cols: 2,
        labels: [0, -1],
        classes: [{ klass: 0, code: BLANK_CODE }],
        overrides: {},
        tally: {},
      },
      (c) => HEX[c],
      (a, b) => a.localeCompare(b),
    );
    expect(d.cells[0]).toEqual(d.cells[1]);
  });

  it('别的色号照常', () => {
    const { cells } = draw({ '0,0': 'B8' });
    expect(cells[0]).toEqual({ code: 'B8', hex: '0000FF' });
  });
});
