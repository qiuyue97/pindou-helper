import { ImagePlus, Loader2, Table2, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, apiSend, apiUpload } from '../api/client';
import { useApiMutation, usePatternJobs } from '../api/hooks';
import type { BatchOut, CheckLineResult, CheckOut, PatternJob } from '../api/types';
import { formatChanges } from '../lib/qty';
import { useToast } from '../state/ToastContext';
import { useVip } from '../state/useVip';
import Modal from './Modal';
import PatternTableDialog from './PatternTableDialog';
import VipBadge from './VipBadge';

/** Max images a VIP account may attach to one check. Matches the plugin's own maxFiles. */
export const MAX_IMAGES = 10;

function describeResult(r: CheckLineResult): string {
  switch (r.status) {
    case 'enough':
      return `足够（现有 ${r.have}）`;
    case 'short':
      return `还差 ${(r.need ?? 0) - (r.have ?? 0)}（现有 ${r.have}）`;
    case 'unknown_code':
      return '色号不存在';
    case 'bad_quantity':
      return '数量应为正整数';
    default:
      return '格式错误';
  }
}

/** A line can be deducted as long as it names a real code and a real quantity.
 *  "short" still counts — the inventory is allowed to go negative on purpose. */
function isDeductible(r: CheckLineResult): boolean {
  return r.status === 'enough' || r.status === 'short';
}

/** Shortages first, then anything malformed, then the rows that are fine.
 *  The whole point of checking is to find what you are missing, so those must
 *  not be buried below a hundred rows that are already covered. */
function urgency(r: CheckLineResult): number {
  if (r.status === 'short') return 0;
  if (r.status !== 'enough') return 1;
  return 2;
}

function byUrgency(rows: CheckLineResult[]): CheckLineResult[] {
  // Stable sort, so within a group the original order is kept.
  return [...rows].sort((a, b) => urgency(a) - urgency(b));
}

export default function CheckDialog({ onClose }: { onClose: () => void }) {
  const { show } = useToast();
  const { isVip, guard } = useVip();
  const [text, setText] = useState('');
  const [results, setResults] = useState<CheckLineResult[] | null>(null);
  const [images, setImages] = useState<{ url: string; name: string; file: File }[]>([]);
  const [starting, setStarting] = useState(false);
  const [tableJob, setTableJob] = useState<PatternJob | null>(null);
  const qc = useQueryClient();
  const { data: patterns } = usePatternJobs(isVip);

  // Object URLs are leaked until revoked, so drop them when the dialog closes.
  useEffect(() => () => images.forEach((i) => URL.revokeObjectURL(i.url)), [images]);

  const check = useApiMutation(
    (body: { text: string }) => apiSend<CheckOut>('POST', '/api/inventory/check', body),
    { invalidate: false },
  );

  const applyDeduct = useApiMutation((body: { mode: 'deduct'; text: string }) =>
    apiSend<BatchOut>('POST', '/api/inventory/batch', body),
  );

  async function run() {
    const res = await check.mutateAsync({ text });
    setResults(res.results);
  }

  async function deduct() {
    // The same text the check just ran on, applied as an ordinary batch deduct
    // so it lands in the operation history and stays undoable like everything else.
    const res = await applyDeduct.mutateAsync({ mode: 'deduct', text });
    if (!res.applied) {
      show('扣减失败，请重新核对');
      return;
    }
    show(formatChanges(res.changes));
    onClose();
  }

  function onPickImages(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = MAX_IMAGES - images.length;
    if (room <= 0) {
      show(`最多上传 ${MAX_IMAGES} 张`);
      return;
    }
    const picked = Array.from(files).slice(0, room);
    if (picked.length < files.length) show(`最多上传 ${MAX_IMAGES} 张，多出的已忽略`);
    setImages((prev) => [
      ...prev,
      ...picked.map((f) => ({ url: URL.createObjectURL(f), name: f.name, file: f })),
    ]);
  }

  function removeImage(idx: number) {
    setImages((prev) => {
      const gone = prev[idx];
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function startRecognition() {
    const form = new FormData();
    images.forEach((i) => form.append('files', i.file, i.name));
    setStarting(true);
    try {
      await apiUpload<PatternJob>('/api/patterns', form);
      // 识别在后台跑，可能很久。弹窗可以随便关，结果好了按钮上会有红点。
      show('已开始识别，可以先去做别的，好了会在「按图扣减」上提示');
      images.forEach((i) => URL.revokeObjectURL(i.url));
      setImages([]);
      await qc.invalidateQueries({ queryKey: ['patterns'] });
    } catch (err) {
      show(err instanceof ApiError ? err.detail : '发起识别失败');
    } finally {
      setStarting(false);
    }
  }

  async function deleteJob(job: PatternJob) {
    try {
      await apiSend<void>('DELETE', `/api/patterns/${job.id}`);
      await qc.invalidateQueries({ queryKey: ['patterns'] });
      show('已删除这条识别记录');
    } catch (err) {
      show(err instanceof ApiError ? err.detail : '删除失败');
    }
  }

  async function loadJob(job: PatternJob) {
    setText(job.bead_list);
    setResults(null);
    try {
      await apiSend<PatternJob>('POST', `/api/patterns/${job.id}/seen`);
      await qc.invalidateQueries({ queryKey: ['patterns'] });
    } catch {
      // 标记已读失败只是红点不灭，不该挡住用户把清单填进去
    }
  }

  const jobs = patterns?.jobs ?? [];
  const canDeduct = results !== null && results.length > 0 && results.every(isDeductible);

  return (
    <Modal
      title="按图扣减"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            关闭
          </button>
          <button type="button" onClick={() => void run()}>
            核对
          </button>
          <button
            type="button"
            className="primary"
            disabled={!canDeduct || applyDeduct.isPending}
            title={canDeduct ? '按核对出的需求扣减豆仓' : '先核对，且所有行都要有效'}
            onClick={() => void deduct()}
          >
            应用扣减
          </button>
        </>
      }
    >
      <label htmlFor="check-text">
        每行一条，格式 <code>色号,数量</code>
      </label>
      <textarea
        id="check-text"
        aria-label="需求清单"
        rows={8}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          // The old results describe the old text; keep them from being applied.
          setResults(null);
        }}
      />

      <div className={`vip-block${isVip ? '' : ' is-locked'}`}>
        <div className="vip-block-head">
          <VipBadge locked={!isVip} />
          <span>拼豆图纸AI抽取</span>
          <span className="muted">最多 {MAX_IMAGES} 张</span>
        </div>

        {isVip ? (
          <>
            <label className="image-drop" htmlFor="check-images">
              <ImagePlus size={16} aria-hidden="true" />
              选择图片（{images.length}/{MAX_IMAGES}）
            </label>
            <input
              id="check-images"
              aria-label="上传图片"
              type="file"
              accept="image/*"
              multiple
              className="visually-hidden"
              disabled={images.length >= MAX_IMAGES}
              onChange={(e) => {
                onPickImages(e.target.files);
                // Let the same file be picked again after a removal.
                e.target.value = '';
              }}
            />
            {images.length > 0 && (
              <button
                type="button"
                className="primary start-recognise"
                disabled={starting}
                onClick={() => void startRecognition()}
              >
                {starting ? '提交中…' : `开始识别（${images.length} 张）`}
              </button>
            )}
            {images.length > 0 && (
              <ul className="image-grid" aria-label="已选图片">
                {images.map((img, i) => (
                  <li key={img.url}>
                    <img src={img.url} alt={img.name} />
                    <button
                      type="button"
                      aria-label={`移除 ${img.name}`}
                      onClick={() => removeImage(i)}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {jobs.length > 0 && (
              <ul className="job-list" aria-label="识别任务">
                {jobs.map((job) => (
                  <li key={job.id} className={job.seen ? undefined : 'is-unseen'}>
                    <span className="job-note">
                      {job.status === 'failed' ? (
                        <span className="error">识别失败：{job.error}</span>
                      ) : job.status === 'done' ? (
                        // 没抽到东西时 note 就是模型解释原因的那句话，照原样给用户。
                        <span className={job.extracted ? undefined : 'muted'}>
                          {job.note || `${job.image_count} 张图`}
                        </span>
                      ) : (
                        <span className="muted">
                          <Loader2 size={12} className="spin" aria-hidden="true" />
                          识别中（{job.image_count} 张）…可以关掉这个窗口
                        </span>
                      )}
                    </span>
                    {job.status === 'done' && job.extracted && (
                      <>
                        <button
                          type="button"
                          className="ghost icon-only"
                          aria-label="查看各图明细"
                          title="查看各图明细"
                          onClick={() => setTableJob(job)}
                        >
                          <Table2 size={14} aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => void loadJob(job)}>
                          填入清单
                        </button>
                      </>
                    )}
                    {job.status !== 'running' && job.status !== 'pending' && (
                      <button
                        type="button"
                        className="ghost icon-only danger"
                        aria-label="删除这条记录"
                        title="删除这条记录"
                        onClick={() => void deleteJob(job)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <button type="button" className="vip-locked-cta" onClick={guard(() => {})}>
            <ImagePlus size={16} aria-hidden="true" />
            上传拼豆图纸，AI 抽取需求
          </button>
        )}
      </div>

      {results && (
        <table aria-label="核对结果" className="preview">
          <thead>
            <tr>
              <th>色号</th>
              <th>需求</th>
              <th>结果</th>
            </tr>
          </thead>
          <tbody>
            {byUrgency(results).map((r) => (
              <tr key={r.line} className={r.status === 'enough' ? undefined : 'bad'}>
                <td>{r.code ?? '—'}</td>
                <td>{r.need ?? '—'}</td>
                <td>{describeResult(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tableJob && <PatternTableDialog job={tableJob} onClose={() => setTableJob(null)} />}
    </Modal>
  );
}
