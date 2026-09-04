export interface Me {
  username: string;
  threshold: number;
  is_vip: boolean;
}

/** One inventory change the smart-control extractor proposes, pending confirmation. */
export interface SmartLine {
  code: string;
  /** Signed: positive adds, negative deducts. */
  delta: number;
  /** Which part of the user's sentence produced this row. */
  source?: string;
}

export interface SmartExtractOut {
  lines: SmartLine[];
  /** Anything the extractor could not turn into a row, echoed back for the user. */
  unresolved?: string[];
  /** Which model actually answered — the request falls through a priority list. */
  model?: string;
}

export interface InventoryRow {
  code: string;
  quantity: number;
  updated_at: string;
}

export interface Change {
  code: string;
  from: number | null;
  to: number | null;
}

export interface ChangesOut {
  changes: Change[];
}

export type BatchStatus = 'ok' | 'format_error' | 'bad_quantity' | 'code_not_found';

export interface BatchLineResult {
  line: number;
  code: string | null;
  qty: number | null;
  status: BatchStatus;
  message: string;
}

export interface BatchOut {
  ok: boolean;
  applied: boolean;
  results: BatchLineResult[];
  changes: Change[];
}

export type CheckStatus = 'enough' | 'short' | 'unknown_code' | 'format_error' | 'bad_quantity';

export interface CheckLineResult {
  line: number;
  code: string | null;
  need: number | null;
  have: number | null;
  status: CheckStatus;
}

export interface CheckOut {
  results: CheckLineResult[];
}

export interface StockoutItem {
  code: string;
  quantity: number;
}

export interface StockoutOut {
  codes: string[];
  text: string;
  items: StockoutItem[];
}

export type OpType =
  | 'add_code'
  | 'set'
  | 'delete'
  | 'single_add'
  | 'single_deduct'
  | 'batch_add'
  | 'batch_deduct';

export interface OpEntry {
  code: string;
  kind: 'add' | 'deduct' | 'set' | 'remove';
  amount: number | null;
}

export interface OperationRow {
  seq: number;
  type: OpType;
  summary: string;
  entries: OpEntry[];
  /** e.g. "ALL(221)" when the operation used the wildcard; null otherwise. */
  scope_label: string | null;
  /** The text the user originally typed — the edit dialog prefills from this. */
  raw: string | null;
  voided: boolean;
  created_at: string;
  edited_at: string | null;
  note: string | null;
}

export interface ColorRow {
  code: string;
  hex: string;
  source: 'override' | 'custom';
  base_hex: string | null;
}

export interface BatchPayload {
  raw: string;
  lines: { code: string; qty: number }[];
}

export interface SinglePayload {
  code: string;
  qty?: number;
}

/** How one uploaded file fared. Present for every file, good or bad. */
export interface PatternImage {
  /** The order the user uploaded it in — display order, nothing else. */
  index: number;
  /**
   * Where the original lives: `/api/patterns/{job}/images/{image_index}`.
   * Null when the file never got stored (wrong type, too big), so there is
   * nothing to open.
   */
  image_index: number | null;
  filename: string;
  status: 'ok' | 'failed';
  error: string;
  /** Warnings worth showing, e.g. that the image had to be quantised. */
  notes: string[];
}

export interface PatternJob {
  id: number;
  status: 'pending' | 'running' | 'done' | 'failed';
  bead_list: string;
  md_table: string;
  note: string;
  model: string;
  error: string;
  /** false = the images held no colour-code table; bead_list is empty. */
  extracted: boolean;
  seen: boolean;
  image_count: number;
  /** Per-image outcome; one entry per uploaded file. */
  items: PatternImage[];
  created_at: string;
  finished_at: string | null;
}

export interface PatternJobSummary {
  jobs: PatternJob[];
  /** Finished but not yet looked at — this is what lights the red dot. */
  unseen: number;
  running: number;
}

/** 上传后立刻返回的初始猜测。source='manual' 表示没检测到点阵，用户自己拖框。 */
export interface SheetGuess {
  id: number;
  width: number;
  height: number;
  rect: number[];
  rows: number;
  cols: number;
  /** 真实检测到的分隔线位置，拖角时吸附到它们上。检测失败就是空的。 */
  snap_x: number[];
  snap_y: number[];
  source: 'lattice' | 'manual';
}

export type SheetLevel = 'ok' | 'warn' | 'count' | 'guess';

/** 一个颜色类。level 决定卡片排在哪、显示什么颜色。 */
export interface SheetClass {
  klass: number;
  code: string;
  /** ocr = 读出来的；guess = 什么都没读出来，拿类心色猜的 */
  source: 'ocr' | 'guess';
  level: SheetLevel;
  /** 类心色与 code 的目录色的 dE00 */
  de: number;
  n: number;
  radius: number;
  rgb: number[];
  nearest: string;
  nearest_de: number;
  /** OCR 不受先验约束时的答案。和 code 不一致就是要给用户看的东西。 */
  read_full: string | null;
  off_list: boolean;
  /** 同码多类且颜色差得远时，这些类心色两两 dE00 的最大值 */
  dup: number | null;
  /** 成员的扁平下标（r * cols + c） */
  cells: number[];
}

/**
 * 一个色号一行。按**色号**，不是按类——一个色号名下的多个类合并成一行。
 *
 * 界面上的两个词：
 *   图纸数量   = prior，图例上印着的数。可以改，改的是「图纸说有多少」
 *   已识别数量 = sheet，当前分在这个色号下的格子数。数出来的事实
 */
export interface CountRow {
  code: string;
  /** 已识别数量 */
  sheet: number;
  /** 图纸数量。null = 图例里根本没有这个色号 */
  prior: number | null;
  /** 名下有哪些类。改这一行的色号要把它们全带上。 */
  classes: number[];
  level: SheetLevel;
  /** 图例里没有、用户自己改出来的色号。标绿，不算「数量对不上」。 */
  custom: boolean;
}

export interface Sheet {
  id: number;
  /** 识别别人的图纸，还是从照片生成的。两条路能做的操作不一样。 */
  kind: 'recognise' | 'generate';
  /** 用户起的名字。空 = 没起过，列表里显示 #id。 */
  name: string;
  /** 列表里的排序位。小的在前，同位按 id 倒序。 */
  position: number;
  status: 'pending' | 'ready' | 'running' | 'done' | 'failed';
  width: number;
  height: number;
  rect: number[];
  rows: number;
  cols: number;
  has_blanks: boolean;
  palette: '221' | '291';
  snap_x: number[];
  snap_y: number[];
  /** rows*cols 个类下标；-1 = 空格 */
  labels: number[];
  classes: SheetClass[];
  counts: CountRow[];
  /** {"12,34": "H15"} 稀疏的逐格人工修正 */
  overrides: Record<string, string>;
  prior: Record<string, number>;
  engine: string;
  /** 识别进行到哪一步（给用户看的一句话）。只在 running 期间有意义。 */
  step: string;
  /** 0-100。分段权重，不是线性时间——耗时几乎全在 OCR 那一段。 */
  progress: number;
  /** false = 这张图的填充色是一段连续谱，整张走了颜色兜底 */
  structured: boolean;
  error: string;
  seen: boolean;
  tally: Record<string, number>;
  created_at: string;
  finished_at: string | null;
}

export interface SheetSummary {
  sheets: Sheet[];
  running: number;
}
