import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { renderWithProviders } from '../test/utils';
import ImageSampler from './ImageSampler';

const setup = () => {
  const onPreview = vi.fn();
  const onCommit = vi.fn();
  renderWithProviders(<ImageSampler onPreview={onPreview} onCommit={onCommit} />);
  return { onPreview, onCommit };
};

describe('ImageSampler', () => {
  test('shows the hover hint and a disabled confirm before any image', () => {
    setup();
    expect(screen.getByText('选择或拍一张照片，鼠标滑过即可取色。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取此点' })).toBeDisabled();
  });

  test('accepts any image without forcing the camera', () => {
    setup();
    const input = screen.getByLabelText('上传图片');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', 'image/*');
    // `capture` must stay off: iOS Safari treats it as "open the camera now"
    // and never offers the photo library, which makes existing images
    // unpickable. Its absence is the whole fix, so assert it explicitly.
    expect(input).not.toHaveAttribute('capture');
  });

  test('renders zoom controls that are safe with no image loaded', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: '放大' }));
    await userEvent.click(screen.getByRole('button', { name: '缩小' }));
    expect(screen.getByLabelText('图片取色')).toBeInTheDocument();
  });

  test('explains the follow / lock interaction', () => {
    setup();
    expect(screen.getByTestId('sampler-hint')).toHaveTextContent('滑过图片实时预览，左键点击锁定');
  });

  test('does not commit just from moving the pointer', async () => {
    const { onCommit } = setup();
    await userEvent.hover(screen.getByLabelText('图片取色'));
    expect(onCommit).not.toHaveBeenCalled();
  });
});
