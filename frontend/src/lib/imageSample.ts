export interface Size {
  width: number;
  height: number;
}

export function fitContain(srcW: number, srcH: number, boxW: number, boxH: number): Size {
  const scale = Math.min(boxW / srcW, boxH / srcH, 1);
  return { width: Math.round(srcW * scale), height: Math.round(srcH * scale) };
}

export function displayToPixel(
  px: number,
  py: number,
  display: Size,
  image: Size,
): { x: number; y: number } {
  const clamp = (v: number, max: number) => Math.min(Math.max(Math.floor(v), 0), Math.max(max, 0));
  return {
    x: clamp((px / display.width) * image.width, image.width - 1),
    y: clamp((py / display.height) * image.height, image.height - 1),
  };
}

export function pixelAt(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): [number, number, number] {
  const i = (y * width + x) * 4;
  return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
}

export async function loadBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(file);
  }
}
