import { useState } from 'react';
import AddCodeDialog from '../components/AddCodeDialog';
import BatchDialog from '../components/BatchDialog';
import CheckDialog from '../components/CheckDialog';
import InventoryTable from '../components/InventoryTable';
import StockoutView from '../components/StockoutView';
import ThresholdControl from '../components/ThresholdControl';
import type { CandidateSet } from '../color/match';

type Dialog = 'add' | 'batch-add' | 'batch-deduct' | 'check' | null;

export default function InventoryPage() {
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
        <button type="button" onClick={() => setDialog('add')}>
          添加色号
        </button>
        <button type="button" onClick={() => setDialog('batch-add')}>
          批量补货
        </button>
        <button type="button" onClick={() => setDialog('batch-deduct')}>
          批量扣减
        </button>
        <button type="button" onClick={() => setDialog('check')}>
          需求核对
        </button>
        <ThresholdControl />
      </div>

      <InventoryTable scopeSet={scopeSet} />

      <h2>缺货清单</h2>
      <StockoutView />

      {dialog === 'add' && <AddCodeDialog onClose={close} />}
      {dialog === 'batch-add' && <BatchDialog mode="add" scopeSet={scopeSet} onClose={close} />}
      {dialog === 'batch-deduct' && (
        <BatchDialog mode="deduct" scopeSet={scopeSet} onClose={close} />
      )}
      {dialog === 'check' && <CheckDialog onClose={close} />}
    </section>
  );
}
