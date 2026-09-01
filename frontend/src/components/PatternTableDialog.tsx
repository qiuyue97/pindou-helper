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
                    return (
                      <th key={`${h}-${i}`}>
                        {imageIndex === null ? (
                          h
                        ) : (
                          <button
                            type="button"
                            className="linklike"
                            onClick={() => setViewing(imageIndex)}
                          >
                            {h}
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
                    {row.map((cell, j) => (
                      <td key={j}>{cell || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
