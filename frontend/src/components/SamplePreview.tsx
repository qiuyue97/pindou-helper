import { Copy } from 'lucide-react';
import { useRef } from 'react';
import { hexToLab, hexToRgb } from '../color/color';
import { useToast } from '../state/ToastContext';

export default function SamplePreview({ hex }: { hex: string | null }) {
  const { show } = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const rgb = hex ? hexToRgb(hex) : null;
  const lab = hex ? hexToLab(hex) : null;
  const f = (n: number) => n.toFixed(1);

  async function copy() {
    if (!hex) return;
    const text = `#${hex}`;
    try {
      await navigator.clipboard.writeText(text);
      show('已复制颜色值');
    } catch {
      ref.current?.select();
      show('请手动复制（Ctrl/⌘+C）');
    }
  }

  return (
    <div className="sample">
      <span
        className="sample-swatch"
        data-testid="sample-swatch"
        data-empty={hex ? undefined : 'true'}
        style={hex ? { background: `#${hex}` } : undefined}
      />
      <dl className="sample-readout">
        <dt>HEX</dt>
        <dd>{hex ? `#${hex}` : '—'}</dd>
        <dt>RGB</dt>
        <dd>{rgb ? `${rgb[0]}, ${rgb[1]}, ${rgb[2]}` : '—'}</dd>
        <dt>Lab</dt>
        <dd>{lab ? `${f(lab[0])}, ${f(lab[1])}, ${f(lab[2])}` : '—'}</dd>
      </dl>
      <input
        ref={ref}
        className="offscreen"
        readOnly
        value={`#${hex}`}
        aria-hidden="true"
        tabIndex={-1}
      />
      <button type="button" disabled={!hex} onClick={() => void copy()}>
        <Copy size={15} aria-hidden="true" />
        复制
      </button>
    </div>
  );
}
