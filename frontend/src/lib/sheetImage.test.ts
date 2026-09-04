/**
 * 图纸图片的 URL。
 *
 * 这里钉的是一个很容易被当成「多余」而删掉的东西：URL 上的 `?v=`。
 * 没有它就有一个真实的 bug——`sheets.id` 是 SQLite 的 rowid，没加 AUTOINCREMENT，
 * 删掉最大的那一行就把号腾出来了，于是「删掉 #17 再传一张」新的那张还是 #17，
 * 缩略图 URL 一模一样，而那个响应带着一天的强缓存。
 */
import { describe, expect, it } from 'vitest';
import { imageUrl, thumbUrl } from './sheetImage';

const at = (created_at: string, id = 17) => ({ id, created_at });

describe('thumbUrl', () => {
  it('指向缩略图接口，不是几 MB 的原图', () => {
    expect(thumbUrl(at('2026-09-04T01:05:03Z'))).toContain('/api/sheets/17/thumb');
  });

  it('同一个 id 上的两张图纸，URL 必须不同——否则浏览器会端出被删那张的缩略图', () => {
    const before = thumbUrl(at('2026-09-04T01:05:03Z'));
    const after = thumbUrl(at('2026-09-04T16:20:00Z')); // 删掉之后重传，id 被重用
    expect(after).not.toBe(before);
  });

  it('同一张图纸每次都是同一个 URL——不然缓存等于白加', () => {
    expect(thumbUrl(at('2026-09-04T01:05:03Z'))).toBe(thumbUrl(at('2026-09-04T01:05:03Z')));
  });

  it('不同图纸各是各的', () => {
    const a = { id: 1, created_at: '2026-09-04T01:05:03Z' };
    const b = { id: 2, created_at: '2026-09-04T01:05:03Z' };
    expect(thumbUrl(a)).not.toBe(thumbUrl(b));
  });

  it('时间戳坏掉也给得出一个能用的 URL，不会拼出 NaN', () => {
    const url = thumbUrl(at('不是时间'));
    expect(url).toBe('/api/sheets/17/thumb?v=0');
    expect(url).not.toContain('NaN');
  });
});

describe('imageUrl', () => {
  it('指向原图接口', () => {
    expect(imageUrl(at('2026-09-04T01:05:03Z'))).toContain('/api/sheets/17/image');
  });

  it('同样跟着图纸身份走', () => {
    expect(imageUrl(at('2026-09-04T01:05:03Z'))).not.toBe(imageUrl(at('2026-09-05T01:05:03Z')));
  });
});
