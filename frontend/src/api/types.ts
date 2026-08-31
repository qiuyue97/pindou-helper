export interface Me {
  username: string;
  threshold: number;
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
