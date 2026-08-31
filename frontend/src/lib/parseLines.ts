export interface ParsedLine {
  lineNo: number;
  raw: string;
  code: string | null;
  qty: number | null;
  status: 'ok' | 'format_error' | 'bad_quantity';
  message: string;
}

export function normalize(text: string): string {
  return text.replace(/，/g, ',').replace(/　/g, ' ').replace(/\s*,\s*/g, ',');
}

export function parseLines(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  normalize(text)
    .split('\n')
    .forEach((raw, i) => {
      const lineNo = i + 1;
      const stripped = raw.trim();
      if (!stripped) return;

      const tokens = stripped.split(/[,\s]+/).filter(Boolean);
      if (tokens.length !== 2) {
        out.push({
          lineNo,
          raw,
          code: null,
          qty: null,
          status: 'format_error',
          message: "应为 '色号,数量'",
        });
        return;
      }
      const [codeTok, qtyTok] = tokens as [string, string];
      const code = codeTok.toUpperCase();
      if (!/^\d+$/.test(qtyTok) || Number(qtyTok) <= 0) {
        out.push({ lineNo, raw, code, qty: null, status: 'bad_quantity', message: '数量应为正整数' });
        return;
      }
      out.push({ lineNo, raw, code, qty: Number(qtyTok), status: 'ok', message: '' });
    });
  return out;
}
