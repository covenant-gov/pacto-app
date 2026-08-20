// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import ExportAllSecretsModal from './ExportAllSecretsModal.svelte';
import { exportSensitiveToClipboard } from '../../lib/api/auth';
import { listEvmAccounts } from '../../lib/wallet/evm-accounts';

vi.mock('../../lib/api/auth', () => ({
  exportSensitiveToClipboard: vi.fn(),
}));

vi.mock('../../lib/wallet/evm-accounts', () => ({
  listEvmAccounts: vi.fn(),
}));

const mockedExport = vi.mocked(exportSensitiveToClipboard);
const mockedListEvm = vi.mocked(listEvmAccounts);

beforeEach(() => {
  mockedExport.mockReset();
  mockedListEvm.mockReset();
  cleanup();
});

async function enterPin(inputs: HTMLElement[], pin: string) {
  for (let i = 0; i < pin.length; i++) {
    await fireEvent.input(inputs[i], { target: { value: pin[i] } });
  }
}

describe('ExportAllSecretsModal', () => {
  it('renders the confirmation warning before the PIN step', () => {
    render(ExportAllSecretsModal, { props: { open: true } });
    expect(
      screen.getByText(/Clipboard managers, OS clipboard history, and cross-device clipboard sync/)
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Continue/i })).toBeTruthy();
    expect(screen.queryByText('0xdeadbeef')).toBeNull();
  });

  it('exports nsec, seed, and each EVM account sequentially and shows the summary', async () => {
    mockedExport
      .mockResolvedValueOnce({ exportType: 'nostr', accountId: '', clearedAt: 1000 })
      .mockResolvedValueOnce({ exportType: 'seed', accountId: '', clearedAt: 2000 })
      .mockResolvedValueOnce({ exportType: 'evm', accountId: 'acc-1', clearedAt: 3000 })
      .mockResolvedValueOnce({ exportType: 'evm', accountId: 'acc-2', clearedAt: 4000 });

    mockedListEvm.mockResolvedValueOnce([
      {
        id: 'acc-1',
        scheme: 'bip44_v1',
        hdIndex: 0,
        address: '0xAAA',
        label: 'Squad',
        purpose: 'squad',
        isActive: false,
        isDefaultShared: false,
        isActiveAdvanced: false,
      },
      {
        id: 'acc-2',
        scheme: 'imported_private_key',
        hdIndex: null,
        address: '0xBBB',
        label: '',
        purpose: 'advanced',
        isActive: false,
        isDefaultShared: false,
        isActiveAdvanced: false,
      },
    ]);

    render(ExportAllSecretsModal, { props: { open: true } });
    await fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    const inputs = screen.getAllByLabelText(/PIN digit/i);
    await enterPin(inputs, '123456');

    await waitFor(() => expect(mockedExport).toHaveBeenCalledTimes(4));
    expect(mockedExport).toHaveBeenNthCalledWith(1, 'nostr', undefined, '123456');
    expect(mockedExport).toHaveBeenNthCalledWith(2, 'seed', undefined, '123456');
    expect(mockedExport).toHaveBeenNthCalledWith(3, 'evm', 'acc-1', '123456');
    expect(mockedExport).toHaveBeenNthCalledWith(4, 'evm', 'acc-2', '123456');
    expect(screen.getByText(/Copied to clipboard/)).toBeTruthy();
    expect(screen.getByText(/0xAAA/)).toBeTruthy();
    expect(screen.getByText(/0xBBB/)).toBeTruthy();
  });

  it('stops the sequence and shows a non-secret error when a backend export fails', async () => {
    mockedExport
      .mockResolvedValueOnce({ exportType: 'nostr', accountId: '', clearedAt: 1000 })
      .mockRejectedValueOnce(new Error('Seed not stored'));

    render(ExportAllSecretsModal, { props: { open: true } });
    await fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    const inputs = screen.getAllByLabelText(/PIN digit/i);
    await enterPin(inputs, '111111');

    await waitFor(() => expect(screen.getByRole('heading', { name: /Export failed/i })).toBeTruthy()
    );
    expect(screen.getByText(/Seed not stored/)).toBeTruthy();
    expect(mockedExport).toHaveBeenCalledTimes(2);
  });

  it('never holds or displays a raw secret string', async () => {
    mockedExport
      .mockResolvedValueOnce({ exportType: 'nostr', accountId: '', clearedAt: 1000 })
      .mockResolvedValueOnce({ exportType: 'seed', accountId: '', clearedAt: 2000 });
    mockedListEvm.mockResolvedValueOnce([]);

    render(ExportAllSecretsModal, { props: { open: true } });
    await fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    const inputs = screen.getAllByLabelText(/PIN digit/i);
    await enterPin(inputs, '222222');

    await waitFor(() => expect(screen.getByText(/Copied to clipboard/)).toBeTruthy());
    expect(screen.getByText(/Nostr private key/)).toBeTruthy();
    expect(screen.getByText(/Seed phrase/)).toBeTruthy();
    expect(screen.queryByText('supersecret')).toBeNull();
  });
});
