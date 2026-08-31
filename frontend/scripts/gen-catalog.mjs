import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(FRONTEND, '..');
const SRC = resolve(REPO, 'shared/mard-291.txt');
const OUT_FILES = [
  resolve(FRONTEND, 'src/data/catalog.json'),
  resolve(REPO, 'backend/app/catalog.json'),
];

const EXPECTED_COUNTS = {
  A: 26, B: 32, C: 29, D: 26, E: 24, F: 25, G: 21, H: 23,
  M: 15, P: 23, Q: 5, R: 28, T: 1, Y: 5, ZG: 8,
};

export function parseCatalog(text) {
  const entries = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([A-Z]+)(\d+)\s+([0-9A-Fa-f]{6})$/);
    if (!m) throw new Error(`gen-catalog: cannot parse line: ${JSON.stringify(raw)}`);
    entries.push({ code: m[1] + m[2], series: m[1], hex: m[3].toUpperCase() });
  }
  return entries;
}

export function validateCatalog(entries) {
  if (entries.length !== 291) {
    throw new Error(`gen-catalog: expected 291 entries, got ${entries.length}`);
  }
  const counts = {};
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.code)) throw new Error(`gen-catalog: duplicate code ${e.code}`);
    seen.add(e.code);
    counts[e.series] = (counts[e.series] ?? 0) + 1;
  }
  for (const [series, want] of Object.entries(EXPECTED_COUNTS)) {
    if (counts[series] !== want) {
      throw new Error(`gen-catalog: series ${series} expected ${want}, got ${counts[series] ?? 0}`);
    }
  }
  const extra = Object.keys(counts).filter((s) => !(s in EXPECTED_COUNTS));
  if (extra.length) throw new Error(`gen-catalog: unexpected series: ${extra.join(', ')}`);
}

export function generate() {
  const entries = parseCatalog(readFileSync(SRC, 'utf8'));
  validateCatalog(entries);
  const json = JSON.stringify(entries, null, 2) + '\n';
  for (const out of OUT_FILES) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, json, 'utf8');
  }
  return entries.length;
}

const invokedDirectly =
  process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/gen-catalog.mjs');
if (invokedDirectly) {
  const n = generate();
  console.log(`gen-catalog: wrote ${n} colours to ${OUT_FILES.length} files`);
}
