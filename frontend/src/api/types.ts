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
