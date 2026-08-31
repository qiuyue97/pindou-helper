import { useState } from 'react';
import ColorPicker from '../components/ColorPicker';
import MatchPanel from '../components/MatchPanel';

export default function MatchPage() {
  const [hex, setHex] = useState('7F7F7F');

  return (
    <section aria-label="配色" className="match-page">
      <div>
        <h2>取色</h2>
        <ColorPicker hex={hex} onChange={setHex} />
      </div>
      <div>
        <h2>匹配结果</h2>
        <MatchPanel hex={hex} />
      </div>
    </section>
  );
}
