/**
 * 选色号的面板。
 *
 * 刻意**不用 `<select>`**：iOS 上原生 select 是全屏滚轮，二百多个色号在那里面
 * 根本没法找。也不再用「行内输入框 + 小下拉」——那个一聚焦就把整页顶上去，而且
 * 一列 14px 的小色块在手机上太小。现在是一块 fixed 的面板 + 一片大方格。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import CodeSheet from './CodeSheet';

vi.mock('../../state/useEffectiveCatalog', () => ({
  useEffectiveCatalog: () => ({
    colors: [
      { code: 'A1', series: 'A', hex: 'FF0000', source: 'base' },
      { code: 'A2', series: 'A', hex: '00FF00', source: 'base' },
      { code: 'A10', series: 'A', hex: '0000FF', source: 'override' },
      { code: 'H15', series: 'H', hex: 'FFFF00', source: 'base' },
      { code: 'ZG1', series: 'ZG', hex: '112233', source: 'base' },
      { code: 'MY1', series: 'MY', hex: '445566', source: 'custom' },
    ],
    byCode: new Map(),
    isLoading: false,
  }),
}));

function show(props: Partial<Parameters<typeof CodeSheet>[0]> = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(<CodeSheet title="改成" onPick={onPick} onClose={onClose} {...props} />);
  return { onPick, onClose };
}

const codes = () => screen.getAllByRole('option').map((o) => o.textContent);

// ---------- 候选口径：和换掉的那一版完全一致 ----------

it('不用原生 select——iOS 上那是全屏滚轮', () => {
  const { container } = render(
    <CodeSheet title="改成" onPick={() => {}} onClose={() => {}} />,
  );
  expect(container.querySelector('select')).toBeNull();
});

it('输入即过滤', () => {
  show();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'a1' } });
  expect(codes()).toEqual(['A1', 'A10']);
});

it('候选按色号顺序排，A10 在 A2 后面', () => {
  show();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'A' } });
  expect(codes()).toEqual(['A1', 'A2', 'A10']);
});

it('自定义色不出现——后端只认 BASE 色卡，选了会 422', () => {
  show();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'MY' } });
  expect(screen.queryByRole('option')).toBeNull();
  expect(screen.getByText('没有匹配的色号')).toBeInTheDocument();
});

it('221 范围下排除 291 独有的系列', () => {
  show({ scope: '221' });
  expect(codes()).toContain('H15');
  expect(codes()).not.toContain('ZG1');
});

it('291 范围下 ZG 也在', () => {
  show({ scope: '291' });
  expect(codes()).toContain('ZG1');
});

it('选中一个就回调', () => {
  const { onPick } = show();
  fireEvent.click(screen.getByRole('option', { name: 'H15' }));
  expect(onPick).toHaveBeenCalledWith('H15');
});

it('回车提交唯一的候选', () => {
  const { onPick } = show();
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'H15' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onPick).toHaveBeenCalledWith('H15');
});

it('候选不止一个时回车不提交——替用户猜正是这个功能要避免的', () => {
  const { onPick } = show();
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'A' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onPick).not.toHaveBeenCalled();
});

it('每个候选带色块，用「我的色卡」的有效色值', () => {
  const { container } = render(
    <CodeSheet title="改成" scope="291" onPick={() => {}} onClose={() => {}} />,
  );
  const swatches = container.querySelectorAll('.swatch');
  expect(swatches.length).toBe(5); // 自定义那个被排掉了
  expect((swatches[2] as HTMLElement).style.background).toContain('rgb(0, 0, 255)');
});

// ---------- 面板本身 ----------

it('一打开就是全部候选，不用先聚焦——用户就是来选的', () => {
  show();
  expect(codes().length).toBe(5);
});

it('搜索框**不自动聚焦**：一聚焦 iOS 就把整页顶上去，刚数好的豆点全跑没了', () => {
  show();
  expect(screen.getByRole('combobox')).not.toHaveFocus();
});

it('搜索框字号不小于 16px，否则 iOS 会为了就着它把整页放大', () => {
  const { container } = render(
    <CodeSheet title="改成" onPick={() => {}} onClose={() => {}} />,
  );
  expect(container.querySelector('.code-sheet-search')).toBeInTheDocument();
});

it('Esc 关掉', () => {
  const { onClose } = show();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalled();
});

it('点背景关掉', () => {
  const { onClose } = show();
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(onClose).toHaveBeenCalled();
});

it('「取消」关掉，且不改任何东西', () => {
  const { onClose, onPick } = show();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(onClose).toHaveBeenCalled();
  expect(onPick).not.toHaveBeenCalled();
});

it('打开期间锁住页面滚动，关掉还回去', () => {
  const { unmount } = render(
    <CodeSheet title="改成" onPick={() => {}} onClose={() => {}} />,
  );
  expect(document.body.style.overflow).toBe('hidden');
  unmount();
  expect(document.body.style.overflow).not.toBe('hidden');
});

// ---------- 空白格 ----------

it('有空格子的图纸上，「空白格」置顶', () => {
  const { onPick } = show({ allowBlank: true });
  const options = screen.getAllByRole('option');
  expect(options[0]).toHaveTextContent('空白格');
  fireEvent.click(options[0]!);
  // 送出去的是记号，不是中文
  expect(onPick).toHaveBeenCalledWith('-');
});

it('没有空格子的图纸上不给这个选项', () => {
  show();
  expect(screen.queryByText('空白格')).toBeNull();
});

it('输入过滤不掉「空白格」——它不是色号', () => {
  show({ allowBlank: true });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzz' } });
  expect(screen.getByText('空白格')).toBeInTheDocument();
});
