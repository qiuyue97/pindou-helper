import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { renderWithProviders } from '../test/utils';
import ManualColorInput from './ManualColorInput';

/** Mirrors the real parent (MatchPage), which feeds the new hex straight back. */
function Controlled({ initial, onChange }: { initial: string; onChange: (hex: string) => void }) {
  const [hex, setHex] = useState(initial);
  return (
    <ManualColorInput
      hex={hex}
      onChange={(next) => {
        setHex(next);
        onChange(next);
      }}
    />
  );
}

describe('ManualColorInput', () => {
  test('emits a normalised hex from the hex field', async () => {
    const onChange = vi.fn();
    renderWithProviders(<ManualColorInput hex="FF0000" onChange={onChange} />);
    const hexField = screen.getByLabelText('十六进制');
    await userEvent.clear(hexField);
    await userEvent.type(hexField, '#00ff80');
    expect(onChange).toHaveBeenLastCalledWith('00FF80');
  });

  test('shows an error for a malformed hex and does not emit', async () => {
    const onChange = vi.fn();
    renderWithProviders(<ManualColorInput hex="FF0000" onChange={onChange} />);
    const hexField = screen.getByLabelText('十六进制');
    await userEvent.clear(hexField);
    await userEvent.type(hexField, 'nope');
    expect(await screen.findByRole('alert')).toHaveTextContent('请输入 6 位十六进制颜色');
    expect(onChange).not.toHaveBeenCalled();
  });

  test('reflects the incoming hex in the R/G/B fields', () => {
    renderWithProviders(<ManualColorInput hex="0A141E" onChange={vi.fn()} />);
    expect(screen.getByLabelText('R')).toHaveValue(10);
    expect(screen.getByLabelText('G')).toHaveValue(20);
    expect(screen.getByLabelText('B')).toHaveValue(30);
  });

  test('editing a channel recomposes the hex', async () => {
    const onChange = vi.fn();
    renderWithProviders(<Controlled initial="000000" onChange={onChange} />);
    const r = screen.getByLabelText('R');
    await userEvent.clear(r);
    await userEvent.type(r, '255');
    expect(onChange).toHaveBeenLastCalledWith('FF0000');
    expect(screen.getByLabelText('R')).toHaveValue(255);
  });
});
