import { useMemo } from 'react';
import type { EffectiveColor } from '../color/catalog';
import { hexToLab } from '../color/color';
import { euclideanRanking, mahalanobisRanking, type DebugRow } from '../color/debugMetrics';

function Table({ label, rows }: { label: string; rows: DebugRow[] }) {
  return (
    <table aria-label={label} className="preview">
      <thead>
        <tr>
          <th>色号</th>
          <th>距离</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 5).map((r) => (
          <tr key={r.code}>
            <td>{r.code}</td>
            <td>{r.distance.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AdvancedMetricsPanel({
  sampleHex,
  candidates,
}: {
  sampleHex: string;
  candidates: EffectiveColor[];
}) {
  const lab = useMemo(() => hexToLab(sampleHex), [sampleHex]);
  const maha = useMemo(() => mahalanobisRanking(lab, candidates), [lab, candidates]);
  const euclid = useMemo(() => euclideanRanking(lab, candidates), [lab, candidates]);

  return (
    <details className="advanced">
      <summary>对照指标（开发用）</summary>
      <p className="muted">正式结论用 CIEDE2000 + 局部间距归一化；这里只是开发期对照。</p>
      <div className="advanced-tables">
        <Table label="马氏距离" rows={maha} />
        <Table label="纯欧氏（旧版对照）" rows={euclid} />
      </div>
    </details>
  );
}
