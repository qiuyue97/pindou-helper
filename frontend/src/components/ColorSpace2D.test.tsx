import { screen, within } from '@testing-library/react';
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
});
