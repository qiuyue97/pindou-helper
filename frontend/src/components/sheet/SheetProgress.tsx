import type { Sheet } from '../../api/types';

/**
 * 流水线的几步，和后端的分段权重一一对齐。
 *
 * **两条路的步骤完全不同**，不能共用一份：识别是「取样 → 聚类 → OCR 读色号 →
 * 和图例对账」，生成是「归拢像素 → 配色卡 → 清理孤点」，中间根本没有 OCR 也没有
 * 图例。一度共用识别那一份，于是生成到 75% 时界面写着「正在识别色号」，货不对板。
 */
const PHASES = {
  recognise: [
    { at: 5, label: '读取图片' },
    { at: 15, label: '逐格取样' },
    { at: 35, label: '归拢颜色' },
    { at: 45, label: '识别色号' },
    { at: 92, label: '对账定案' },
  ],
  generate: [
    { at: 10, label: '读取图片' },
    { at: 30, label: '归拢像素' },
    { at: 75, label: '配色卡' },
    { at: 90, label: '清理孤点' },
  ],
} as const;

/**
 * 识别中的进度。
 *
 * 原来这里只有一句「正在识别，这可能要一两分钟。可以先去做别的，回来结果还在。」
 * ——一句话之后什么都不动，用户分不出是在排队、在算、还是已经卡死了，只能反复
 * 刷新。现在报的是后端真的走到哪一步了（`step`/`progress` 每一步落库，前端本来
 * 就在轮询）。
 *
 * 进度是**分段权重**不是线性时间：耗时几乎全压在 OCR 那一段，所以 45→85 这一整
 * 段留给它按页爬。宁可爬得慢，也别冲到 99 再卡住——那比没有进度条更像死机。
 *
 * 排队等闸门时 `progress` 是 0：那时什么都没发生，条就该是空的，文案也直说在排队。
 */
export default function SheetProgress({ sheet }: { sheet: Sheet }) {
  const phases = PHASES[sheet.kind] ?? PHASES.recognise;
  const queued = sheet.status === 'pending' || sheet.progress === 0;
  const pct = Math.max(0, Math.min(100, sheet.progress));
  // 每一步的刻度是它**开始**时的百分比，所以「当前那一步」是最后一个已经到达刻度
  // 的那个，不是下一个。OCR 这段跨 45→85，中间报到 61% 时仍然是「识别色号」在做
  // ——一度写成「过了刻度就算走完」，于是 61% 显示成「对账定案」，全错位。
  const reached = phases.filter((p) => pct >= p.at).length;
  const now = pct >= 100 ? phases.length : reached - 1;

  return (
    <section className="sheet-progress" aria-label="识别进度">
      <div className="sheet-progress-head">
        <span className="spinner" aria-hidden="true" />
        <strong>
          {sheet.step || (queued ? '排队中' : verb(sheet))}
        </strong>
        <span className="muted sheet-progress-pct">{pct}%</span>
      </div>

      <div
        className="bar"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="识别进度"
      >
        {/* 排队时不画条：那时确实什么都没发生 */}
        <span className={`bar-fill${queued ? ' idle' : ''}`} style={{ width: `${pct}%` }} />
      </div>

      <ol className="sheet-steps">
        {phases.map((p, i) => (
          <li key={p.label} className={i < now ? 'done' : i === now ? 'now' : ''}>
            {p.label}
          </li>
        ))}
      </ol>

      <p className="muted">可以先去做别的，回来结果还在。</p>
    </section>
  );
}

function verb(sheet: Sheet): string {
  return sheet.kind === 'generate' ? '正在生成' : '正在识别';
}
