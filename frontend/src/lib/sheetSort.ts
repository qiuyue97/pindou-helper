/**
 * 按色号分组，按告警级别排序。
 *
 * 这里有一条容易搞反的判断：**一个色号名下有多个颜色类是常态。** 聚类的切口
 * 故意偏紧（裂开只多一次 OCR，合并是给整类一个错答案），所以裂是设计出来的
 * 预期结果。两个类独立读出同一个色号，这是一致的证据——相信 OCR，合并。
 *
 * 例外只有一个：这些类彼此颜色差超过阈值（后端在 `dup` 里给出）。那时它们不可能
 * 是同一个色号，两个读数里至少有一个错了。
 */
import type { SheetClass, SheetLevel } from '../api/types';

/** 多个同时成立时取最严重的。数字越大越严重。 */
export const LEVEL_RANK: Record<SheetLevel, number> = {
  ok: 0,
  warn: 1,
  count: 2,
  guess: 3,
};

/** 每一级为什么会亮。给用户看的，所以说人话。 */
export const LEVEL_WHY: Record<SheetLevel, string> = {
  ok: '',
  warn: '颜色与色卡对不上，或读数有争议',
  count: '与图例的数量对不上',
  guess: '未读出色号，这是按颜色猜的',
};

/**
 * 「这一格就是空的」的写法，和后端的 matrix.BLANK 是同一个记号。
 *
 * 空串不能用——它已经被「撤销这一格的人工修正」占了。有空格子的图纸上，用户要能
 * 把一格改成空白（生成器把空格印成了浅色，识别成了某个色号）。
 */
export const BLANK_CODE = '-';

const CODE_RE = /^([A-Za-z]*)(\d*)(.*)$/;

/** 先系列 A–Z，再序号升序。不能直接按字符串排——那样 A10 会排在 A2 前面。 */
export function codeKey(code: string): [string, number, string] {
  const m = CODE_RE.exec(code.trim());
  if (!m) return [code, 0, ''];
  return [m[1]!.toUpperCase(), m[2] ? Number(m[2]) : 0, m[3]!];
}

export function byCode(a: string, b: string): number {
  const [as, an, ar] = codeKey(a);
  const [bs, bn, br] = codeKey(b);
  if (as !== bs) return as < bs ? -1 : 1;
  if (an !== bn) return an - bn;
  return ar < br ? -1 : ar > br ? 1 : 0;
}

export interface CodeGroup {
  code: string;
  classes: SheetClass[];
  /** 名下所有类的格子数之和 */
  n: number;
  level: SheetLevel;
  /** 名下类心色两两 dE00 的最大值；null = 它们本来就该是一个色号 */
  spread: number | null;
  /** 名下所有类的成员格子，按扁平下标升序 */
  cells: number[];
}

export function groupByCode(classes: SheetClass[]): CodeGroup[] {
  const by = new Map<string, SheetClass[]>();
  for (const c of classes) {
    const list = by.get(c.code);
    if (list) list.push(c);
    else by.set(c.code, [c]);
  }
  const groups: CodeGroup[] = [];
  for (const [code, list] of by) {
    groups.push({
      code,
      classes: list,
      n: list.reduce((s, c) => s + c.n, 0),
      level: list.reduce<SheetLevel>(
        (worst, c) => (LEVEL_RANK[c.level] > LEVEL_RANK[worst] ? c.level : worst),
        'ok',
      ),
      spread: list.find((c) => c.dup != null)?.dup ?? null,
      cells: list.flatMap((c) => c.cells).sort((a, b) => a - b),
    });
  }
  // 告警优先：用户第一眼该看到的是最需要他决定的东西
  groups.sort((a, b) => {
    const d = LEVEL_RANK[b.level] - LEVEL_RANK[a.level];
    return d !== 0 ? d : byCode(a.code, b.code);
  });
  return groups;
}
