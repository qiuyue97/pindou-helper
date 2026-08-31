export default function EyeDropperButton({ onPick }: { onPick: (hex: string) => void }) {
  const supported = typeof window !== 'undefined' && 'EyeDropper' in window;
  if (!supported) return null;

  async function pick() {
    try {
      const Ctor = (
        window as unknown as {
          EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> };
        }
      ).EyeDropper;
      const res = await new Ctor().open();
      const hex = res.sRGBHex.replace(/^#/, '').toUpperCase();
      if (/^[0-9A-F]{6}$/.test(hex)) onPick(hex);
    } catch {
      // user cancelled — nothing to report
    }
  }

  return (
    <button type="button" onClick={() => void pick()}>
      屏幕吸色
    </button>
  );
}
