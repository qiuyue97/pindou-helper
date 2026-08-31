import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderWithProviders } from '../test/utils';
import EyeDropperButton from './EyeDropperButton';

afterEach(() => {
  delete (window as { EyeDropper?: unknown }).EyeDropper;
});

function stubEyeDropper(impl: () => Promise<{ sRGBHex: string }>) {
  (window as unknown as { EyeDropper: unknown }).EyeDropper = class {
    open = impl;
  };
}

describe('EyeDropperButton', () => {
  test('renders nothing when the API is unavailable', () => {
    renderWithProviders(<EyeDropperButton onPick={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '屏幕吸色' })).not.toBeInTheDocument();
  });

  test('picks a colour and normalises the hex', async () => {
    stubEyeDropper(async () => ({ sRGBHex: '#00ff80' }));
    const onPick = vi.fn();
    renderWithProviders(<EyeDropperButton onPick={onPick} />);
    await userEvent.click(screen.getByRole('button', { name: '屏幕吸色' }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('00FF80'));
  });

  test('swallows a cancelled pick', async () => {
    stubEyeDropper(() => Promise.reject(new Error('AbortError')));
    const onPick = vi.fn();
    renderWithProviders(<EyeDropperButton onPick={onPick} />);
    await userEvent.click(screen.getByRole('button', { name: '屏幕吸色' }));
    await waitFor(() => expect(onPick).not.toHaveBeenCalled());
    expect(screen.getByRole('button', { name: '屏幕吸色' })).toBeInTheDocument();
  });
});
