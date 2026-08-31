import { useEffect, useState } from 'react';
import { hexToRgb, rgbToHex } from '../color/color';

const HEX_RE = /^[0-9a-fA-F]{6}$/;

export default function ManualColorInput({
  hex,
  onChange,
}: {
  hex: string | null;
  onChange: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(hex ? `#${hex}` : '');
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(hex ? `#${hex}` : '');
    setInvalid(false);
  }, [hex]);

  const rgb = hex && HEX_RE.test(hex) ? hexToRgb(hex) : null;

  function onHexInput(value: string) {
    setDraft(value);
    const cleaned = value.trim().replace(/^#/, '');
    if (HEX_RE.test(cleaned)) {
      setInvalid(false);
      onChange(cleaned.toUpperCase());
    } else {
      setInvalid(true);
    }
  }

  function onChannel(index: 0 | 1 | 2, value: string) {
    const n = Number(value);
    if (value.trim() === '' || Number.isNaN(n)) return;
    const base = rgb ?? ([0, 0, 0] as [number, number, number]);
    const next: [number, number, number] = [base[0], base[1], base[2]];
    next[index] = Math.min(255, Math.max(0, Math.round(n)));
    onChange(rgbToHex(next));
  }

  return (
    <div className="manual-input">
      <label htmlFor="hex-field">十六进制</label>
      <input
        id="hex-field"
        placeholder="#RRGGBB"
        value={draft}
        onChange={(e) => onHexInput(e.target.value)}
      />

      <div className="channels">
        {(['R', 'G', 'B'] as const).map((name, i) => (
          <span key={name}>
            <label htmlFor={`ch-${name}`}>{name}</label>
            <input
              id={`ch-${name}`}
              type="number"
              min={0}
              max={255}
              value={rgb ? rgb[i as 0 | 1 | 2] : ''}
              onChange={(e) => onChannel(i as 0 | 1 | 2, e.target.value)}
            />
          </span>
        ))}
      </div>

      {invalid && (
        <p role="alert" className="error">
          请输入 6 位十六进制颜色
        </p>
      )}
    </div>
  );
}
