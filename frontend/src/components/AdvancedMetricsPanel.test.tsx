import { screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { buildEffectiveCatalog, loadBaseCatalog } from '../color/catalog';
import { renderWithProviders } from '../test/utils';
import AdvancedMetricsPanel from './AdvancedMetricsPanel';

const candidates = buildEffectiveCatalog(loadBaseCatalog(), []);

describe('AdvancedMetricsPanel', () => {
  test('shows both comparison rankings', () => {
    renderWithProviders(<AdvancedMetricsPanel sampleHex="7F7F7F" candidates={candidates} />);
    expect(screen.getByRole('table', { name: '马氏距离' })).toBeInTheDocument();
    const euclid = screen.getByRole('table', { name: '纯欧氏（旧版对照）' });
    expect(within(euclid).getAllByRole('row').length).toBe(6); // header + 5
  });
});
