/**
 * 屏幕上的图纸和下载的图纸必须是同一张。
 *
 * 这两处一度是各画各的：屏幕上一格一个纯色方块，下载的才是带网格线、格内色号、
 * 底部汇总的正式图纸。用户照着屏幕拼，拿到的文件却是另一回事。现在共用
 * sheetToDrawing + drawSheet，这里就盯着「预览确实画了正式图纸该有的东西」。
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Sheet } from '../../api/types';
import { type Ctx2DStub, stubCanvas2D } from '../../test/setup';
import SheetPreview from './SheetPreview';

vi.mock('../../state/useEffectiveCatalog', () => ({
  useEffectiveCatalog: () => ({
    colors: [],
    byCode: new Map([
      ['H15', { code: 'H15', hex: '00FF00' }],
      ['B8', { code: 'B8', hex: '0000FF' }],
    ]),
    isLoading: false,
  }),
}));

function makeSheet(over: Partial<Sheet> = {}): Sheet {
  return {
    id: 1, rows: 2, cols: 2, rect: [0, 0, 20, 20], palette: '221',
    labels: [0, 0, 1, 1],
    classes: [
      { klass: 0, code: 'H15' },
      { klass: 1, code: 'B8' },
    ],
    overrides: {},
    tally: { H15: 2, B8: 2 },
    ...over,
  } as unknown as Sheet;
}

let ctx: Ctx2DStub;
beforeEach(() => {
  ctx = stubCanvas2D();
});

/** 画在格子里和画在图例里的所有文字。 */
function texts(): string[] {
  return ctx.fillText.mock.calls.map((c) => String(c[0]));
}

it('每个格子里印着色号——不是一片纯色方块', () => {
  render(<SheetPreview sheet={makeSheet()} />);
  expect(texts()).toContain('H15');
  expect(texts()).toContain('B8');
});

it('底部有色号汇总，带颗数', () => {
  render(<SheetPreview sheet={makeSheet()} />);
  expect(texts()).toContain('2 颗');
});

it('有网格线', () => {
  render(<SheetPreview sheet={makeSheet()} />);
  expect(ctx.stroke).toHaveBeenCalled();
});

it('画的是校对之后的归属：改过的格子按新色号画', () => {
  render(<SheetPreview sheet={makeSheet({ overrides: { '0,0': 'B8' }, tally: { H15: 1, B8: 3 } })} />);
  // 左上角本来是 H15，被改成 B8 了：四格里只剩一个 H15、三个 B8。
  // 每个色号在底部图例里还会再出现一次，所以这里是 1+1 和 3+1。
  expect(texts().filter((t) => t === 'H15')).toHaveLength(2);
  expect(texts().filter((t) => t === 'B8')).toHaveLength(4);
});

it('还没识别出行列时不画', () => {
  render(<SheetPreview sheet={makeSheet({ rows: 0, cols: 0 })} />);
  expect(screen.queryByLabelText('完整图纸')).toBeNull();
});
