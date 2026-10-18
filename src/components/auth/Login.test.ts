// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { get } from 'svelte/store';
import Login from './Login.svelte';
import { appConfig, DEFAULT_APP_CONFIG } from '../../stores/app-config';
import { authError, authLoading, currentUser, isAuthenticated } from '../../stores/auth-session';
import { backupVerificationModalOpen } from '../../stores/backup-verification';

const session = { npub: 'npub1test', pubkey: 'aa' };

const { checkAuthStatus, checkSession, createAccount, revealAuthenticatedSession } = vi.hoisted(
  () => ({
    checkAuthStatus: vi.fn(),
    checkSession: vi.fn(),
    createAccount: vi.fn(),
    revealAuthenticatedSession: vi.fn(),
  }),
);

vi.mock('../../stores/auth', () => ({
  checkAuthStatus,
  checkSession,
  createAccount,
  importAccount: vi.fn(),
  unlockWithPin: vi.fn(),
  clearAuthError: vi.fn(),
  revealAuthenticatedSession,
}));

vi.mock('svelte/motion', () => ({
  prefersReducedMotion: { current: true },
}));

async function typePin(pin: string): Promise<void> {
  for (let i = 0; i < pin.length; i++) {
    const input = screen.getByLabelText(`PIN digit ${i + 1}`);
    await fireEvent.keyDown(input, { key: pin[i] });
  }
}

beforeEach(() => {
  appConfig.set({ ...DEFAULT_APP_CONFIG, pinDigitCount: 4 });
  authError.set(null);
  authLoading.set(false);
  isAuthenticated.set(false);
  currentUser.set(null);
  backupVerificationModalOpen.set(false);
  checkAuthStatus.mockResolvedValue('needs-auth');
  checkSession.mockResolvedValue({ unlocked: false });
  createAccount.mockResolvedValue(session);
  revealAuthenticatedSession.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('Login PIN success orchestration', () => {
  it('keeps the first PIN and stays on retype when confirmation mismatches', async () => {
    render(Login);
    await fireEvent.click(await screen.findByRole('button', { name: 'Create Account' }));
    await screen.findByRole('heading', { name: 'Create your PIN' });

    await typePin('1234');
    await screen.findByRole('heading', { name: 'Retype your PIN' });
    await typePin('9999');

    expect((await screen.findByRole('alert')).textContent).toBe("Those PINs didn't match. Try again.");
    expect(screen.getByRole('heading', { name: 'Retype your PIN' })).toBeTruthy();
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('shows the success beat, then reveals the session and opens backup verification', async () => {
    render(Login);
    await fireEvent.click(await screen.findByRole('button', { name: 'Create Account' }));
    await screen.findByRole('heading', { name: 'Create your PIN' });
    await typePin('1234');
    await screen.findByRole('heading', { name: 'Retype your PIN' });
    await typePin('1234');

    expect(await screen.findByRole('heading', { name: "You're in" })).toBeTruthy();
    expect(createAccount).toHaveBeenCalledWith('1234', { deferReveal: true });

    await waitFor(() => {
      expect(revealAuthenticatedSession).toHaveBeenCalledWith(session);
      expect(get(backupVerificationModalOpen)).toBe(true);
    });
  });
});
