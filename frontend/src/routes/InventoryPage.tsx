import { ClipboardCheck, PackageMinus, PackagePlus, Sparkles, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import BatchDialog from '../components/BatchDialog';
import CheckDialog from '../components/CheckDialog';
import InventoryTable from '../components/InventoryTable';
import SmartControlDialog from '../components/SmartControlDialog';
import StockoutView from '../components/StockoutView';
import ThresholdControl from '../components/ThresholdControl';
import type { CandidateSet } from '../color/match';
import VipBadge from '../components/VipBadge';
import { useVip } from '../state/useVip';
import { usePatternJobs } from '../api/hooks';

type Dialog = 'smart' | 'batch-add' | 'batch-deduct' | 'check' | null;

export default function InventoryPage() {
  const { isVip, guard } = useVip();
  const { data: patterns } = usePatternJobs(isVip);
  // 后台识别完成但还没看过 —— 在按钮上点个红点提示。
  const unseen = patterns?.unseen ?? 0;
  const [dialog, setDialog] = useState<Dialog>(null);
  // Also decides what an ALL row in the batch dialogs covers.
  const [scopeSet, setScopeSet] = useState<CandidateSet>('221');
  const close = () => setDialog(null);

  return (
    <section aria-label="库存">
      <div className="toolbar">
        <div className="scope-picker" role="radiogroup" aria-label="显示范围">
          {(['221', '291'] as const).map((s) => (
            <label key={s}>
              <input
                type="radio"
                name="inventory-scope"
                checked={scopeSet === s}
                onChange={() => setScopeSet(s)}
                aria-label={s === '221' ? '221（A–M）' : '291（全部）'}
              />
              {s === '221' ? '221（A–M）' : '291（全部）'}
            </label>
          ))}
        </div>
        {/* Replaces the old 添加色号 button, which only duplicated what editing a
            quantity in the table below already does. */}
        <button
          type="button"
          className={`vip-action${isVip ? '' : ' is-locked'}`}
          onClick={guard(() => setDialog('smart'))}
        >
          <Sparkles size={15} aria-hidden="true" />
          智能管控
          <VipBadge locked={!isVip} />
        </button>
        <button type="button" onClick={() => setDialog('batch-add')}>
          <PackagePlus size={15} aria-hidden="true" />
          批量补货
        </button>
        <button type="button" onClick={() => setDialog('batch-deduct')}>
          <PackageMinus size={15} aria-hidden="true" />
          批量扣减
        </button>
        <button type="button" className="with-dot" onClick={() => setDialog('check')}>
          <ClipboardCheck size={15} aria-hidden="true" />
          按图扣减
          {unseen > 0 && (
            <span className="dot" aria-label={`${unseen} 个识别结果待查看`} role="status" />
          )}
        </button>
        <ThresholdControl />
      </div>

      <InventoryTable scopeSet={scopeSet} />

      <h2 className="section-h">
        <TriangleAlert size={17} aria-hidden="true" />
        缺货清单
      </h2>
      <StockoutView />

      {dialog === 'smart' && <SmartControlDialog onClose={close} />}
      {dialog === 'batch-add' && <BatchDialog mode="add" scopeSet={scopeSet} onClose={close} />}
      {dialog === 'batch-deduct' && (
        <BatchDialog mode="deduct" scopeSet={scopeSet} onClose={close} />
      )}
      {dialog === 'check' && <CheckDialog onClose={close} />}
    </section>
  );
}
