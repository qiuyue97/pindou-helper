import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { buildEffectiveCatalog, loadBaseCatalog } from '../color/catalog';
import { renderWithProviders } from '../test/utils';
import ColorSpace3D from './ColorSpace3D';

const candidates = buildEffectiveCatalog(loadBaseCatalog(), []);

describe('ColorSpace3D', () => {
  test('renders a canvas and a reset control', () => {
    renderWithProviders(<ColorSpace3D sampleHex="7F7F7F" candidates={candidates} />);
    expect(screen.getByLabelText('CIELAB 三维视图')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重置视角' })).toBeInTheDocument();
  });

  test('reports the current view angles and resets them', async () => {
    renderWithProviders(<ColorSpace3D sampleHex="7F7F7F" candidates={candidates} />);
    const readout = screen.getByTestId('view-angles');
    expect(readout).toHaveTextContent('35');
    expect(readout).toHaveTextContent('20');
    await userEvent.click(screen.getByRole('button', { name: '重置视角' }));
    expect(readout).toHaveTextContent('35');
  });
});
