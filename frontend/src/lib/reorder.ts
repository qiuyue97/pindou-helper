/**
 * 拖拽排序的那一点算术。
 *
 * 抽出来是因为拖动本身（指针、命中、长按）在 jsdom 下难测，而「挪完之后是什么
 * 顺序」是这件事唯一会算错的地方——纯函数单独钉死，组件那层就只剩「拖到谁身上」
 * 需要验证。
 */

/**
 * 把 `id` 挪到 `target` 现在占的位置上，其余保持相对顺序。
 *
 * 语义是**顶掉**而不是插在前面：拖到谁身上就占谁的位子，被顶的那张往后让一格。
 * 这是拖拽列表的通行行为，也是唯一一种「往前拖」和「往后拖」都不需要用户去想
 * 「插在前面还是后面」的语义。
 *
 * 任何一个 id 不在列表里、或者两个是同一个，都原样返回——拖到自己身上不该有变化。
 */
export function moveTo(ids: number[], id: number, target: number): number[] {
  const from = ids.indexOf(id);
  const to = ids.indexOf(target);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
