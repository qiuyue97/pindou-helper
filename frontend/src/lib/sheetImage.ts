import type { Sheet } from '../api/types';

/**
 * 图纸图片的 URL。**必须带上这个记号，不能光靠 id。**
 *
 * `sheets.id` 是 SQLite 的 rowid，没加 AUTOINCREMENT——删掉最大的那一行就把号腾
 * 出来了。所以「删掉 #17，再传一张新的」，新的那张**还是 #17**：
 *
 *     /api/sheets/17/thumb        删之前的那张
 *     /api/sheets/17/thumb        删之后新传的那张   ← 一模一样的 URL
 *
 * 而缩略图那个响应带着 `max-age=86400`（有意为之：一屏十几张，不缓存的话每次进
 * 列表都要重新解一遍几 MB 的原图）。两件事撞在一起，浏览器整整一天都不会再来问
 * 一次，用户在「我的图纸」里看到的还是被删掉那张的缩略图。
 *
 * 记号取 `created_at`：它是**这张图纸**的身份，id 被重用时它一定变，而重新识别、
 * 重新生成、改名、排序都不会动它——图片没换，缓存就该继续有效。
 */
function stamp(sheet: Pick<Sheet, 'created_at'>): number {
  const t = Date.parse(sheet.created_at);
  return Number.isNaN(t) ? 0 : t;
}

/** 列表里用的小图。 */
export function thumbUrl(sheet: Pick<Sheet, 'id' | 'created_at'>): string {
  return `/api/sheets/${sheet.id}/thumb?v=${stamp(sheet)}`;
}

/** 原图。前端裁格子、画网格都取它。 */
export function imageUrl(sheet: Pick<Sheet, 'id' | 'created_at'>): string {
  return `/api/sheets/${sheet.id}/image?v=${stamp(sheet)}`;
}
