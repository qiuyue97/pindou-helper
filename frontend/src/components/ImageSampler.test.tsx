import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { renderWithProviders } from '../test/utils';
import ImageSampler from './ImageSampler';

describe('ImageSampler', () => {
  test('shows the empty state and a disabled confirm before any image', () => {
    renderWithProviders(<ImageSampler onPick={vi.fn()} />);
    expect(screen.getByText('选择或拍一张照片，然后点图片取色。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取此点' })).toBeDisabled();
  });

  test('exposes a camera-capable file input', () => {
    renderWithProviders(<ImageSampler onPick={vi.fn()} />);
    const input = screen.getByLabelText('上传图片');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', 'image/*');
    expect(input).toHaveAttribute('capture', 'environment');
  });

  test('renders zoom controls that are safe with no image loaded', async () => {
    renderWithProviders(<ImageSampler onPick={vi.fn()} />);
    expect(screen.getByRole('button', { name: '放大' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '缩小' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '放大' }));
    await userEvent.click(screen.getByRole('button', { name: '缩小' }));
    expect(screen.getByLabelText('图片取色')).toBeInTheDocument();
  });
});
