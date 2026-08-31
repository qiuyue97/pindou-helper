import { useRef } from 'react';
import { hexToLab, hexToRgb } from '../color/color';
import { useToast } from '../state/ToastContext';

export default function SamplePreview({ hex }: { hex: string }) {
  const { show } = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const rgb = hexToRgb(hex);
  const lab = hexToLab(hex);
  const f = (n: number) => n.toFixed(1);

  async function copy() {
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
        style={{ background: `#${hex}` }}
      />
      <dl className="sample-readout">
        <dt>HEX</dt>
        <dd>#{hex}</dd>
        <dt>RGB</dt>
        <dd>
          {rgb[0]}, {rgb[1]}, {rgb[2]}
        </dd>
        <dt>Lab</dt>
        <dd>
          {f(lab[0])}, {f(lab[1])}, {f(lab[2])}
        </dd>
      </dl>
      <input
        ref={ref}
        className="offscreen"
        readOnly
        value={`#${hex}`}
        aria-hidden="true"
        tabIndex={-1}
      />
      <button type="button" onClick={() => void copy()}>
        复制
      </button>
    </div>
  );
}
