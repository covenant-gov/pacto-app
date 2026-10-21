// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import EvmAccountKeyExportModal from './EvmAccountKeyExportModal.svelte';
import { clearClipboard, exportSensitiveToClipboard } from '../../lib/api/auth';

vi.mock('../../lib/api/auth', () => ({
  exportSensitiveToClipboard: vi.fn(),
  clearClipboard: vi.fn(),
}));

const mockedExport = vi.mocked(exportSensitiveToClipboard);
const mockedClear = vi.mocked(clearClipboard);

beforeEach(() => {
  mockedExport.mockReset();
  mockedClear.mockReset();
  mockedClear.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

const evmAccount = {
  id: 'acc-1',
  scheme: 'bip44_v1',
  hdIndex: 0,
  address: '0xabc0000000000000000000000000000000abc',
  label: 'Main',
  purpose: 'advanced' as const,
  isActive: false,
  isDefaultShared: false,
  isActiveAdvanced: false,
};

async function enterPin(pin = '123456') {
  for (let i = 0; i < pin.length; i++) {
    await fireEvent.input(screen.getByLabelText(`PIN digit ${i + 1}`), {
      target: { value: pin[i] },
    });
  }
}

function copyButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Copy to clipboard' }) as HTMLButtonElement;
}

describe('EvmAccountKeyExportModal', () => {
  it('shows the warning and keeps the copy action off until the PIN is complete', () => {
    render(EvmAccountKeyExportModal, {
      props: { open: true, variant: 'evm', account: evmAccount },
    });

    expect(screen.getByRole('heading', { name: 'Export private key' })).toBeTruthy();
    expect(screen.getByText(/Anyone with this key controls the account/)).toBeTruthy();
    expect(
      screen.getByText(/Clipboard managers, OS clipboard history, and cross-device clipboard sync/)
    ).toBeTruthy();
    expect(copyButton().disabled).toBe(true);
    expect(screen.queryByText('0xsecretprivatekey')).toBeNull();
    expect(mockedExport).not.toHaveBeenCalled();
  });

  it('copies through the backend and shows the 90 second clear, without rendering the secret', async () => {
    mockedExport.mockResolvedValueOnce({
      exportType: 'evm',
      accountId: 'acc-1',
      clearedAt: 1234567890,
    });

    render(EvmAccountKeyExportModal, {
      props: { open: true, variant: 'evm', account: evmAccount },
    });
    await enterPin('123456');
    expect(copyButton().disabled).toBe(false);
    await fireEvent.click(copyButton());

    await waitFor(() => expect(mockedExport).toHaveBeenCalledWith('evm', 'acc-1', '123456'));
    expect(screen.getByText('Copied to clipboard')).toBeTruthy();
    expect(screen.getByText(/It will be cleared in 90 seconds/)).toBeTruthy();
    expect(screen.queryByText('0xsecretprivatekey')).toBeNull();
  });

  it('clears the clipboard on demand once a secret has been copied', async () => {
    mockedExport.mockResolvedValueOnce({ exportType: 'evm', accountId: 'acc-1', clearedAt: 1 });

    render(EvmAccountKeyExportModal, {
      props: { open: true, variant: 'evm', account: evmAccount },
    });
    expect(screen.queryByRole('button', { name: 'Clear clipboard now' })).toBeNull();

    await enterPin('123456');
    await fireEvent.click(copyButton());
    const clearButton = await screen.findByRole('button', { name: 'Clear clipboard now' });

    await fireEvent.click(clearButton);
    await waitFor(() => expect(mockedClear).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Clipboard cleared')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear clipboard now' })).toBeNull();
  });

  it('exports nsec and the seed phrase without an account id', async () => {
    mockedExport.mockResolvedValue({
      exportType: 'nostr',
      accountId: '',
      clearedAt: 1,
    });

    const { rerender } = render(EvmAccountKeyExportModal, {
      props: { open: true, variant: 'nostr', npub: 'npub1xyz' },
    });
    await enterPin('654321');
    await fireEvent.click(copyButton());
    await waitFor(() => expect(mockedExport).toHaveBeenCalledWith('nostr', undefined, '654321'));

    mockedExport.mockResolvedValueOnce({ exportType: 'seed', accountId: '', clearedAt: 2 });
    await rerender({ open: false, variant: 'seed' });
    await rerender({ open: true, variant: 'seed' });
    await enterPin('111111');
    await fireEvent.click(copyButton());
    await waitFor(() => expect(mockedExport).toHaveBeenCalledWith('seed', undefined, '111111'));
  });

  it('shows the backend error and does not reveal a secret', async () => {
    mockedExport.mockRejectedValueOnce(new Error('Invalid PIN'));

    render(EvmAccountKeyExportModal, {
      props: { open: true, variant: 'evm', account: evmAccount },
    });
    await enterPin('000000');
    await fireEvent.click(copyButton());

    expect(await screen.findByText('Invalid PIN')).toBeTruthy();
    expect(screen.queryByText('Copied to clipboard')).toBeNull();
    expect(screen.queryByText('0xsecretprivatekey')).toBeNull();
  });

  it('shows a backoff wait and blocks another copy until it expires', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    mockedExport.mockRejectedValueOnce(
      new Error('Too many export attempts. Please wait 12 seconds.')
    );

    render(EvmAccountKeyExportModal, {
      props: { open: true, variant: 'evm', account: evmAccount },
    });
    await enterPin('123456');
    await fireEvent.click(copyButton());

    expect(await screen.findByText(/Try again in 12s/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Wait 12s' }) as HTMLButtonElement).disabled).toBe(
      true
    );

    await vi.advanceTimersByTimeAsync(12_000);
    expect(
      (screen.getByRole('button', { name: 'Copy to clipboard' }) as HTMLButtonElement).disabled
    ).toBe(false);
    vi.useRealTimers();
  });

  it('returns to the warning when closed and reopened', async () => {
    mockedExport.mockResolvedValueOnce({
      exportType: 'evm',
      accountId: 'acc-1',
      clearedAt: 1,
    });
    const { rerender } = render(EvmAccountKeyExportModal, {
      props: { open: true, variant: 'evm', account: evmAccount },
    });
    await enterPin();
    await fireEvent.click(copyButton());
    expect(await screen.findByText('Copied to clipboard')).toBeTruthy();

    await rerender({ open: false, variant: 'evm', account: evmAccount });
    await rerender({ open: true, variant: 'evm', account: evmAccount });

    expect(screen.getByRole('heading', { name: 'Export private key' })).toBeTruthy();
    expect(screen.queryByText('Copied to clipboard')).toBeNull();
    expect(mockedExport).toHaveBeenCalledTimes(1);
  });

  it('explains an empty EVM export when no account is selected', () => {
    render(EvmAccountKeyExportModal, { props: { open: true, variant: 'evm', account: null } });
    expect(screen.getByText('No account selected.')).toBeTruthy();
    expect(screen.queryByLabelText('PIN digit 1')).toBeNull();
  });
});
