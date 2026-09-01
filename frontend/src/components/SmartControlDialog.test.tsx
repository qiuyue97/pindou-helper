import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { AuthProvider } from '../state/AuthContext';
import { ToastProvider } from '../state/ToastContext';
import { lastRequest, mockFetch, renderWithProviders } from '../test/utils';
import SmartControlDialog from './SmartControlDialog';

const base = {
  'GET /api/auth/me': { body: { username: 'amy', threshold: 500, is_vip: true } },
  'GET /api/colors': { body: [] },
  'GET /api/inventory': { body: [] },
  'GET /api/operations': { body: [] },
  'GET /api/inventory/stockout': { body: { codes: [], text: '', items: [] } },
  'POST /api/smart/extract': {
    body: {
      lines: [
        { code: 'A1', delta: 200, source: 'A1 补 200' },
        { code: 'B3', delta: -50, source: 'B3 用掉了 50' },
      ],
      unresolved: [],
      model: 'Kimi-K3-256K',
    },
  },
};

const applied = {
  'POST /api/inventory/batch': {
    body: { ok: true, applied: true, results: [], changes: [{ code: 'A1', from: 0, to: 200 }] },
  },
};

/** Captures each batch body so the split into add/deduct can be asserted. */
function recordingBatch(bodies: string[]) {
  return {
    'POST /api/inventory/batch': (req: { init?: RequestInit }) => {
      bodies.push(String(req.init!.body));
      return { body: { ok: true, applied: true, results: [], changes: [] } };
    },
  };
}

const render = (onClose = vi.fn()) =>
  renderWithProviders(
    <AuthProvider>
      <ToastProvider>
        <SmartControlDialog onClose={onClose} />
      </ToastProvider>
    </AuthProvider>,
  );

/** Run an extraction so the editable table is on screen. */
async function extractOnce(sentence = 'A1 补 200，B3 用掉了 50') {
  await userEvent.type(screen.getByLabelText('自然语言输入'), sentence);
  await userEvent.click(screen.getByRole('button', { name: '识别' }));
  return screen.findByRole('table', { name: '识别结果' });
}

const submit = () => userEvent.click(screen.getByRole('button', { name: '确认并提交' }));
const submitButton = () => screen.getByRole('button', { name: '确认并提交' });

describe('SmartControlDialog', () => {
  test('shows the extracted rows and touches nothing until submitted', async () => {
    mockFetch({ ...base, ...applied });
    render();
    expect(submitButton()).toBeDisabled();

    const table = await extractOnce();
    expect(within(table).getByLabelText('第 1 行 色号')).toHaveValue('A1');
    expect(within(table).getByLabelText('第 1 行 数量')).toHaveValue('200');
    expect(screen.getByText('Kimi-K3-256K')).toBeInTheDocument();
    expect(lastRequest('POST', '/api/inventory/batch')).toBeUndefined();
  });

  // ---------- editing ----------

  test('the sign is its own dropdown, preset from the sign of delta', async () => {
    mockFetch({ ...base, ...applied });
    render();
    await extractOnce();
    expect(screen.getByLabelText('第 1 行 增减')).toHaveValue('+');
    expect(screen.getByLabelText('第 2 行 增减')).toHaveValue('-');
  });

  test('flipping the dropdown moves the row into the other batch', async () => {
    const bodies: string[] = [];
    mockFetch({ ...base, ...recordingBatch(bodies) });
    render();
    await extractOnce();

    await userEvent.selectOptions(screen.getByLabelText('第 1 行 增减'), '-');
    await submit();

    await waitFor(() => expect(bodies).toHaveLength(1));
    // Both rows are deductions now, so there is a single deduct batch.
    expect(JSON.parse(bodies[0]!)).toEqual({ mode: 'deduct', text: 'A1,200\nB3,50' });
  });

  test('the quantity can be edited', async () => {
    const bodies: string[] = [];
    mockFetch({ ...base, ...recordingBatch(bodies) });
    render();
    await extractOnce();

    const qty = screen.getByLabelText('第 1 行 数量');
    await userEvent.clear(qty);
    await userEvent.type(qty, '75');
    await submit();

    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(JSON.parse(bodies[0]!)).toEqual({ mode: 'add', text: 'A1,75' });
  });

  test('the code can be corrected, and lower case is normalised', async () => {
    const bodies: string[] = [];
    mockFetch({ ...base, ...recordingBatch(bodies) });
    render();
    await extractOnce();

    const code = screen.getByLabelText('第 1 行 色号');
    await userEvent.clear(code);
    await userEvent.type(code, 'c7');
    await submit();

    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(JSON.parse(bodies[0]!)).toEqual({ mode: 'add', text: 'C7,200' });
  });

  // ---------- adding and removing rows ----------

  test('a row can be deleted', async () => {
    mockFetch({ ...base, ...applied });
    render();
    const table = await extractOnce();
    expect(within(table).getAllByRole('row')).toHaveLength(3); // header + 2

    await userEvent.click(screen.getByRole('button', { name: '删除第 2 行' }));
    expect(within(table).getAllByRole('row')).toHaveLength(2);
  });

  test('deletes the row that was clicked, not the one at that index afterwards', async () => {
    mockFetch({ ...base, ...applied });
    render();
    await extractOnce();
    // Remove the FIRST row; what remains must be B3 with its own sign intact.
    await userEvent.click(screen.getByRole('button', { name: '删除第 1 行' }));
    expect(screen.getByLabelText('第 1 行 色号')).toHaveValue('B3');
    expect(screen.getByLabelText('第 1 行 增减')).toHaveValue('-');
  });

  test('a row can be added and filled in by hand', async () => {
    const bodies: string[] = [];
    mockFetch({ ...base, ...recordingBatch(bodies) });
    render();
    await extractOnce();

    await userEvent.click(screen.getByRole('button', { name: /添加一行/ }));
    // A blank row blocks submission until it is filled in.
    expect(submitButton()).toBeDisabled();

    await userEvent.type(screen.getByLabelText('第 3 行 色号'), 'C7');
    await userEvent.clear(screen.getByLabelText('第 3 行 数量'));
    await userEvent.type(screen.getByLabelText('第 3 行 数量'), '9');
    await submit();

    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(JSON.parse(bodies[0]!)).toEqual({ mode: 'add', text: 'A1,200\nC7,9' });
    expect(JSON.parse(bodies[1]!)).toEqual({ mode: 'deduct', text: 'B3,50' });
  });

  test('an added row defaults to 增加', async () => {
    mockFetch({ ...base, ...applied });
    render();
    await extractOnce();
    await userEvent.click(screen.getByRole('button', { name: /添加一行/ }));
    expect(screen.getByLabelText('第 3 行 增减')).toHaveValue('+');
  });

  test('deleting every row blocks submission', async () => {
    mockFetch({ ...base, ...applied });
    render();
    await extractOnce();
    await userEvent.click(screen.getByRole('button', { name: '删除第 2 行' }));
    await userEvent.click(screen.getByRole('button', { name: '删除第 1 行' }));
    expect(submitButton()).toBeDisabled();
  });

  // ---------- validation ----------

  test('an unknown code blocks submission and says why', async () => {
    mockFetch({ ...base, ...applied });
    render();
    await extractOnce();
    const code = screen.getByLabelText('第 1 行 色号');
    await userEvent.clear(code);
    await userEvent.type(code, 'ZZZ9');
    expect(screen.getByText('色号不存在')).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  test('a non-numeric quantity blocks submission', async () => {
    mockFetch({ ...base, ...applied });
    render();
    await extractOnce();
    const qty = screen.getByLabelText('第 1 行 数量');
    await userEvent.clear(qty);
    await userEvent.type(qty, 'abc');
    expect(screen.getByText('数量应为正整数')).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  test('zero is refused — a row that changes nothing is a mistake', async () => {
    mockFetch({ ...base, ...applied });
    render();
    await extractOnce();
    const qty = screen.getByLabelText('第 1 行 数量');
    await userEvent.clear(qty);
    await userEvent.type(qty, '0');
    expect(submitButton()).toBeDisabled();
  });

  test('a bad row can be fixed and then submitted', async () => {
    mockFetch({ ...base, ...applied });
    render();
    await extractOnce();
    const qty = screen.getByLabelText('第 1 行 数量');
    await userEvent.clear(qty);
    expect(submitButton()).toBeDisabled();
    await userEvent.type(qty, '12');
    expect(submitButton()).toBeEnabled();
  });

  // ---------- server interaction ----------

  test('submits adds and deducts as separate signed batches', async () => {
    const bodies: string[] = [];
    mockFetch({ ...base, ...recordingBatch(bodies) });
    const onClose = vi.fn();
    render(onClose);
    await extractOnce();
    await submit();

    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(JSON.parse(bodies[0]!)).toEqual({ mode: 'add', text: 'A1,200' });
    // The deduct carries a positive magnitude; the sign lives in the mode.
    expect(JSON.parse(bodies[1]!)).toEqual({ mode: 'deduct', text: 'B3,50' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  test('shows unresolved fragments the model could not place', async () => {
    mockFetch({
      ...base,
      'POST /api/smart/extract': {
        body: { lines: [], unresolved: ['今天天气不错'], model: 'GLM-5.2' },
      },
    });
    render();
    // A different sentence from the fragment, so the assertion cannot also match
    // the textarea's own value.
    await extractOnce('随便说点什么');
    expect(screen.getByText(/^未能识别：/)).toHaveTextContent('今天天气不错');
  });

  test('an empty extraction still offers a table to fill in by hand', async () => {
    mockFetch({
      ...base,
      ...applied,
      'POST /api/smart/extract': { body: { lines: [], unresolved: [], model: 'GLM-5.2' } },
    });
    render();
    await extractOnce('看不懂的话');
    expect(screen.getByRole('button', { name: /添加一行/ })).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  test('surfaces the server error instead of pretending it worked', async () => {
    mockFetch({
      ...base,
      'POST /api/smart/extract': {
        status: 503,
        body: { detail: '识别服务暂时不可用，请稍后再试' },
      },
    });
    render();
    await userEvent.type(screen.getByLabelText('自然语言输入'), 'A1 补 200');
    await userEvent.click(screen.getByRole('button', { name: '识别' }));
    expect(await screen.findByRole('status')).toHaveTextContent('识别服务暂时不可用');
    expect(screen.queryByRole('table', { name: '识别结果' })).not.toBeInTheDocument();
  });

  test('a normal account is refused by the server, not just by the UI', async () => {
    mockFetch({
      ...base,
      'POST /api/smart/extract': { status: 403, body: { detail: 'VIP only' } },
    });
    render();
    await userEvent.type(screen.getByLabelText('自然语言输入'), 'A1 补 200');
    await userEvent.click(screen.getByRole('button', { name: '识别' }));
    expect(await screen.findByRole('status')).toHaveTextContent('VIP only');
  });
});
