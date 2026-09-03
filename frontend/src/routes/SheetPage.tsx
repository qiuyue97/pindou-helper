import { useState } from 'react';
import { apiSend } from '../api/client';
import { useSheet } from '../api/hooks';
import type { Sheet, SheetGuess } from '../api/types';
import BatchDialog from '../components/BatchDialog';
import CellReview from '../components/sheet/CellReview';
import GridConfirm, { type Geometry } from '../components/sheet/GridConfirm';
import ReconcileTable from '../components/sheet/ReconcileTable';
import SheetCanvas from '../components/sheet/SheetCanvas';
import SheetUpload from '../components/sheet/SheetUpload';
import { byCode } from '../lib/sheetSort';
import { useToast } from '../state/ToastContext';
import { VIP_UPSELL, useVip } from '../state/useVip';

/**
 * 图纸识别（VIP）：上传 → 确认网格 → 校对。
 *
 * 识别不出来**不是失败**。MinerU 挂了、没配 token、这张图的颜色是一段连续谱，
 * 产出的都是一张全红的矩阵——那是正常产出，用户可以从零改。界面要如实说明
 * 发生了什么，而不是报错了事。
 */
export default function SheetPage({ sheetId = null }: { sheetId?: number | null }) {
  const { isVip } = useVip();
  const { show } = useToast();
  const [guess, setGuess] = useState<SheetGuess | null>(null);
  const [id, setId] = useState<number | null>(sheetId);
  const [deducting, setDeducting] = useState(false);
  const { data: sheet } = useSheet(id, isVip);

  if (!isVip) {
    return (
      <main className="app-main">
        <p>{VIP_UPSELL}</p>
      </main>
    );
  }

  async function patch(path: string, body: unknown) {
    try {
      await apiSend('PATCH', `/api/sheets/${id}${path}`, body);
    } catch (e) {
      show(e instanceof Error ? e.message : '修改失败');
    }
  }

  async function start(g: Geometry) {
    if (!guess) return;
    try {
      await apiSend('POST', `/api/sheets/${guess.id}/recognise`, g);
      setId(guess.id);
    } catch (e) {
      show(e instanceof Error ? e.message : '无法开始识别');
    }
  }

  const beadList = sheet
    ? Object.keys(sheet.tally)
        .sort(byCode)
        .map((c) => `${c}, ${sheet.tally[c]}`)
        .join('\n')
    : '';

  return (
    <main className="app-main sheet-page">
      {!guess && !sheet && (
        <SheetUpload
          onUploaded={(g) => {
            setGuess(g);
            setId(null);
          }}
        />
      )}

      {guess && !id && <GridConfirm guess={guess} onConfirm={start} />}

      {sheet && (sheet.status === 'pending' || sheet.status === 'running') && (
        <p>正在识别，这可能要一两分钟。可以先去做别的，回来结果还在。</p>
      )}

      {sheet?.status === 'failed' && <p className="error">{sheet.error}</p>}

      {sheet?.status === 'done' && (
        <>
          <Notices sheet={sheet} />
          {/* 完整图纸在最上面：用户先看整体，再往下看细节 */}
          <SheetCanvas sheet={sheet} />
          <div className="sheet-actions">
            <button type="button" onClick={() => setDeducting(true)}>
              把这份清单送去按图扣减
            </button>
          </div>
          <ReconcileTable
            sheet={sheet}
            onPatchClasses={(patches) => void patch('/classes', { patches })}
            onPatchPrior={(prior) => void patch('/prior', { prior })}
          />
          <CellReview
            sheet={sheet}
            onPatchCells={(patches) => void patch('/cells', { patches })}
          />
        </>
      )}

      {deducting && sheet && (
        <BatchDialog
          mode="deduct"
          scopeSet={sheet.palette}
          includeCustom={false}
          initialText={beadList}
          onClose={() => setDeducting(false)}
        />
      )}
    </main>
  );
}

/** 把这次识别到底发生了什么如实说清楚。 */
function Notices({ sheet }: { sheet: Sheet }) {
  const notes: string[] = [];
  if (!sheet.structured) {
    notes.push(
      '这张图没有颜色结构：格子太小或有水印，填充色是一段连续的渐变而不是几十个' +
        '分立的颜色，所以没有做文字识别，每一格的色号都是按颜色猜的。',
    );
  } else if (sheet.engine === 'colour-only') {
    notes.push('没有读出色号（识别服务不可用），每一格的色号都是按颜色猜的。');
  }
  if (Object.keys(sheet.prior).length === 0) {
    notes.push('没有拿到图例的色号数量，所以这次没有第二份证据可以对账。');
  }
  if (notes.length === 0) return null;
  return (
    <ul className="sheet-notices">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}
