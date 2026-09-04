import { describe, expect, it } from 'vitest';
import { moveTo } from './reorder';

describe('moveTo', () => {
  it('往后拖：占掉目标的位子，被顶的往前让', () => {
    expect(moveTo([1, 2, 3, 4], 1, 3)).toEqual([2, 3, 1, 4]);
  });

  it('往前拖：同样占掉目标的位子', () => {
    expect(moveTo([1, 2, 3, 4], 4, 2)).toEqual([1, 4, 2, 3]);
  });

  it('拖到自己身上什么都不变', () => {
    const ids = [1, 2, 3];
    expect(moveTo(ids, 2, 2)).toBe(ids);
  });

  it('拖到第一个位置', () => {
    expect(moveTo([1, 2, 3], 3, 1)).toEqual([3, 1, 2]);
  });

  it('列表里没有的 id 原样返回，不制造空洞', () => {
    const ids = [1, 2, 3];
    expect(moveTo(ids, 9, 2)).toBe(ids);
    expect(moveTo(ids, 1, 9)).toBe(ids);
  });

  it('不改原数组', () => {
    const ids = [1, 2, 3];
    moveTo(ids, 1, 3);
    expect(ids).toEqual([1, 2, 3]);
  });
});
