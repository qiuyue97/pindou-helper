import { useState } from 'react';
import AddCodeDialog from '../components/AddCodeDialog';
import BatchDialog from '../components/BatchDialog';
import InventoryTable from '../components/InventoryTable';

type Dialog = 'add' | 'batch-add' | 'batch-deduct' | null;

export default function InventoryPage() {
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);

  return (
    <section aria-label="库存">
      <div className="toolbar">
        <button type="button" onClick={() => setDialog('add')}>
          添加色号
        </button>
        <button type="button" onClick={() => setDialog('batch-add')}>
          批量补货
        </button>
        <button type="button" onClick={() => setDialog('batch-deduct')}>
          批量扣减
        </button>
      </div>
      <InventoryTable />
      {dialog === 'add' && <AddCodeDialog onClose={close} />}
      {dialog === 'batch-add' && <BatchDialog mode="add" onClose={close} />}
      {dialog === 'batch-deduct' && <BatchDialog mode="deduct" onClose={close} />}
    </section>
  );
}
