import { useEffectiveCatalog } from '../state/useEffectiveCatalog';

export default function Swatch({ code }: { code: string }) {
  const { byCode } = useEffectiveCatalog();
  const color = byCode.get(code);
  return (
    <span
      className="swatch"
      data-code={code}
      data-unknown={color ? undefined : 'true'}
      title={color ? `${code} #${color.hex}` : code}
      style={color ? { background: `#${color.hex}` } : undefined}
    />
  );
}
