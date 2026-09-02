import { useState } from 'react';
import type { PatternJob } from '../api/types';
import { imageIndexOf, isSummaryRow, parseMdTable } from '../lib/mdTable';
import ImageViewer from './ImageViewer';
import Modal from './Modal';

/**
 * The per-image breakdown FastGPT returns as a markdown table. The "图片N"
 * headers are clickable: they open the original image that column came from,
 * which is the only way to check a suspicious number against the source.
 */
export default function PatternTableDialog({
  job,
  onClose,
}: {
  job: PatternJob;
  onClose: () => void;
}) {
  const [viewing, setViewing] = useState<number | null>(null);
  const table = parseMdTable(job.md_table);

  // A failed image keeps its column: the numbers are empty anyway, and hiding
  // it would silently renumber every column after it, so "图片3" in the table
  // would stop meaning the third image the user uploaded.
  const items = job.items ?? [];
  const failed = new Set(
    items.filter((i) => i.status === 'failed' && i.image_index !== null).map((i) => i.image_index!),
  );
  const reasonOf = (imageIndex: number) =>
    items.find((i) => i.image_index === imageIndex)?.error || '识别失败';
  // Anything the user should read: what failed, and what a compression cost.
  const problems = items.filter((i) => i.status === 'failed' || i.notes.length > 0);

  return (
    <>
      <Modal
        title="各图色号明细"
        onClose={onClose}
        footer={
          <button type="button" onClick={onClose}>
            关闭
          </button>
        }
      >
        {job.note && <p className="muted">{job.note}</p>}
        {!table ? (
          <p className="muted">这条记录没有明细表。</p>
        ) : (
          <div className="table-scroll">
            <table aria-label="各图色号明细" className="preview pattern-table">
              <thead>
                <tr>
                  {table.headers.map((h, i) => {
                    const imageIndex = imageIndexOf(h);
                    const bad = imageIndex !== null && failed.has(imageIndex);
                    return (
                      <th key={`${h}-${i}`} className={bad ? 'failed-col' : undefined}>
                        {imageIndex === null ? (
                          h
                        ) : (
                          // 认不出来的那张照样能点开——用户第一件想做的事就是
                          // 亲眼看看它到底怎么了
                          <button
                            type="button"
                            className="linklike"
                            title={bad ? reasonOf(imageIndex) : undefined}
                            onClick={() => setViewing(imageIndex)}
                          >
                            {h}
                            {bad && ' ⚠'}
                          </button>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i} className={isSummaryRow(row) ? 'summary-row' : undefined}>
                    {row.map((cell, j) => {
                      // 第 0 列是色号，之后每一列对应一张图
                      const imageIndex = imageIndexOf(table.headers[j] ?? '');
                      const bad = imageIndex !== null && failed.has(imageIndex);
                      return (
                        <td key={j} className={bad ? 'failed-col' : undefined}>
                          {cell || '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {problems.length > 0 && (
          <ul className="pattern-problems">
            {problems.map((it) => (
              <li key={it.index} className={it.status === 'failed' ? 'error' : 'muted'}>
                {it.image_index === null ? '' : `图片${it.image_index + 1} · `}
                {it.filename}
                {it.status === 'failed' ? `：${it.error || '识别失败'}` : ''}
                {it.notes.map((n) => (
                  <div key={n} className="muted">
                    {n}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {viewing !== null && (
        <Modal
          title={`图片 ${viewing + 1}`}
          onClose={() => setViewing(null)}
          footer={
            <button type="button" onClick={() => setViewing(null)}>
              关闭
            </button>
          }
        >
          <ImageViewer
            src={`/api/patterns/${job.id}/images/${viewing}`}
            alt={`识别用的第 ${viewing + 1} 张图`}
          />
        </Modal>
      )}
    </>
  );
}
