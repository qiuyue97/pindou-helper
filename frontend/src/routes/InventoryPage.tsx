import { useState } from 'react';
import AddCodeDialog from '../components/AddCodeDialog';
import InventoryTable from '../components/InventoryTable';

export default function InventoryPage() {
  const [dialog, setDialog] = useState<'add' | null>(null);

  return (
    <section aria-label="库存">
      <div className="toolbar">
        <button type="button" onClick={() => setDialog('add')}>
          添加色号
        </button>
      </div>
      <InventoryTable />
      {dialog === 'add' && <AddCodeDialog onClose={() => setDialog(null)} />}
    </section>
  );
}
