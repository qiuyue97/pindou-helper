import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCatalog, validateCatalog } from './gen-catalog.mjs';

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(FRONTEND, '..');

const EXPECTED_COUNTS = {
  A: 26, B: 32, C: 29, D: 26, E: 24, F: 25, G: 21, H: 23,
  M: 15, P: 23, Q: 5, R: 28, T: 1, Y: 5, ZG: 8,
};

test('parses shared/mard-291.txt into 291 valid entries', () => {
  const text = readFileSync(resolve(REPO, 'shared/mard-291.txt'), 'utf8');
  const entries = parseCatalog(text);
  expect(entries).toHaveLength(291);

  const counts = {};
  for (const e of entries) {
    expect(e.hex).toMatch(/^[0-9A-F]{6}$/);
    expect(e.code.startsWith(e.series)).toBe(true);
    counts[e.series] = (counts[e.series] ?? 0) + 1;
  }
  expect(counts).toEqual(EXPECTED_COUNTS);
  expect(() => validateCatalog(entries)).not.toThrow();
});

test('committed catalog.json files equal a fresh parse', () => {
  const text = readFileSync(resolve(REPO, 'shared/mard-291.txt'), 'utf8');
  const fresh = parseCatalog(text);
  for (const rel of ['frontend/src/data/catalog.json', 'backend/app/catalog.json']) {
    const onDisk = JSON.parse(readFileSync(resolve(REPO, rel), 'utf8'));
    expect(onDisk).toEqual(fresh);
  }
});
