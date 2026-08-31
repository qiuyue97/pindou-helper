import OperationsPanel from '../components/OperationsPanel';

export default function HistoryPage() {
  return (
    <section aria-label="历史">
      <h2>操作历史</h2>
      <p className="muted">可以撤销或编辑任意一步；之后的记录会自动重算。</p>
      <OperationsPanel />
    </section>
  );
}
