/**
 * 识别中的进度。
 *
 * 原来只有一句「可能要一两分钟」，之后界面什么都不动——用户分不出是在排队、在算，
 * 还是已经卡死了，只能反复刷新。这里盯的就是「界面上真的看得出发生了什么」。
 */
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { Sheet } from '../../api/types';
import SheetProgress from './SheetProgress';

function sheet(over: Partial<Sheet> = {}): Sheet {
  return {
    id: 1, kind: 'recognise', name: '', position: 0, status: 'running',
    width: 100, height: 100, rect: [], rows: 10, cols: 10,
    has_blanks: false, palette: '221', snap_x: [], snap_y: [],
    labels: [], classes: [], counts: [], overrides: {}, prior: {},
    engine: '', step: '', progress: 0, structured: true, error: '', seen: false,
    tally: {}, created_at: '2026-09-04T01:00:00Z', finished_at: null,
    ...over,
  } as Sheet;
}

it('把后端报的那一步原样显示出来', () => {
  render(<SheetProgress sheet={sheet({ step: '识别色号 2/5 页', progress: 61 })} />);
  expect(screen.getByText('识别色号 2/5 页')).toBeInTheDocument();
  expect(screen.getByText('61%')).toBeInTheDocument();
});

it('进度条是真的 progressbar，读屏也报得出数', () => {
  render(<SheetProgress sheet={sheet({ step: '归拢颜色', progress: 35 })} />);
  const bar = screen.getByRole('progressbar');
  expect(bar).toHaveAttribute('aria-valuenow', '35');
  expect(bar).toHaveAttribute('aria-valuemax', '100');
});

it('排队时说在排队——那时候确实什么都还没发生', () => {
  render(<SheetProgress sheet={sheet({ status: 'pending', progress: 0 })} />);
  expect(screen.getByText('排队中')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
});

it('走到哪一步，前面几步就标成走完了', () => {
  render(<SheetProgress sheet={sheet({ step: '识别色号', progress: 45 })} />);
  const steps = screen.getAllByRole('listitem');
  expect(steps.map((li) => li.className)).toEqual(['done', 'done', 'done', 'now', '']);
});

it('OCR 跨 45→85，中间的百分比仍然停在「识别色号」上', () => {
  // 每一步的刻度是它**开始**的位置。按「过了刻度就算走完」算的话，61% 会显示成
  // 「对账定案」——那一步其实还没开始。
  render(<SheetProgress sheet={sheet({ step: '识别色号 2/5 页', progress: 61 })} />);
  const steps = screen.getAllByRole('listitem');
  expect(steps.map((li) => li.className)).toEqual(['done', 'done', 'done', 'now', '']);
});

it('一步都还没开始时不标任何一步', () => {
  render(<SheetProgress sheet={sheet({ status: 'pending', progress: 0 })} />);
  expect(screen.getAllByRole('listitem').map((li) => li.className)).toEqual(
    ['', '', '', '', ''],
  );
});

it('越界的进度值夹回 0..100，不会画出格', () => {
  render(<SheetProgress sheet={sheet({ progress: 140 })} />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
});

it('照旧告诉用户可以先去做别的', () => {
  render(<SheetProgress sheet={sheet({ progress: 20 })} />);
  expect(screen.getByText(/可以先去做别的/)).toBeInTheDocument();
});


// ---------- 两条路的步骤不一样 ----------

it('生成图纸报的是生成的步骤，不是识别的', () => {
  render(<SheetProgress sheet={sheet({ kind: 'generate', step: '配色卡', progress: 75 })} />);
  const steps = screen.getAllByRole('listitem').map((li) => li.textContent);
  expect(steps).toEqual(['读取图片', '归拢像素', '配色卡', '清理孤点']);
  // 生成这条路上根本没有 OCR，也没有图例可以对账
  expect(steps).not.toContain('识别色号');
  expect(steps).not.toContain('对账定案');
});

it('识别那条路照旧', () => {
  render(<SheetProgress sheet={sheet({ step: '识别色号', progress: 45 })} />);
  expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toContain('对账定案');
});

it('还没报出步骤时，说的动词也要对', () => {
  render(<SheetProgress sheet={sheet({ kind: 'generate', progress: 20 })} />);
  expect(screen.getByText('正在生成')).toBeInTheDocument();
});
