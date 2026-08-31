import type { Change } from '../api/types';
import Modal from './Modal';

export default function ImpactDialog({
  title,
  changes,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  changes: Change[];
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="button" className="primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {changes.length === 0 ? (
        <p>库存不受影响</p>
      ) : (
        <table aria-label="影响预览" className="preview">
          <thead>
            <tr>
              <th>色号</th>
              <th>现在</th>
              <th>之后</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((c) => (
              <tr key={c.code}>
                <td>{c.code}</td>
                <td>{c.from ?? '—'}</td>
                <td>{c.to ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
