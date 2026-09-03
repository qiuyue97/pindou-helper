/**
 * 色号选择器。
 *
 * 刻意**不用 `<select>`**：iOS 上原生 select 是全屏滚轮，二百多个色号在那里面
 * 根本没法找。用 input + 自绘下拉，输入即过滤。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CodePicker from './CodePicker';

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

it('不用原生 select——iOS 上那是全屏滚轮', () => {
  const { container } = render(<CodePicker value="A1" onChange={() => {}} />);
  expect(container.querySelector('select')).toBeNull();
  expect(screen.getByRole('combobox')).toBeInstanceOf(HTMLInputElement);
});

it('输入即过滤', () => {
  render(<CodePicker value="" onChange={() => {}} />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'a1' } });
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['A1', 'A10']);
});

it('候选按色号顺序排，A10 在 A2 后面', () => {
  render(<CodePicker value="" onChange={() => {}} />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'A' } });
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['A1', 'A2', 'A10']);
});

it('自定义色不出现——后端只认 BASE 色卡，选了会 422', () => {
  render(<CodePicker value="" onChange={() => {}} />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'MY' } });
  expect(screen.queryByRole('option')).toBeNull();
  expect(screen.getByRole('listbox')).toHaveTextContent('没有匹配');
});

it('221 范围下排除 291 独有的系列', () => {
  render(<CodePicker value="" onChange={() => {}} scope="221" />);
  fireEvent.focus(screen.getByRole('combobox'));
  const codes = screen.getAllByRole('option').map((o) => o.textContent);
  expect(codes).toContain('H15');
  expect(codes).not.toContain('ZG1');
});

it('291 范围下 ZG 也在', () => {
  render(<CodePicker value="" onChange={() => {}} scope="291" />);
  fireEvent.focus(screen.getByRole('combobox'));
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toContain('ZG1');
});

it('选中一个候选就回调', () => {
  const onChange = vi.fn();
  render(<CodePicker value="" onChange={onChange} />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'H' } });
  fireEvent.click(screen.getByRole('option', { name: 'H15' }));
  expect(onChange).toHaveBeenCalledWith('H15');
});

it('回车提交唯一的候选', () => {
  const onChange = vi.fn();
  render(<CodePicker value="" onChange={onChange} />);
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'H15' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onChange).toHaveBeenCalledWith('H15');
});

it('候选不止一个时回车不提交——替用户猜正是这个功能要避免的', () => {
  const onChange = vi.fn();
  render(<CodePicker value="" onChange={onChange} />);
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'A' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onChange).not.toHaveBeenCalled();
});

it('输入一个不存在的色号不回调', () => {
  const onChange = vi.fn();
  render(<CodePicker value="" onChange={onChange} />);
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'ZZ99' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('listbox')).toHaveTextContent('没有匹配');
});

it('每个候选带色块，用「我的色卡」的有效色值', () => {
  const { container } = render(<CodePicker value="" onChange={() => {}} scope="291" />);
  fireEvent.focus(screen.getByRole('combobox'));
  const swatches = container.querySelectorAll('.swatch');
  expect(swatches.length).toBe(5); // 自定义那个被排掉了
  expect((swatches[2] as HTMLElement).style.background).toContain('rgb(0, 0, 255)');
});


// ---------- 下拉是浮层 ----------

it('默认收起——常驻展开会把下面的卡片整个顶开', () => {
  render(<CodePicker value="A1" onChange={() => {}} />);
  expect(screen.queryByRole('listbox')).toBeNull();
});

it('聚焦才展开', () => {
  render(<CodePicker value="" onChange={() => {}} />);
  fireEvent.focus(screen.getByRole('combobox'));
  expect(screen.getByRole('listbox')).toBeInTheDocument();
});

it('autoFocus 时直接展开——用户就是来选的', () => {
  render(<CodePicker value="" onChange={() => {}} autoFocus />);
  expect(screen.getByRole('listbox')).toBeInTheDocument();
});

it('选中之后收起', () => {
  render(<CodePicker value="" onChange={() => {}} autoFocus />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'H15' } });
  fireEvent.click(screen.getByRole('option', { name: 'H15' }));
  expect(screen.queryByRole('listbox')).toBeNull();
});

it('Esc 收起', () => {
  render(<CodePicker value="" onChange={() => {}} autoFocus />);
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
  expect(screen.queryByRole('listbox')).toBeNull();
});
