import { useState } from 'react';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';

/** Low-stock threshold editor. Lives on the inventory tab only — it means
 *  nothing on the colour-matching or my-colours tabs. */
export default function ThresholdControl() {
  const { me, setThreshold } = useAuth();
  const { show } = useToast();
  // null means "follow the server value"; any string means the user is editing.
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? (me ? String(me.threshold) : '');

  async function save() {
    const parsed = Number(value);
    if (value.trim() === '' || !Number.isInteger(parsed) || parsed < 0) {
      show('阈值应为不小于 0 的整数');
      return;
    }
    await setThreshold(parsed);
    setDraft(null);
    show(`低库存阈值已改为 ${parsed}`);
  }

  return (
    <span className="threshold-control">
      <label htmlFor="threshold">低库存阈值</label>
      <input
        id="threshold"
        className="threshold"
        inputMode="numeric"
        value={value}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button type="button" onClick={() => void save()}>
        保存阈值
      </button>
    </span>
  );
}
