interface EyeDropperResult {
  sRGBHex: string;
}

declare class EyeDropper {
  constructor();
  open(options?: { signal?: AbortSignal }): Promise<EyeDropperResult>;
}

interface Window {
  EyeDropper?: typeof EyeDropper;
}
