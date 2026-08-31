import { Copy } from 'lucide-react';
import { useRef } from 'react';
import { useStockout } from '../api/hooks';
import { qtyTier } from '../lib/qty';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import Swatch from './Swatch';

export default function StockoutView() {
  const { me } = useAuth();
  const { show } = useToast();
  const { data, isLoading } = useStockout();
  const taRef = useRef<HTMLTextAreaElement>(null);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      show('已复制缺货色号');
    } catch {
      taRef.current?.select();
      show('请手动复制（Ctrl/⌘+C）');
    }
  }

  if (isLoading) return <p>加载中…</p>;
  if (!data || data.items.length === 0) return <p>所有库存都充足，无缺货项！</p>;

  return (
    <div className="stockout">
      <table>
        <thead>
          <tr>
            <th>色号</th>
            <th>颜色</th>
            <th>数量</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => {
            const tier = qtyTier(item.quantity, me?.threshold ?? 0);
            return (
              <tr key={item.code}>
                <td>{item.code}</td>
                <td>
                  <Swatch code={item.code} />
                </td>
                <td>
                  <span className={`qty qty-${tier}`} data-tier={tier}>
                    {item.quantity}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <label htmlFor="stockout-text">缺货色号</label>
      <textarea
        id="stockout-text"
        aria-label="缺货色号"
        ref={taRef}
        readOnly
        rows={2}
        value={data.text}
      />
      <button type="button" onClick={() => void copy(data.text)}>
        <Copy size={15} aria-hidden="true" />
        复制
      </button>
    </div>
  );
}
