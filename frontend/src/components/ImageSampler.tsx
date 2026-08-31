import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { rgbToHex } from '../color/color';
import { displayToPixel, fitContain, loadBitmap, pixelAt } from '../lib/imageSample';

const MAX_H = 420;
const LOUPE = 120;
const LOUPE_ZOOM = 8;

export default function ImageSampler({
  onPreview,
  onCommit,
}: {
  /** Fires continuously while the pointer moves over the image (unless frozen). */
  onPreview: (hex: string) => void;
  /** Fires only when the user presses 取此点. */
  onCommit: (hex: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [zoom, setZoom] = useState(1);
  const [current, setCurrent] = useState<string | null>(null);
  const [frozen, setFrozen] = useState(false);
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
      setCurrent(null);
      setFrozen(false);
      setLoupePos(null);
    } catch {
      setBitmap(null);
    }
  }

  /** Read the pixel under the pointer and paint the loupe. */
  function readAt(e: ReactPointerEvent<HTMLCanvasElement>): string | null {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

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

    const hex = rgbToHex(pixelAt(ctx.getImageData(x, y, 1, 1).data, 1, 0, 0));
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
    return hex;
  }

  function onMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (frozen) return; // locked in by a click — ignore further movement
    const hex = readAt(e);
    if (hex) {
      setCurrent(hex);
      onPreview(hex);
    }
  }

  /** Click toggles the freeze: lock the current pixel, or resume following. */
  function onClick(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (frozen) {
      setFrozen(false);
      const hex = readAt(e);
      if (hex) {
        setCurrent(hex);
        onPreview(hex);
      }
      return;
    }
    const hex = readAt(e);
    if (hex) {
      setCurrent(hex);
      onPreview(hex);
    }
    setFrozen(true);
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

      {!bitmap && <p className="muted">选择或拍一张照片，鼠标滑过即可取色。</p>}

      <div className="canvas-wrap">
        <canvas
          ref={canvasRef}
          aria-label="图片取色"
          style={{ touchAction: 'none' }}
          onPointerDown={onClick}
          onPointerMove={onMove}
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

      <p className="muted" data-testid="sampler-hint">
        {frozen ? '已锁定，再次点击图片可继续跟随鼠标' : '滑过图片实时预览，左键点击锁定'}
      </p>

      <div className="sampler-controls">
        <button type="button" onClick={() => setZoom((z) => Math.min(4, z * 1.5))}>
          放大
        </button>
        <button type="button" onClick={() => setZoom((z) => Math.max(0.5, z / 1.5))}>
          缩小
        </button>
        {current && (
          <span className="swatch" style={{ background: `#${current}` }} aria-hidden="true" />
        )}
        <button
          type="button"
          className="primary"
          disabled={!current}
          onClick={() => current && onCommit(current)}
        >
          取此点
        </button>
      </div>
    </div>
  );
}
