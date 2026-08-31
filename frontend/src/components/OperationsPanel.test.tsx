import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { AuthProvider } from '../state/AuthContext';
import { ToastProvider } from '../state/ToastContext';
import { lastRequest, mockFetch, renderWithProviders } from '../test/utils';
import OperationsPanel from './OperationsPanel';

const ops = [
  {
    seq: 2,
    type: 'batch_deduct',
    summary: '批量扣减 A1 -30',
    entries: [{ code: 'A1', kind: 'deduct', amount: 30 }],
    voided: false,
    created_at: '2026-08-31T15:32:00Z',
    edited_at: null,
    note: null,
    scope_label: null,
    raw: 'A1,30',
  },
  {
    seq: 1,
    type: 'add_code',
    summary: '添加色号 A1 =100',
    entries: [{ code: 'A1', kind: 'set', amount: 100 }],
    voided: false,
    created_at: '2026-08-31T13:02:00Z',
    edited_at: null,
    note: null,
    scope_label: null,
    raw: null,
  },
];

const base = {
  'GET /api/auth/me': { body: { username: 'amy', threshold: 500 } },
  'GET /api/colors': { body: [] },
  'GET /api/inventory': { body: [{ code: 'A1', quantity: 70, updated_at: '2026-08-31T15:32:00Z' }] },
  'GET /api/operations?limit=50': { body: ops },
  'GET /api/inventory/stockout': { body: { codes: [], text: '', items: [] } },
};

const setup = () =>
  renderWithProviders(
    <AuthProvider>
      <ToastProvider>
        <OperationsPanel />
      </ToastProvider>
    </AuthProvider>,
  );

describe('OperationsPanel', () => {
  test('lists operations newest first', async () => {
    mockFetch(base);
    setup();
    const items = await screen.findAllByRole('listitem');
    expect(items[0]).toHaveTextContent('#2');
    expect(items[0]).toHaveTextContent('批量扣减 A1 -30');
    expect(items[1]).toHaveTextContent('#1');
  });

  test('undo previews the impact then voids on confirm', async () => {
    mockFetch({
      ...base,
      'POST /api/operations/2/impact': { body: { changes: [{ code: 'A1', from: 70, to: 100 }] } },
      'POST /api/operations/2/void': { body: { changes: [{ code: 'A1', from: 70, to: 100 }] } },
    });
    setup();
    const first = (await screen.findAllByRole('listitem'))[0]!;
    await userEvent.click(within(first).getByRole('button', { name: '撤销' }));

    const preview = await screen.findByRole('table', { name: '影响预览' });
    expect(preview).toHaveTextContent('A1');
    expect(preview).toHaveTextContent('70');
    expect(preview).toHaveTextContent('100');
    expect(lastRequest('POST', '/api/operations/2/void')).toBeUndefined();

    await userEvent.click(screen.getByRole('button', { name: '确认撤销' }));
    await waitFor(() => expect(lastRequest('POST', '/api/operations/2/void')).toBeDefined());
    expect(await screen.findByRole('status')).toHaveTextContent('A1 70→100');
  });

  test('restores a voided operation without a preview', async () => {
    mockFetch({
      ...base,
      'GET /api/operations?limit=50': { body: [{ ...ops[0]!, voided: true }, ops[1]!] },
      'POST /api/operations/2/restore': { body: { changes: [{ code: 'A1', from: 100, to: 70 }] } },
    });
    setup();
    const first = (await screen.findAllByRole('listitem'))[0]!;
    expect(first).toHaveClass('voided');
    await userEvent.click(within(first).getByRole('button', { name: '恢复' }));
    await waitFor(() => expect(lastRequest('POST', '/api/operations/2/restore')).toBeDefined());
  });

  test('edits a batch operation via the prefilled dialog', async () => {
    mockFetch({
      ...base,
      'PATCH /api/operations/2': { body: { changes: [{ code: 'A1', from: 70, to: 60 }] } },
    });
    setup();
    const first = (await screen.findAllByRole('listitem'))[0]!;
    await userEvent.click(within(first).getByRole('button', { name: '编辑' }));

    const ta = (await screen.findByLabelText('批量输入')) as HTMLTextAreaElement;
    expect(ta.value).toBe('A1,30');
    await userEvent.clear(ta);
    await userEvent.type(ta, 'A1,40');
    await userEvent.click(screen.getByRole('button', { name: '应用' }));

    await waitFor(() => expect(lastRequest('PATCH', '/api/operations/2')).toBeDefined());
    expect(JSON.parse(String(lastRequest('PATCH', '/api/operations/2')!.init!.body))).toEqual({
      type: 'batch_deduct',
      payload: { raw: 'A1,40', lines: [{ code: 'A1', qty: 40 }] },
    });
  });

  test('an ALL operation shows its scope and edits within that same scope', async () => {
    const allOp = {
      seq: 3,
      type: 'batch_add',
      summary: '批量补货 ALL(221) +100',
      entries: [{ code: 'ALL', kind: 'add', amount: 100 }],
      voided: false,
      created_at: '2026-08-31T16:00:00Z',
      edited_at: null,
      note: null,
      scope_label: 'ALL(221)',
      raw: 'ALL,100',
    };
    mockFetch({
      ...base,
      'GET /api/operations?limit=50': { body: [allOp] },
      'PATCH /api/operations/3': { body: { changes: [{ code: 'A1', from: 100, to: 80 }] } },
    });
    setup();

    const first = (await screen.findAllByRole('listitem'))[0]!;
    expect(first).toHaveTextContent('ALL(221)');
    // one entry, not 221
    await userEvent.click(within(first).getByRole('button', { name: '编辑' }));

    const ta = (await screen.findByLabelText('批量输入')) as HTMLTextAreaElement;
    expect(ta.value).toBe('ALL,100');
    await userEvent.clear(ta);
    await userEvent.type(ta, 'ALL,80');
    await userEvent.click(screen.getByRole('button', { name: '应用' }));

    await waitFor(() => expect(lastRequest('PATCH', '/api/operations/3')).toBeDefined());
    const body = JSON.parse(String(lastRequest('PATCH', '/api/operations/3')!.init!.body));
    expect(body.payload.scope).toEqual({ kind: 'all', set: '221', include_custom: true });
    expect(body.payload.raw).toBe('ALL,80');
    expect(body.payload.lines).toHaveLength(221);
    expect(body.payload.lines.every((l: { qty: number }) => l.qty === 80)).toBe(true);
  });
});
