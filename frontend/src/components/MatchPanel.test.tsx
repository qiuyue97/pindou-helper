import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { AuthProvider } from '../state/AuthContext';
import { ToastProvider } from '../state/ToastContext';
import { mockFetch, renderWithProviders } from '../test/utils';
import MatchPanel from './MatchPanel';

const base = {
  'GET /api/auth/me': { body: { username: 'amy', threshold: 500 } },
  'GET /api/colors': { body: [] },
  'GET /api/inventory': {
    body: [{ code: 'H7', quantity: 250, updated_at: '2026-08-31T10:00:00Z' }],
  },
  'GET /api/operations': { body: [] },
  'GET /api/inventory/stockout': { body: { codes: [], text: '', items: [] } },
};

const setup = (hex: string) =>
  renderWithProviders(
    <AuthProvider>
      <ToastProvider>
        <MatchPanel hex={hex} />
      </ToastProvider>
    </AuthProvider>,
  );

describe('MatchPanel', () => {
  test('names the exact catalogue colour for an exact hex', async () => {
    mockFetch(base);
    setup('000000'); // H7 is uniquely 000000 in the Mard catalogue
    const headline = await screen.findByTestId('match-headline');
    expect(headline).toHaveTextContent('H7');
    expect(headline).toHaveTextContent('几乎完全一致');
  });

  test('shows stock state for the candidates', async () => {
    mockFetch(base);
    setup('000000');
    await userEvent.click(await screen.findByText('更多候选'));
    const list = await screen.findByRole('table', { name: '候选色号' });
    expect(within(list).getByText('库存 250')).toBeInTheDocument();
  });

  test('restricting to 221 excludes the P/Q/R/T/Y/ZG series', async () => {
    mockFetch(base);
    setup('FFFFFF'); // T1 is uniquely FFFFFF and only exists in the 291 set
    expect(await screen.findByTestId('match-headline')).toHaveTextContent('T1');

    await userEvent.click(screen.getByRole('radio', { name: '221（A–M）' }));
    expect(await screen.findByTestId('match-headline')).not.toHaveTextContent('T1');
  });

  // NOTE: pick a colour the palette genuinely cannot match. Saturated GREEN is a bad
  // choice — CIEDE2000 compresses hard at high chroma and the catalogue has vivid
  // greens (63F347, 35E352), so #00FF00 lands under dE00 5. Magenta has no near
  // neighbour: the closest is E9 at dE00 ~11.6.
  test('reports a far-away colour honestly', async () => {
    mockFetch(base);
    setup('FF00FF');
    const headline = await screen.findByTestId('match-headline');
    expect(headline).toHaveTextContent('差异明显，色卡里可能没有很匹配的颜色');
  });
});
