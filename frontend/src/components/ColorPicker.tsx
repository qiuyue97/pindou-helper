import EyeDropperButton from './EyeDropperButton';
import ImageSampler from './ImageSampler';
import ManualColorInput from './ManualColorInput';
import SamplePreview from './SamplePreview';

export default function ColorPicker({
  hex,
  onChange,
}: {
  hex: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div className="picker">
      <SamplePreview hex={hex} />
      <EyeDropperButton onPick={onChange} />
      <ImageSampler onPick={onChange} />
      <ManualColorInput hex={hex} onChange={onChange} />
    </div>
  );
}
