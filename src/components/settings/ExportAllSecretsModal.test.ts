// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import ExportAllSecretsModal from './ExportAllSecretsModal.svelte';
import { clearClipboard, exportSensitiveToClipboard } from '../../lib/api/auth';
import { listEvmAccounts } from '../../lib/wallet/evm-accounts';

vi.mock('../../lib/api/auth', () => ({
  exportSensitiveToClipboard: vi.fn(),
  clearClipboard: vi.fn(),
}));

vi.mock('../../lib/wallet/evm-accounts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/wallet/evm-accounts')>();
  return {
    ...actual,
    listEvmAccounts: vi.fn(),
  };
});

const mockedExport = vi.mocked(exportSensitiveToClipboard);
const mockedClear = vi.mocked(clearClipboard);
const mockedList = vi.mocked(listEvmAccounts);

const evmAccounts = [
  {
    id: 'acc-1',
    scheme: 'bip44_v1',
    hdIndex: 0,
    address: '0xaaa0000000000000000000000000000000aaa',
    label: 'Squad',
    purpose: 'squad' as const,
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
    purpose: 'advanced' as const,
    isActive: false,
    isDefaultShared: false,
    isActiveAdvanced: false,
  },
];

beforeEach(() => {
  mockedExport.mockReset();
  mockedClear.mockReset();
  mockedClear.mockResolvedValue(undefined);
  mockedList.mockReset();
  mockedList.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

async function enterPin(pin = '123456') {
  for (let i = 0; i < pin.length; i++) {
    await fireEvent.input(screen.getByLabelText(`PIN digit ${i + 1}`), {
      target: { value: pin[i] },
    });
  }
}

function copyNamed(name: string): HTMLButtonElement {
  return screen.getByRole('button', {
    name: `Copy ${name} to the clipboard`,
  }) as HTMLButtonElement;
}

describe('ExportAllSecretsModal', () => {
  it('shows the warning and does not copy until a secret’s own action is used', async () => {
    render(ExportAllSecretsModal, { props: { open: true } });

    expect(screen.getByRole('heading', { name: 'Export all' })).toBeTruthy();
    expect(screen.getByText(/Anyone with these secrets can control your account/)).toBeTruthy();
    expect(screen.getByText('Secrets on this device')).toBeTruthy();
    expect(screen.getByText(/Each secret is copied separately/)).toBeTruthy();
    expect(copyNamed('Nostr private key').disabled).toBe(true);
    expect(screen.queryByText('supersecret')).toBeNull();

    await enterPin();
    expect(copyNamed('Nostr private key').disabled).toBe(false);
    expect(mockedExport).not.toHaveBeenCalled();
  });

  it('copies one secret per action and lists what was copied without the secret itself', async () => {
    mockedList.mockResolvedValueOnce(evmAccounts);
    mockedExport.mockResolvedValue({
      exportType: 'evm',
      accountId: 'acc-1',
      clearedAt: 1,
    });

    render(ExportAllSecretsModal, { props: { open: true } });
    expect(await screen.findByText('0xaaa000…000aaa')).toBeTruthy();
    expect(screen.getByText('0xBBB')).toBeTruthy();

    await enterPin('123456');
    await fireEvent.click(copyNamed('Nostr private key'));
    await waitFor(() => expect(mockedExport).toHaveBeenCalledTimes(1));
    expect(mockedExport).toHaveBeenCalledWith('nostr', undefined, '123456');
    expect(screen.getByText('Copied. Clears in 90 seconds.')).toBeTruthy();

    await fireEvent.click(copyNamed('Seed phrase'));
    await waitFor(() => expect(mockedExport).toHaveBeenCalledTimes(2));
    expect(mockedExport).toHaveBeenNthCalledWith(2, 'seed', undefined, '123456');

    await fireEvent.click(copyNamed('Squad'));
    await waitFor(() => expect(mockedExport).toHaveBeenCalledTimes(3));
    expect(mockedExport).toHaveBeenNthCalledWith(3, 'evm', 'acc-1', '123456');

    await fireEvent.click(copyNamed('0xBBB'));
    await waitFor(() => expect(mockedExport).toHaveBeenCalledTimes(4));
    expect(mockedExport).toHaveBeenNthCalledWith(4, 'evm', 'acc-2', '123456');
    expect(screen.queryByText('supersecret')).toBeNull();
  });

  it('offers a clipboard clear only after something was copied', async () => {
    mockedExport.mockResolvedValueOnce({ exportType: 'nostr', accountId: '', clearedAt: 1 });

    render(ExportAllSecretsModal, { props: { open: true } });
    await enterPin();
    expect(screen.queryByRole('button', { name: 'Clear clipboard now' })).toBeNull();

    await fireEvent.click(copyNamed('Nostr private key'));
    const clearButton = await screen.findByRole('button', { name: 'Clear clipboard now' });

    await fireEvent.click(clearButton);
    await waitFor(() => expect(mockedClear).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('The secret is no longer on your clipboard.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear clipboard now' })).toBeNull();
  });

  it('stops on a failed secret and leaves the others uncopied', async () => {
    mockedExport
      .mockResolvedValueOnce({ exportType: 'nostr', accountId: '', clearedAt: 1 })
      .mockRejectedValueOnce(new Error('Seed not stored'));

    render(ExportAllSecretsModal, { props: { open: true } });
    await enterPin('111111');
    await fireEvent.click(copyNamed('Nostr private key'));
    await waitFor(() => expect(mockedExport).toHaveBeenCalledTimes(1));

    await fireEvent.click(copyNamed('Seed phrase'));
    expect(await screen.findByText('Seed not stored')).toBeTruthy();
    expect(mockedExport).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('supersecret')).toBeNull();
  });

  it('shows a per-secret backoff and an empty EVM list', async () => {
    mockedList.mockResolvedValueOnce([]);
    mockedExport.mockRejectedValueOnce(
      new Error('Too many export attempts. Please wait 4 seconds.')
    );

    render(ExportAllSecretsModal, { props: { open: true } });
    expect(await screen.findByText('No EVM accounts on this device.')).toBeTruthy();

    await enterPin();
    await fireEvent.click(copyNamed('Seed phrase'));
    expect(await screen.findByText(/Try again in 4s/)).toBeTruthy();
    expect(copyNamed('Nostr private key').disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Wait 4s' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('shows a loading state, then an error with retry', async () => {
    let resolveList: (rows: []) => void = () => {};
    mockedList.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        })
    );

    const { rerender } = render(ExportAllSecretsModal, { props: { open: true } });
    expect(screen.getByText('Loading accounts…')).toBeTruthy();
    resolveList([]);
    expect(await screen.findByText('No EVM accounts on this device.')).toBeTruthy();

    mockedList.mockRejectedValueOnce(new Error('database locked'));
    await rerender({ open: false });
    await rerender({ open: true });
    expect(await screen.findByText('database locked')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(copyNamed('Nostr private key')).toBeTruthy();
  });
});
