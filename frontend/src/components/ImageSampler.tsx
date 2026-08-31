import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { rgbToHex } from '../color/color';
import { displayToPixel, fitContain, loadBitmap, pixelAt } from '../lib/imageSample';

const MAX_H = 420;
const LOUPE = 120;
const LOUPE_ZOOM = 8;

export default function ImageSampler({ onPick }: { onPick: (hex: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [zoom, setZoom] = useState(1);
  const [tentative, setTentative] = useState<string | null>(null);
  const [loupePos, setLoupePos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap) return;
    const box = wrapRef.current?.clientWidth || 320;
    const size = fitContain(bitmap.width, bitmap.height, box * zoom, MAX_H * zoom);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  }, [bitmap, zoom]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      setBitmap(await loadBitmap(file));
      setTentative(null);
      setLoupePos(null);
    } catch {
      setBitmap(null);
    }
  }

  function sampleAt(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const dpr = window.devicePixelRatio || 1;
    const { x, y } = displayToPixel(
      px,
      py,
      { width: rect.width, height: rect.height },
      { width: canvas.width, height: canvas.height },
    );

    const img = ctx.getImageData(x, y, 1, 1);
    setTentative(rgbToHex(pixelAt(img.data, 1, 0, 0)));
    setLoupePos({ x: px, y: py });

    const loupe = loupeRef.current;
    const lctx = loupe?.getContext('2d');
    if (loupe && lctx) {
      lctx.imageSmoothingEnabled = false;
      lctx.clearRect(0, 0, LOUPE, LOUPE);
      const src = LOUPE / LOUPE_ZOOM;
      lctx.drawImage(
        canvas,
        px * dpr - (src * dpr) / 2,
        py * dpr - (src * dpr) / 2,
        src * dpr,
        src * dpr,
        0,
        0,
        LOUPE,
        LOUPE,
      );
      lctx.strokeStyle = '#fff';
      lctx.lineWidth = 1;
      lctx.beginPath();
      lctx.moveTo(LOUPE / 2, 0);
      lctx.lineTo(LOUPE / 2, LOUPE);
      lctx.moveTo(0, LOUPE / 2);
      lctx.lineTo(LOUPE, LOUPE / 2);
      lctx.stroke();
    }
  }

  return (
    <div className="sampler" ref={wrapRef}>
      <label htmlFor="pick-file">上传图片</label>
      <input
        id="pick-file"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      {!bitmap && <p className="muted">选择或拍一张照片，然后点图片取色。</p>}

      <div className="canvas-wrap">
        <canvas
          ref={canvasRef}
          aria-label="图片取色"
          style={{ touchAction: 'none' }}
          onPointerDown={sampleAt}
          onPointerMove={(e) => {
            if (e.buttons > 0 || e.pointerType === 'touch') sampleAt(e);
          }}
        />
        {loupePos && (
          <canvas
            ref={loupeRef}
            className="loupe"
            width={LOUPE}
            height={LOUPE}
            style={{ left: loupePos.x - LOUPE / 2, top: loupePos.y - 80 - LOUPE }}
          />
        )}
      </div>

      <div className="sampler-controls">
        <button type="button" onClick={() => setZoom((z) => Math.min(4, z * 1.5))}>
          放大
        </button>
        <button type="button" onClick={() => setZoom((z) => Math.max(0.5, z / 1.5))}>
          缩小
        </button>
        {tentative && (
          <span className="swatch" style={{ background: `#${tentative}` }} aria-hidden="true" />
        )}
        <button
          type="button"
          className="primary"
          disabled={!tentative}
          onClick={() => tentative && onPick(tentative)}
        >
          取此点
        </button>
      </div>
    </div>
  );
}
