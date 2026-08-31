import { describe, expect, test } from 'vitest';
import { normalize, parseLines } from './parseLines';

describe('normalize', () => {
  test('folds Chinese punctuation and spacing', () => {
    expect(normalize('A1，100')).toBe('A1,100');
    expect(normalize('A1　100')).toBe('A1 100');
    expect(normalize('A1 , 100')).toBe('A1,100');
  });
});

describe('parseLines', () => {
  test('accepts comma and whitespace separators, upper-cases codes', () => {
    expect(parseLines('A1,100\nb2 50\n C3 , 7 ').map((l) => [l.code, l.qty, l.status])).toEqual([
      ['A1', 100, 'ok'],
      ['B2', 50, 'ok'],
      ['C3', 7, 'ok'],
    ]);
  });

  test('skips blank lines but keeps 1-based line numbers', () => {
    expect(parseLines('A1,1\n\n\nA2,2').map((l) => [l.lineNo, l.code])).toEqual([
      [1, 'A1'],
      [4, 'A2'],
    ]);
  });

  test('flags malformed rows the same way the backend does', () => {
    expect(parseLines('A1\nA2,0\nA3,-4\nA4,x\nA5,1,2').map((l) => l.status)).toEqual([
      'format_error',
      'bad_quantity',
      'bad_quantity',
      'bad_quantity',
      'format_error',
    ]);
  });
});
