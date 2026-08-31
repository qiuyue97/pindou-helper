import { useEffect, useState } from 'react';
import type { EffectiveColor } from '../color/catalog';
import ColorSpace2D from './ColorSpace2D';
import ColorSpace3D from './ColorSpace3D';

export default function ColorSpaceView({
  sampleHex,
  candidates,
}: {
  sampleHex: string;
  candidates: EffectiveColor[];
}) {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    setNarrow(window.matchMedia('(max-width: 860px)').matches);
  }, []);

  return (
    <div className="spaceview">
      <ColorSpace2D sampleHex={sampleHex} candidates={candidates} />
      <details open={!narrow}>
        <summary>查看 3D</summary>
        <ColorSpace3D sampleHex={sampleHex} candidates={candidates} />
      </details>
    </div>
  );
}
