// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import BackupVerificationModal from './BackupVerificationModal.svelte';
import { exportRecoveryPhrase } from '../../lib/api/auth';

vi.mock('../../lib/api/auth', () => ({
  exportRecoveryPhrase: vi.fn(),
}));

const mockedExportRecoveryPhrase = vi.mocked(exportRecoveryPhrase);

const SEED_PHRASE =
  'abandon ability able about above absent absorb abstract absurd abuse access accident';

afterEach(() => {
  cleanup();
});

describe('BackupVerificationModal', () => {
  beforeEach(() => {
    mockedExportRecoveryPhrase.mockReset();
    mockedExportRecoveryPhrase.mockResolvedValue(SEED_PHRASE);
  });

  it('reveals the recovery phrase only while open, and only after the user opts in', async () => {
    const { container } = render(BackupVerificationModal, { open: true, onClose: vi.fn() });

    await waitFor(() => expect(mockedExportRecoveryPhrase).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.querySelectorAll('.seed-mask').length).toBe(12));

    // Masked until the user explicitly reveals it.
    expect(screen.queryByText('abandon')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Show seed phrase' }));

    expect(container.querySelectorAll('.seed-mask').length).toBe(0);
    expect(screen.getByText('abandon')).toBeTruthy();
    expect(screen.getByText('accident')).toBeTruthy();
  });

  it('never fetches the seed while closed, and clears it from the DOM on close', async () => {
    const { container, rerender } = render(BackupVerificationModal, {
      open: false,
      onClose: vi.fn(),
    });

    expect(mockedExportRecoveryPhrase).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    await rerender({ open: true, onClose: vi.fn() });
    await waitFor(() => expect(mockedExportRecoveryPhrase).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.querySelectorAll('.seed-mask').length).toBe(12));

    await rerender({ open: false, onClose: vi.fn() });
    expect(screen.queryByRole('dialog')).toBeNull();

    // Reopening re-fetches rather than reusing state left over from the prior reveal.
    await rerender({ open: true, onClose: vi.fn() });
    await waitFor(() => expect(mockedExportRecoveryPhrase).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('abandon')).toBeNull();
  });
});
