import { useMemo, useState } from 'react';
import ColorPicker from '../components/ColorPicker';
import ColorSpaceView from '../components/ColorSpaceView';
import MatchPanel from '../components/MatchPanel';
import { selectCandidates, type CandidateSet } from '../color/match';
import { useEffectiveCatalog } from '../state/useEffectiveCatalog';

export default function MatchPage() {
  // What the picker shows (follows the mouse) vs what the match uses (only
  // updates on a deliberate pick), so hovering an image does not re-rank 221 colours.
  const [previewHex, setPreviewHex] = useState<string | null>(null);
  const [matchHex, setMatchHex] = useState<string | null>(null);
  const [set, setSet] = useState<CandidateSet>('221');
  const [includeCustom, setIncludeCustom] = useState(false);
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
          <ColorPicker
            hex={previewHex}
            onPreview={setPreviewHex}
            onCommit={(next) => {
              setPreviewHex(next);
              setMatchHex(next);
            }}
          />
        </div>
        <div>
          <h2>匹配结果</h2>
          <MatchPanel
            hex={matchHex}
            candidates={candidates}
            set={set}
            includeCustom={includeCustom}
            onSetChange={setSet}
            onIncludeCustomChange={setIncludeCustom}
          />
        </div>
      </div>
      <ColorSpaceView sampleHex={matchHex} candidates={candidates} />
    </section>
  );
}
