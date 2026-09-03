/**
 * 把校对好的图纸画成一张可下载的图：坐标标尺 + 网格线 + 格内色号 + 底部色号汇总。
 *
 * 格式对齐市面上那些生成器导出的图纸——用户是拿着它对着拼的，所以「每格印着色号」
 * 和「底部有汇总」都不是装饰：前者决定他能不能一格一格照着摆，后者决定他能不能
 * 数清楚要买多少颗。
 *
 * 全在前端画。服务端不产出任何图片：矩阵、色卡、数量前端全都有，画一遍就行。
 */

export interface ExportCell {
  /** 空串 = 空格，不画 */
  code: string;
  /** #RRGGBB 之外的部分，纯十六进制 */
  hex: string;
}

export interface ExportOptions {
  /** 每格多少像素。太小了色号印不下，太大了文件没必要 */
  cell?: number;
  /** 标尺宽度 */
  ruler?: number;
  /** 整张图的宽度上限，超了就自动缩小格子 */
  maxWidth?: number;
}

export interface LegendEntry {
  code: string;
  hex: string;
  count: number;
}

const DEFAULTS = { cell: 32, ruler: 26, maxWidth: 8000 };

/** 每几格标一次坐标。全标出来在 104 列上会糊成一片。 */
function tickStep(n: number): number {
  if (n <= 30) return 1;
  if (n <= 60) return 2;
  if (n <= 120) return 5;
  return 10;
}

/** 底部汇总每行放几项，按图宽自适应。 */
const LEGEND_W = 150;
const LEGEND_H = 44;

export interface Layout {
  cell: number;
  ruler: number;
  width: number;
  height: number;
  gridW: number;
  gridH: number;
  legendTop: number;
  legendCols: number;
  legendRows: number;
}

export function layout(
  rows: number,
  cols: number,
  legendCount: number,
  opts: ExportOptions = {},
): Layout {
  const ruler = opts.ruler ?? DEFAULTS.ruler;
  const maxWidth = opts.maxWidth ?? DEFAULTS.maxWidth;
  let cell = opts.cell ?? DEFAULTS.cell;
  // 大图纸（104 列）按默认格子会到 3.4k 宽，还能接受；再大就缩格子而不是裁内容
  if (cols * cell + ruler * 2 > maxWidth) {
    cell = Math.max(8, Math.floor((maxWidth - ruler * 2) / Math.max(1, cols)));
  }
  const gridW = cols * cell;
  const gridH = rows * cell;
  const width = gridW + ruler * 2;
  const legendCols = Math.max(1, Math.floor(width / LEGEND_W));
  const legendRows = Math.ceil(legendCount / legendCols);
  const legendTop = gridH + ruler * 2 + 12;
  return {
    cell,
    ruler,
    width,
    height: legendTop + legendRows * LEGEND_H + 12,
    gridW,
    gridH,
    legendTop,
    legendCols,
    legendRows,
  };
}

/** 字印在这个底色上，用黑还是白。和合成渲染器同一条规则。 */
export function inkOn(hex: string): string {
  const n = Number.parseInt(hex, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return r * 0.299 + g * 0.587 + b * 0.114 > 140 ? '#111' : '#fff';
}

/**
 * 画整张图。`cells` 按行优先，长度必须是 rows*cols。
 *
 * 只依赖 2D 上下文，不碰 DOM——所以能在测试里对着桩断言画了什么。
 */
/** 底部汇总里没被选中的那几项画成这个透明度。 */
const DIM_LEGEND = 0.3;

/**
 * 调淡 = **先调暗，再透明**。两步各治一个毛病，缺一个都不行：
 *
 *   只透明   浅色越混越白（透明度是往白底上混），最后和空格、和白豆子糊成一片
 *   只调暗   深色本来就暗，压了等于没压，整片黑照样抢戏
 *
 *   先乘 DIM_V 把明度压下来 —— 浅色不再贴着白底，而且色相饱和度一点没动，
 *                              是「暗一档」不是「褪成灰」
 *   再叠 DIM_A 的透明度     —— 整体退到背景里，深色也跟着被白底提起来，
 *                              不会有一整片黑压在图上
 *
 * 两个数一起决定调淡后的落点：0..255 会被压进 115..213 这一段。选中的浅色豆子
 * （221 色卡里 21 个色号亮度 >= 235，最亮的 H2 是 254.7）比它高出四十级以上，
 * 深色也被提到 115 往上，谁都不会盖过谁。
 *
 * 要调就调这两个数：DIM_V 往 1 走颜色更亮，DIM_A 往 1 走存在感更强。
 */
const DIM_V = 0.7;
const DIM_A = 0.55;

export function dimHex(hex: string): string {
  const n = Number.parseInt(hex, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.round(v * DIM_V),
  );
  return ch.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** 背景斜纹的颜色和粗细。要淡到不抢戏，又要在纯白上看得出来。 */
const HATCH = 'rgba(0,0,0,0.07)';

/**
 * 给一块区域铺上背景斜纹。
 *
 * 解决的是一个很具体的问题：白底上，**空格**、**被调淡的格子**、**本来就接近
 * 白色的豆子**三者长得一模一样。突出显示某个浅色色号时，它整个溶在背景里。
 *
 * 铺一层斜纹当底，格子画在它上面：不透明的格子把斜纹盖掉，空格直接透出斜纹，
 * 调淡的格子半透地透出斜纹。于是「背景」永远带纹理，**被选中的色号是画面上
 * 唯一平整实心的东西**——哪怕它自己就是米白，也一眼认得出来。
 *
 * 斜纹间距跟着格子走（半格一条），缩略图和导出的大图看起来是同一种质感。
 */
function hatch(ctx: CanvasRenderingContext2D, x: number, y: number,
               w: number, h: number, step: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = HATCH;
  ctx.lineWidth = 1;
  for (let d = -h; d < w; d += step) {
    ctx.beginPath();
    ctx.moveTo(x + d, y);
    ctx.lineTo(x + d + h, y + h);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawSheet(
  ctx: CanvasRenderingContext2D,
  params: {
    rows: number;
    cols: number;
    cells: ExportCell[];
    legend: LegendEntry[];
    layout: Layout;
    /** 只突出这些色号，其余的调淡。空集或不给 = 全部照常画。 */
    focus?: Set<string>;
  },
): void {
  const { rows, cols, cells, legend } = params;
  const focus = params.focus?.size ? params.focus : null;
  const { cell, ruler, width, height, gridW, gridH, legendTop, legendCols } = params.layout;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);

  // --- 背景底纹 ---
  // 先铺，格子画在它上面。空格透出它，调淡的格子半透地透出它。
  hatch(ctx, ruler, ruler, gridW, gridH, Math.max(4, cell / 2));

  // --- 格子 ---
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const font = Math.max(7, Math.floor(cell * 0.38));
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const it = cells[r * cols + c];
      if (!it || !it.code) continue; // 空格留白
      const x = ruler + c * cell;
      const y = ruler + r * cell;
      const dim = focus !== null && !focus.has(it.code);
      ctx.globalAlpha = dim ? DIM_A : 1;
      ctx.fillStyle = `#${dim ? dimHex(it.hex) : it.hex}`;
      ctx.fillRect(x, y, cell, cell);
      ctx.globalAlpha = 1;
      // 调淡的格子**不印色号**。每一格都印着字，满屏灰字比颜色本身更抢眼，
      // 想找的那几格反而淹在里面。选中之后只有它们带字，一眼就找得到。
      if (dim) continue;
      ctx.fillStyle = inkOn(it.hex);
      ctx.font = `${font}px system-ui, sans-serif`;
      ctx.fillText(it.code, x + cell / 2, y + cell / 2);
    }
  }

  // --- 网格线 ---
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 1;
  for (let c = 0; c <= cols; c += 1) {
    const x = ruler + c * cell + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, ruler);
    ctx.lineTo(x, ruler + gridH);
    ctx.stroke();
  }
  for (let r = 0; r <= rows; r += 1) {
    const y = ruler + r * cell + 0.5;
    ctx.beginPath();
    ctx.moveTo(ruler, y);
    ctx.lineTo(ruler + gridW, y);
    ctx.stroke();
  }
  // 每 10 格加粗一条，照着数的时候不容易串行
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 2;
  for (let c = 0; c <= cols; c += 10) {
    const x = ruler + c * cell;
    ctx.beginPath();
    ctx.moveTo(x, ruler);
    ctx.lineTo(x, ruler + gridH);
    ctx.stroke();
  }
  for (let r = 0; r <= rows; r += 10) {
    const y = ruler + r * cell;
    ctx.beginPath();
    ctx.moveTo(ruler, y);
    ctx.lineTo(ruler + gridW, y);
    ctx.stroke();
  }

  // --- 四边标尺 ---
  ctx.fillStyle = '#333';
  ctx.font = `${Math.max(8, Math.floor(ruler * 0.42))}px system-ui, sans-serif`;
  const stepC = tickStep(cols);
  const stepR = tickStep(rows);
  for (let c = 0; c < cols; c += 1) {
    if ((c + 1) % stepC) continue;
    const x = ruler + c * cell + cell / 2;
    ctx.fillText(String(c + 1), x, ruler / 2);
    ctx.fillText(String(c + 1), x, ruler + gridH + ruler / 2);
  }
  for (let r = 0; r < rows; r += 1) {
    if ((r + 1) % stepR) continue;
    const y = ruler + r * cell + cell / 2;
    ctx.fillText(String(r + 1), ruler / 2, y);
    ctx.fillText(String(r + 1), ruler + gridW + ruler / 2, y);
  }

  // --- 底部色号汇总 ---
  ctx.textAlign = 'left';
  legend.forEach((e, i) => {
    const x = 8 + (i % legendCols) * LEGEND_W;
    const y = legendTop + Math.floor(i / legendCols) * LEGEND_H;
    ctx.globalAlpha = focus && !focus.has(e.code) ? DIM_LEGEND : 1;
    ctx.fillStyle = `#${e.hex}`;
    ctx.fillRect(x, y, 30, 30);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, 30, 30);
    ctx.fillStyle = '#111';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(e.code, x + 38, y + 12);
    ctx.fillStyle = '#555';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(`${e.count} 颗`, x + 38, y + 26);
    ctx.globalAlpha = 1;
  });
}

/**
 * 把一张校对过的图纸转成绘制参数。
 *
 * 预览和下载**共用这一个转换**：屏幕上看到的和下载下来的必须是同一张图，否则
 * 用户照着屏幕拼、拿到的文件却是另一回事。
 *
 * 用的是校对之后的归属（labels + classes + overrides），不是识别的原始输出。
 */
export function sheetToDrawing(
  sheet: {
    rows: number;
    cols: number;
    labels: number[];
    classes: Array<{ klass: number; code: string }>;
    overrides: Record<string, string>;
    tally: Record<string, number>;
  },
  hexOf: (code: string) => string | undefined,
  sortCodes: (a: string, b: string) => number,
): { cells: ExportCell[]; legend: LegendEntry[] } {
  const codeOf = new Map(sheet.classes.map((c) => [c.klass, c.code]));
  const cells: ExportCell[] = [];
  for (let r = 0; r < sheet.rows; r += 1) {
    for (let c = 0; c < sheet.cols; c += 1) {
      const over = sheet.overrides[`${r},${c}`];
      const k = sheet.labels[r * sheet.cols + c];
      const code = over ?? (k !== undefined && k >= 0 ? codeOf.get(k) : undefined);
      cells.push({
        code: code ?? '',
        hex: code ? (hexOf(code) ?? 'CCCCCC') : 'CCCCCC',
      });
    }
  }
  const legend: LegendEntry[] = Object.keys(sheet.tally)
    .sort(sortCodes)
    .map((code) => ({ code, hex: hexOf(code) ?? 'CCCCCC', count: sheet.tally[code]! }));
  return { cells, legend };
}
