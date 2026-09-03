import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiSend } from '../api/client';
import { useSheet, useSheets } from '../api/hooks';
import type { Sheet, SheetGuess } from '../api/types';
import BatchDialog from '../components/BatchDialog';
import GridConfirm, { type Geometry } from '../components/sheet/GridConfirm';
import SheetExport from '../components/sheet/SheetExport';
import SheetPreview from '../components/sheet/SheetPreview';
import SheetReview from '../components/sheet/SheetReview';
import SheetUpload from '../components/sheet/SheetUpload';
import { byCode } from '../lib/sheetSort';
import { useToast } from '../state/ToastContext';
import { VIP_UPSELL, useVip } from '../state/useVip';

/**
 * 图纸识别（VIP）：上传 → 确认网格 → 校对。
 *
 * **正在识别的图纸放在 URL 里**（/sheet/:sheetId），不放在组件 state 里。
 * 识别是后台线程跑的，界面上写着「可以先去做别的，回来结果还在」——那句话只有
 * 在切走再回来还找得到这张图纸时才算数。存在 state 里的话一卸载就没了，
 * 那是在骗用户。
 *
 * 识别不出来**不是失败**。MinerU 挂了、没配 token、这张图的颜色是一段连续谱，
 * 产出的都是一张全红的矩阵——那是正常产出，用户可以从零改。界面要如实说明
 * 发生了什么，而不是报错了事。
 */
export default function SheetPage() {
  const { isVip } = useVip();
  const { show } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { sheetId } = useParams();
  const id = sheetId ? Number(sheetId) : null;

  const [guess, setGuess] = useState<SheetGuess | null>(null);
  const [deducting, setDeducting] = useState(false);
  const { data: sheet } = useSheet(id, isVip);
  // 上传界面上要列出还没弄完的图纸，否则用户切走一次就再也找不回来
  const { data: recent } = useSheets(isVip && id === null);

  if (!isVip) {
    return (
      <main className="app-main">
        <p>{VIP_UPSELL}</p>
      </main>
    );
  }

  async function patch(path: string, body: unknown) {
    try {
      // 把返回的整张图纸写回缓存。接口返回的就是改完之后的完整状态（含重算过的
      // 对账和 tally），丢掉它就等于改了不刷新——用户改完看不到任何变化。
      const next = await apiSend<Sheet>('PATCH', `/api/sheets/${id}${path}`, body);
      queryClient.setQueryData(['sheet', id], next);
    } catch (e) {
      show(e instanceof Error ? e.message : '修改失败');
    }
  }

  async function start(g: Geometry) {
    if (!guess) return;
    try {
      await apiSend('POST', `/api/sheets/${guess.id}/recognise`, g);
      navigate(`/sheet/${guess.id}`);
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
      {id === null && !guess && (
        <>
          <SheetUpload
            onUploaded={(g) => {
              setGuess(g);
            }}
          />
          <Resume sheets={recent?.sheets ?? []} />
        </>
      )}

      {id === null && guess && <GridConfirm guess={guess} onConfirm={start} />}

      {sheet && (sheet.status === 'pending' || sheet.status === 'running') && (
        <p>正在识别，这可能要一两分钟。可以先去做别的，回来结果还在。</p>
      )}

      {sheet?.status === 'failed' && <p className="error">{sheet.error}</p>}

      {sheet?.status === 'done' && (
        <>
          <Notices sheet={sheet} />
          {/* 完整图纸在最上面：用户先看整体，再往下看细节 */}
          <SheetPreview sheet={sheet} />
          <div className="sheet-actions">
            <button type="button" onClick={() => setDeducting(true)}>
              把这份清单送去按图扣减
            </button>
            <SheetExport sheet={sheet} />
            <button type="button" className="ghost" onClick={() => navigate('/sheet')}>
              识别另一张
            </button>
          </div>
          <SheetReview
            sheet={sheet}
            onPatchClasses={(patches) => void patch('/classes', { patches })}
            onPatchPrior={(prior) => void patch('/prior', { prior })}
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

const STATUS_TEXT: Record<Sheet['status'], string> = {
  pending: '排队中',
  running: '识别中',
  ready: '等待确认网格',
  done: '已完成',
  failed: '失败',
};

/** 最近的图纸，点一下回到它。 */
function Resume({ sheets }: { sheets: Sheet[] }) {
  const navigate = useNavigate();
  if (sheets.length === 0) return null;
  return (
    <div className="sheet-resume">
      <h3>最近的图纸</h3>
      <ul>
        {sheets.map((s) => (
          <li key={s.id}>
            <button type="button" className="linklike" onClick={() => navigate(`/sheet/${s.id}`)}>
              #{s.id} {s.rows}×{s.cols}
            </button>
            <span className={`muted level-${s.status === 'failed' ? 'guess' : 'ok'}`}>
              {STATUS_TEXT[s.status]}
            </span>
            <span className="muted">{new Date(s.created_at).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
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
