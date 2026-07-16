// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import EvmAccountKeyExportModal from './EvmAccountKeyExportModal.svelte';
import { exportSensitiveToClipboard } from '../../lib/api/auth';

vi.mock('../../lib/api/auth', () => ({
  exportSensitiveToClipboard: vi.fn(),
}));

const mockedExport = vi.mocked(exportSensitiveToClipboard);

beforeEach(() => {
  mockedExport.mockReset();
  cleanup();
});

const evmAccount = {
  id: 'acc-1',
  scheme: 'bip44_v1',
  hdIndex: 0,
  address: '0xAbC',
  label: 'Main',
  purpose: 'advanced' as const,
  isActive: false,
  isDefaultShared: false,
  isActiveAdvanced: false,
};

async function enterPin(inputs: HTMLElement[], pin: string) {
  for (let i = 0; i < pin.length; i++) {
    await fireEvent.input(inputs[i], { target: { value: pin[i] } });
  }
}

describe('EvmAccountKeyExportModal', () => {
  it('renders the confirmation warning before the PIN step', () => {
    render(EvmAccountKeyExportModal, {
      props: { open: true, variant: 'evm', account: evmAccount },
    });
    expect(
      screen.getByText(/Clipboard managers, OS clipboard history, and cross-device clipboard sync/)
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Continue/i })).toBeTruthy();
    expect(screen.queryByText('0xdeadbeef')).toBeNull();
  });

  it('moves to the PIN step after clicking Continue', async () => {
    render(EvmAccountKeyExportModal, {
      props: { open: true, variant: 'evm', account: evmAccount },
    });
    await fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    expect(screen.getByRole('heading', { name: /Enter PIN/i })).toBeTruthy();
    expect(screen.getAllByLabelText(/PIN digit/i)).toHaveLength(6);
  });

  it('calls the backend export command and shows the clipboard-cleared message', async () => {
    mockedExport.mockResolvedValueOnce({
      exportType: 'evm',
      accountId: 'acc-1',
      clearedAt: 1234567890,
    });

    render(EvmAccountKeyExportModal, {
      props: { open: true, variant: 'evm', account: evmAccount },
    });
    await fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    const inputs = screen.getAllByLabelText(/PIN digit/i);
    await enterPin(inputs, '123456');

    await waitFor(() =>
      expect(mockedExport).toHaveBeenCalledWith('evm', 'acc-1', '123456')
    );
    expect(screen.getByText(/It will be cleared in 90 seconds/)).toBeTruthy();
    expect(screen.queryByText('0xdeadbeef')).toBeNull();
  });

  it('exports nsec without an account id', async () => {
    mockedExport.mockResolvedValueOnce({
      exportType: 'nostr',
      accountId: '',
      clearedAt: 1234567890,
    });

    render(EvmAccountKeyExportModal, {
      props: { open: true, variant: 'nostr', npub: 'npub1xyz' },
    });
    await fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    const inputs = screen.getAllByLabelText(/PIN digit/i);
    await enterPin(inputs, '654321');

    await waitFor(() =>
      expect(mockedExport).toHaveBeenCalledWith('nostr', undefined, '654321')
    );
  });

  it('shows a non-secret error message when the backend export fails', async () => {
    mockedExport.mockRejectedValueOnce(new Error('Invalid PIN'));

    render(EvmAccountKeyExportModal, {
      props: { open: true, variant: 'evm', account: evmAccount },
    });
    await fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    const inputs = screen.getAllByLabelText(/PIN digit/i);
    await enterPin(inputs, '000000');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Export failed/i })).toBeTruthy()
    );
    expect(screen.getByText(/Invalid PIN/)).toBeTruthy();
    expect(screen.queryByText('0xdeadbeef')).toBeNull();
  });

  it('resets to the confirmation step when closed and reopened', async () => {
    const { rerender } = render(EvmAccountKeyExportModal, {
      props: { open: true, variant: 'evm', account: evmAccount },
    });
    await fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    expect(screen.getByRole('heading', { name: /Enter PIN/i })).toBeTruthy();

    await rerender({ open: false });
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Enter PIN/i })).toBeNull()
    );

    await rerender({ open: true });
    await waitFor(() =>
      expect(
        screen.getByText(/Clipboard managers, OS clipboard history, and cross-device clipboard sync/)
      ).toBeTruthy()
    );
  });
});
