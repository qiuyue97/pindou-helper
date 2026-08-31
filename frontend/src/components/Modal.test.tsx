import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { renderWithProviders } from '../test/utils';
import Modal from './Modal';

describe('Modal', () => {
  test('renders a labelled dialog with its children', () => {
    renderWithProviders(
      <Modal title="测试" onClose={() => {}}>
        <p>内容</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: '测试' })).toBeInTheDocument();
    expect(screen.getByText('内容')).toBeInTheDocument();
  });

  test('closes on Escape and on backdrop click', async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <Modal title="测试" onClose={onClose}>
        <p>内容</p>
      </Modal>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
