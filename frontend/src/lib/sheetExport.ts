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
  /** 整张图的宽度上限，超了就自动缩小格子 */
  maxWidth?: number;
  /**
   * 缩到不能再缩的格子大小。导出留 8——再小连轮廓都糊了；预览可以给到 2，
   * 因为**预览必须在一屏内看全**：手机上一百来列摊在 320 像素里，格子只能是
   * 三四个像素，卡在 8 上就会被取景框裁掉右边一大截。
   */
  minCell?: number;
  /**
   * 画不画最外圈的逐格坐标。导出要（false 之外都要）；预览**不要**——预览把
   * 外圈做成了跟着视野走的贴边浮层，画在图上的那圈一放大就滚没了。
   */
  ring?: boolean;
}

export interface LegendEntry {
  code: string;
  hex: string;
  count: number;
}

const DEFAULTS = { cell: 32, maxWidth: 8000, minCell: 8 };

/** 底部汇总每行放几项，按图宽自适应。 */
const LEGEND_W = 150;
const LEGEND_H = 44;

export interface Layout {
  cell: number;
  /** 外圈坐标那一格有多宽。和格子同宽，外圈和图纸一一对齐。 */
  ring: number;
  /** 网格左上角离画布边的距离。只有外圈那一圈，所以 = ring。 */
  pad: number;
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
  const maxWidth = opts.maxWidth ?? DEFAULTS.maxWidth;
  const minCell = Math.max(1, opts.minCell ?? DEFAULTS.minCell);
  const withRing = opts.ring !== false;
  // 外圈占一整格宽，所以带外圈时总宽是 (cols + 2) 格。
  const span = cols + (withRing ? 2 : 0);
  let cell = opts.cell ?? DEFAULTS.cell;
  // 超了就缩格子而不是裁内容。
  if (span * cell > maxWidth) {
    cell = Math.max(minCell, Math.floor(maxWidth / Math.max(1, span)));
  }
  const gridW = cols * cell;
  const gridH = rows * cell;
  const ring = withRing ? cell : 0;
  const pad = ring;
  const width = gridW + pad * 2;
  const legendCols = Math.max(1, Math.floor(width / LEGEND_W));
  const legendRows = Math.ceil(legendCount / legendCols);
  const legendTop = gridH + pad * 2 + 12;
  return {
    cell,
    ring,
    pad,
    width,
    height: legendTop + legendRows * LEGEND_H + 12,
    gridW,
    gridH,
    legendTop,
    legendCols,
    legendRows,
  };
}

/**
 * 外圈的一格：浅底 + 细框 + 居中的数字。调用前先把字体设好。
 */
function ringCell(ctx: CanvasRenderingContext2D, x: number, y: number,
                  w: number, h: number, text: string): void {
  ctx.fillStyle = '#f4f5f7';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = '#333';
  ctx.fillText(text, x + w / 2, y + h / 2);
}

/**
 * 这一格该用多大的字印色号；返回 0 表示**别印**。
 *
 * 手机上格子只有三四个像素宽，原来是 `max(7, cell*0.38)` 硬印——字比格子还宽，
 * 一整片墨点糊在一起，图案本身反而看不见了（用户原话「很花」）。现在是：想要的
 * 字号和塞得下的字号取小，小于 6 像素就干脆不印，放大到装得下自然就出来。
 *
 * 宽度用**估算**（system-ui 的数字和大写字母约是字号的 0.62 倍）而不是
 * measureText：纯算术，没有 canvas 的地方（测试）也算得出同一个结果。
 */
const CHAR_W = 0.62;
const MIN_FONT = 6;
/** 格子小于这个就不画逐格网格线了——线比格子还抢眼。 */
const MIN_GRID_CELL = 6;

export function codeFont(code: string, cell: number): number {
  const want = Math.floor(cell * 0.38);
  const fits = Math.floor((cell - 1) / (CHAR_W * Math.max(1, code.length)));
  const f = Math.min(want, fits);
  return f >= MIN_FONT ? f : 0;
}

/** 字印在这个底色上，用黑还是白。和合成渲染器同一条规则。 */
export function inkOn(hex: string): string {
  const n = Number.parseInt(hex, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return r * 0.299 + g * 0.587 + b * 0.114 > 140 ? '#111' : '#fff';
}

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
 * 这两个值是在界面上拉滑杆试出来的（那两条滑杆调完就删了）。0.9/0.1 的落点是
 * 229..252：调淡的部分几乎只剩一层影子，选中的色号靠满色 + 格内色号 + 背景斜纹
 * 三样一起立起来。
 *
 * 两个数是**反向拉扯**的：DIM_A 越小整体越淡越退得远，但调淡后的区间也跟着被
 * 压扁、离白底更近。要重新调的话两个一起动。
 */
const DIM_V = 0.9;
const DIM_A = 0.1;

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

/**
 * 画整张图。`cells` 按行优先，长度必须是 rows*cols。
 *
 * 只依赖 2D 上下文，不碰 DOM——所以能在测试里对着桩断言画了什么。
 */
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
  const { cell, ring, pad, width, height, gridW, gridH, legendTop, legendCols } = params.layout;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);

  // --- 背景底纹 ---
  // 先铺，格子画在它上面。空格透出它，调淡的格子半透地透出它。
  hatch(ctx, pad, pad, gridW, gridH, Math.max(4, cell / 2));

  // --- 格子 ---
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const it = cells[r * cols + c];
      if (!it || !it.code) continue; // 空格留白
      const x = pad + c * cell;
      const y = pad + r * cell;
      const dim = focus !== null && !focus.has(it.code);
      ctx.globalAlpha = dim ? DIM_A : 1;
      ctx.fillStyle = `#${dim ? dimHex(it.hex) : it.hex}`;
      ctx.fillRect(x, y, cell, cell);
      ctx.globalAlpha = 1;
      // 调淡的格子**不印色号**。每一格都印着字，满屏灰字比颜色本身更抢眼，
      // 想找的那几格反而淹在里面。选中之后只有它们带字，一眼就找得到。
      if (dim) continue;
      const font = codeFont(it.code, cell);
      if (!font) continue; // 格子太小，印出来只是一团糊
      ctx.fillStyle = inkOn(it.hex);
      ctx.font = `${font}px system-ui, sans-serif`;
      ctx.fillText(it.code, x + cell / 2, y + cell / 2);
    }
  }

  // --- 网格线 ---
  //
  // 逐格那一层**格子太小就不画**：手机上 1 倍是三个像素一格，一条 1 像素的线要
  // 吃掉小半格，满屏细线比豆子本身还显眼（用户原话「图片看着很花」）。每 10 格
  // 那条粗线照画——它间距够大，是这时候唯一还立得住的定位线。
  if (cell >= MIN_GRID_CELL) {
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= cols; c += 1) {
      const x = pad + c * cell + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, pad);
      ctx.lineTo(x, pad + gridH);
      ctx.stroke();
    }
    for (let r = 0; r <= rows; r += 1) {
      const y = pad + r * cell + 0.5;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(pad + gridW, y);
      ctx.stroke();
    }
  }
  // 每 10 格加粗一条，照着数的时候不容易串行
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 2;
  for (let c = 0; c <= cols; c += 10) {
    const x = pad + c * cell;
    ctx.beginPath();
    ctx.moveTo(x, pad);
    ctx.lineTo(x, pad + gridH);
    ctx.stroke();
  }
  for (let r = 0; r <= rows; r += 10) {
    const y = pad + r * cell;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(pad + gridW, y);
    ctx.stroke();
  }

  // --- 四边坐标：外圈**逐格**一个数字 ---
  //
  // 只有这一圈。之前中间还有一圈每 5 格一标的粗刻度，和逐格圈挨在一起又挤又乱，
  // 去掉了——逐格圈本身就够定位，还能一格一格对着拼。
  //
  // 上降序、下升序、左降序、右升序 —— 于是**最大的数落在左上和右下**这两个对角。
  // 数格子的时候从哪一边起手都有一个满格基准，不必每次从 1 数到 104。
  //
  // 预览把这一圈关掉了（layout 的 ring: false），改用 drawRingOverlay 贴在取景框
  // 边上——画在图里的圈一放大就跟着滚出视野，正好在最需要坐标的时候没了。
  if (ring > 0) {
    ctx.fillStyle = '#333';
    ctx.font = `${Math.max(6, Math.floor(cell * 0.36))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    for (let c = 0; c < cols; c += 1) {
      const x = pad + c * cell;
      ringCell(ctx, x, pad - ring, cell, ring, String(cols - c)); // 上：降序
      ringCell(ctx, x, pad + gridH, cell, ring, String(c + 1)); // 下：升序
    }
    for (let r = 0; r < rows; r += 1) {
      const y = pad + r * cell;
      ringCell(ctx, pad - ring, y, ring, cell, String(rows - r)); // 左：降序
      ringCell(ctx, pad + gridW, y, ring, cell, String(r + 1)); // 右：升序
    }
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

/** 贴边外圈：带的厚度、字号，以及两个数字之间至少留多宽。都是屏幕像素，不随缩放变。 */
export const RING_PX = 22;
const RING_FONT = 11;
const RING_MIN_GAP = 26;
const RING_BG = '#f4f5f7';

export interface RingView {
  rows: number;
  cols: number;
  /** 当前每格在屏幕上多少像素（= 1 倍格子 × 缩放） */
  cell: number;
  /** 取景框已经滚过去多少 */
  scrollX: number;
  scrollY: number;
  /** 取景框（不含外圈那一圈）的可视宽高 */
  viewW: number;
  viewH: number;
  /** 外圈带的厚度 */
  ring: number;
}

/**
 * 把坐标外圈画成**贴着取景框**的一层浮层，而不是图纸的一部分。
 *
 * 画在图里的外圈有个致命问题：一放大，图纸的外边就滚出视野了——而放大恰恰是
 * 「我在数第几行第几列」的时候，坐标反而没了。这一层跟着视野走：不管滚到哪、
 * 放多大，四边永远贴着当前看得见的那块网格，报的是**这块**的行列号。
 *
 * 两条不随缩放变的规矩：
 *   - 带厚 RING_PX、字号 RING_FONT 都是屏幕像素。放大是为了看清格子，不是为了
 *     把标尺也撑大。
 *   - 格子小到印不下每一格时**跳着标**（step），间距始终 ≥ RING_MIN_GAP。手机上
 *     一格三四个像素，逐格标只会糊成一条灰线。
 *
 * 上降序、下升序、左降序、右升序 —— 和导出的那一圈同一套规则，最大的数落在
 * 左上和右下两个对角。
 */
export function drawRingOverlay(ctx: CanvasRenderingContext2D, v: RingView): void {
  const { rows, cols, cell, scrollX, scrollY, viewW, viewH, ring } = v;
  ctx.clearRect(0, 0, viewW + ring * 2, viewH + ring * 2);
  if (!rows || !cols || cell <= 0) return;

  // 当前看得见的那块网格，换算到浮层画布的坐标上。外圈贴着它画，所以图纸没铺满
  // 取景框时（1 倍、小图纸）外圈就紧贴图纸，不会孤零零挂在框边上。
  const cl = (n: number, hi: number) => Math.min(hi, Math.max(0, n));
  const x0 = ring + cl(-scrollX, viewW);
  const x1 = ring + cl(cols * cell - scrollX, viewW);
  const y0 = ring + cl(-scrollY, viewH);
  const y1 = ring + cl(rows * cell - scrollY, viewH);
  if (x1 <= x0 || y1 <= y0) return; // 网格整个滚出去了，没有坐标可报

  const bw = x1 - x0;
  const bh = y1 - y0;
  ctx.fillStyle = RING_BG;
  ctx.fillRect(x0 - ring, y0 - ring, bw + ring * 2, ring); // 上
  ctx.fillRect(x0 - ring, y1, bw + ring * 2, ring); // 下
  ctx.fillRect(x0 - ring, y0 - ring, ring, bh + ring * 2); // 左
  ctx.fillRect(x1, y0 - ring, ring, bh + ring * 2); // 右

  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 - ring + 0.5, y0 - ring + 0.5, bw + ring * 2 - 1, bh + ring * 2 - 1);
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, bw - 1, bh - 1);

  ctx.fillStyle = '#333';
  ctx.font = `${RING_FONT}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = Math.max(1, Math.ceil(RING_MIN_GAP / cell));

  for (let c = 0; c < cols; c += step) {
    const x = ring + c * cell + cell / 2 - scrollX;
    if (x < x0 || x > x1) continue;
    ctx.fillText(String(cols - c), x, y0 - ring / 2); // 上：降序
    ctx.fillText(String(c + 1), x, y1 + ring / 2); // 下：升序
  }
  for (let r = 0; r < rows; r += step) {
    const y = ring + r * cell + cell / 2 - scrollY;
    if (y < y0 || y > y1) continue;
    ctx.fillText(String(rows - r), x0 - ring / 2, y); // 左：降序
    ctx.fillText(String(r + 1), x1 + ring / 2, y); // 右：升序
  }
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
