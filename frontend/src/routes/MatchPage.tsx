import { useMemo, useState } from 'react';
import ColorPicker from '../components/ColorPicker';
import ColorSpaceView from '../components/ColorSpaceView';
import MatchPanel from '../components/MatchPanel';
import { selectCandidates, type CandidateSet } from '../color/match';
import { useEffectiveCatalog } from '../state/useEffectiveCatalog';

export default function MatchPage() {
  const [hex, setHex] = useState('7F7F7F');
  const [set, setSet] = useState<CandidateSet>('291');
  const [includeCustom, setIncludeCustom] = useState(true);
  const { colors } = useEffectiveCatalog();

  // One source of truth so the panel and the plot can never disagree.
  const candidates = useMemo(
    () => selectCandidates(colors, set, includeCustom),
    [colors, set, includeCustom],
  );

  return (
    <section aria-label="配色">
      <div className="match-page">
        <div>
          <h2>取色</h2>
          <ColorPicker hex={hex} onChange={setHex} />
        </div>
        <div>
          <h2>匹配结果</h2>
          <MatchPanel
            hex={hex}
            candidates={candidates}
            set={set}
            includeCustom={includeCustom}
            onSetChange={setSet}
            onIncludeCustomChange={setIncludeCustom}
          />
        </div>
      </div>
      <ColorSpaceView sampleHex={hex} candidates={candidates} />
    </section>
  );
}
