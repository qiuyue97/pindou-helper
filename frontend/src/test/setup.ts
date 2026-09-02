import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom implements neither of these (same gap as its missing canvas). The image
// picker builds preview URLs with them, so without a stub every test that
// touches it dies on "URL.createObjectURL is not a function". Counter-based so
// each call returns a distinct URL, which is what React keys on.
let objectUrlSeq = 0;
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => `blob:test/${++objectUrlSeq}`;
}
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = () => {};
}

// jsdom 没有 canvas 的 2D 上下文，也没有 PointerEvent。图纸识别那几个组件全靠
// 它们：格子和完整图纸都画在 canvas 上（一万格进 DOM 会让 iOS 卡死），拖角用
// Pointer Events 统一鼠标和触摸。
//
// 上下文桩把每个方法都记下来，组件测试于是只断言「调了什么」——真正的算术在
// lib/sheetGeometry.ts 里，那是纯函数，单独测得干干净净。
export interface Ctx2DStub extends Record<string, unknown> {
  fillRect: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  fillStyleLog: string[];
}

if (typeof HTMLCanvasElement !== 'undefined' && !HTMLCanvasElement.prototype.getContext) {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
}

/** 给一个 canvas 装上记账用的 2D 上下文，返回它好做断言。 */
export function stubCanvas2D(): Ctx2DStub {
  const fillStyleLog: string[] = [];
  const ctx = {
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillStyleLog,
    strokeStyle: '',
    lineWidth: 0,
  } as unknown as Ctx2DStub;
  Object.defineProperty(ctx, 'fillStyle', {
    get: () => fillStyleLog[fillStyleLog.length - 1] ?? '',
    set: (v: string) => {
      fillStyleLog.push(v);
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  return ctx;
}

// jsdom 不实现 PointerEvent。拖角全走它，没有这个 polyfill 连事件都派发不出去。
//
// 必须连 MouseEvent 一起判：scripts/** 那几个测试跑在 **node** 环境
// （vitest.config.ts 的 environmentMatchGlobs），那里连 MouseEvent 都没有，
// `class ... extends MouseEvent` 在**导入 setup 时**就会抛，整个文件收集失败。
if (typeof MouseEvent !== 'undefined' && typeof globalThis.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as never;
}

// setPointerCapture / releasePointerCapture 同样缺席。拖动时会调它们锁定指针，
// 缺了就直接抛异常。
if (typeof Element !== 'undefined' && !Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
