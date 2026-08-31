import EyeDropperButton from './EyeDropperButton';
import ImageSampler from './ImageSampler';
import ManualColorInput from './ManualColorInput';
import SamplePreview from './SamplePreview';

export default function ColorPicker({
  hex,
  onPreview,
  onCommit,
}: {
  /** The colour shown in the preview — follows the mouse over an image. */
  hex: string;
  onPreview: (hex: string) => void;
  /** A deliberate pick. Only this drives the match. */
  onCommit: (hex: string) => void;
}) {
  // Typing a value or using the screen eyedropper is already deliberate, so
  // those commit straight away; only the image path needs an explicit 取此点.
  const both = (next: string) => {
    onPreview(next);
    onCommit(next);
  };

  return (
    <div className="picker">
      <SamplePreview hex={hex} />
      <EyeDropperButton onPick={both} />
      <ImageSampler onPreview={onPreview} onCommit={onCommit} />
      <ManualColorInput hex={hex} onChange={both} />
    </div>
  );
}
