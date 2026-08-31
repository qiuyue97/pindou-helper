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

  test('tells the user hovering reveals the code', () => {
    renderWithProviders(<ColorSpace3D sampleHex="7F7F7F" candidates={candidates} />);
    expect(screen.getByText(/悬停看色号/)).toBeInTheDocument();
  });

  test('has zoom controls that reset along with the angles', async () => {
    renderWithProviders(<ColorSpace3D sampleHex="7F7F7F" candidates={candidates} />);
    const zoom = screen.getByTestId('orbit-zoom');
    expect(zoom).toHaveTextContent('1.0×');
    await userEvent.click(screen.getByRole('button', { name: '放大' }));
    expect(zoom).toHaveTextContent('1.4×');
    await userEvent.click(screen.getByRole('button', { name: '重置视角' }));
    expect(zoom).toHaveTextContent('1.0×');
    expect(screen.getByTestId('view-angles')).toHaveTextContent('35');
  });

  test('mentions the axes and the new interactions', () => {
    renderWithProviders(<ColorSpace3D sampleHex="7F7F7F" candidates={candidates} />);
    expect(screen.getByText(/滚轮缩放/)).toBeInTheDocument();
  });
});
