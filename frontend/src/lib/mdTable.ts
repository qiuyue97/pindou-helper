/**
 * Parses the pipe table FastGPT's code node emits.
 *
 * Deliberately not a markdown library: the input is one known shape produced by
 * a script we can read, so a 20-line parser beats a dependency.
 *
 *   | 色号 | 图片1 | 图片2 |
 *   | --- | --- | --- |
 *   | A3 |  | 105 |
 *   | 色号数量 | 14 | 20 |
 *   | 总豆数 | 2268 | 1000 |
 */
export interface MdTable {
  headers: string[];
  rows: string[][];
}

/** `| a | b |` → `['a', 'b']`. */
function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim());
}

const SEPARATOR = /^[\s|:-]+$/;

export function parseMdTable(md: string): MdTable | null {
  const lines = md
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'));
  if (lines.length < 2) return null;

  const headers = splitRow(lines[0]!);
  // The `| --- | --- |` rule line carries no data.
  const body = lines.slice(1).filter((l) => !SEPARATOR.test(l));
  const rows = body.map((l) => {
    const cells = splitRow(l);
    // Pad short rows so every row lines up with the header.
    while (cells.length < headers.length) cells.push('');
    return cells.slice(0, headers.length);
  });
  return { headers, rows };
}

/**
 * The index of the image a "图片N" header refers to, or null.
 * Returned zero-based, matching `/api/patterns/{id}/images/{index}`.
 */
export function imageIndexOf(header: string): number | null {
  const m = /^图片\s*(\d+)$/.exec(header.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 ? n - 1 : null;
}

/** Rows the code node appends as totals rather than per-code data. */
const SUMMARY_LABELS = new Set(['色号数量', '总豆数']);

export function isSummaryRow(row: string[]): boolean {
  return SUMMARY_LABELS.has((row[0] ?? '').trim());
}
