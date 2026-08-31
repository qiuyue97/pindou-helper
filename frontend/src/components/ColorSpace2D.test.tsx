import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { buildEffectiveCatalog, loadBaseCatalog } from '../color/catalog';
import { renderWithProviders } from '../test/utils';
import ColorSpace2D from './ColorSpace2D';

const candidates = buildEffectiveCatalog(loadBaseCatalog(), []);

describe('ColorSpace2D', () => {
  test('renders both canvases without a 2D context (jsdom)', () => {
    renderWithProviders(<ColorSpace2D sampleHex="7F7F7F" candidates={candidates} />);
    expect(screen.getByLabelText('a*–b* 平面')).toBeInTheDocument();
    expect(screen.getByLabelText('L* 明度')).toBeInTheDocument();
  });

  test('legends the plotted codes, capped at 12', () => {
    renderWithProviders(<ColorSpace2D sampleHex="7F7F7F" candidates={candidates} />);
    const legend = screen.getByRole('list', { name: '图中色号' });
    const items = within(legend).getAllByRole('listitem');
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(12);
  });

  test('survives a single candidate', () => {
    renderWithProviders(<ColorSpace2D sampleHex="000000" candidates={candidates.slice(0, 1)} />);
    expect(screen.getByLabelText('a*–b* 平面')).toBeInTheDocument();
  });

  test('exposes zoom controls that change the zoom factor', async () => {
    renderWithProviders(<ColorSpace2D sampleHex="7F7F7F" candidates={candidates} />);
    const readout = screen.getByTestId('plane-zoom');
    expect(readout).toHaveTextContent('1.0×');

    await userEvent.click(screen.getByRole('button', { name: '放大' }));
    expect(readout).toHaveTextContent('1.4×');

    await userEvent.click(screen.getByRole('button', { name: '重置视图' }));
    expect(readout).toHaveTextContent('1.0×');
  });

  test('zoom is clamped so the plot cannot be lost', async () => {
    renderWithProviders(<ColorSpace2D sampleHex="7F7F7F" candidates={candidates} />);
    const out = screen.getByRole('button', { name: '缩小' });
    for (let i = 0; i < 12; i++) await userEvent.click(out);
    expect(screen.getByTestId('plane-zoom')).toHaveTextContent('0.5×');
  });

  test('tells the user how to interact', () => {
    renderWithProviders(<ColorSpace2D sampleHex="7F7F7F" candidates={candidates} />);
    expect(screen.getByText(/滚轮缩放/)).toBeInTheDocument();
  });
});
