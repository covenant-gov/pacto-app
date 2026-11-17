import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { clearToast, runToastRetryAction, toastMessage } from '../../stores/toast';
import {
  isUsernameBundlerConfigError,
  showUsernameClaimErrorToast,
  usernameClaimErrorMessage,
} from './username-claim-errors';

const mocks = vi.hoisted(() => ({
  focusSquadSettingsBundlerEditor: vi.fn(),
  t: vi.fn((key: string) => key),
}));

vi.mock('svelte-i18n', () => ({
  t: {
    subscribe: (fn: (v: typeof mocks.t) => void) => {
      fn(mocks.t);
      return () => {};
    },
  },
}));

vi.mock('../../stores/navigation', () => ({
  focusSquadSettingsBundlerEditor: mocks.focusSquadSettingsBundlerEditor,
}));

describe('username claim errors', () => {
  beforeEach(() => {
    mocks.t.mockImplementation((key: string) => key);
    mocks.focusSquadSettingsBundlerEditor.mockReset();
  });

  afterEach(() => {
    clearToast();
  });

  it('maps BUNDLER_CONFIG wallet JSON to the bundlerConfig i18n key', () => {
    const err = JSON.stringify({ code: 'BUNDLER_CONFIG', message: 'missing key' });
    expect(usernameClaimErrorMessage(err)).toBe('profile.username.errors.bundlerConfig');
    expect(isUsernameBundlerConfigError(err)).toBe(true);
  });

  it('treats raw Pimlico text as a bundler config error when no wallet code is present', () => {
    expect(isUsernameBundlerConfigError(new Error('Add a Pimlico API key'))).toBe(true);
  });

  it('does not treat unrelated claim errors as bundler config', () => {
    const err = JSON.stringify({ code: 'USERNAME_TAKEN', message: 'taken' });
    expect(isUsernameBundlerConfigError(err)).toBe(false);
  });

  it('ignores Pimlico text when another wallet code is present', () => {
    const err = JSON.stringify({
      code: 'USERNAME_TAKEN',
      message: 'taken; also mentions Pimlico',
    });
    expect(isUsernameBundlerConfigError(err)).toBe(false);
  });

  it('shows an Open Sponsored gas toast action for bundler config failures', () => {
    showUsernameClaimErrorToast(JSON.stringify({ code: 'BUNDLER_CONFIG', message: 'missing' }));
    const toast = get(toastMessage);
    expect(toast?.error).toBe(true);
    expect(toast?.text).toBe('profile.username.errors.bundlerConfig');
    expect(toast?.retryLabel).toBe('profile.username.openSponsoredGas');

    runToastRetryAction();
    expect(mocks.focusSquadSettingsBundlerEditor).toHaveBeenCalledTimes(1);
    expect(get(toastMessage)).toBeNull();
  });

  it('dismiss clears the bundler toast without opening Sponsored gas', () => {
    showUsernameClaimErrorToast(JSON.stringify({ code: 'BUNDLER_CONFIG', message: 'missing' }));
    expect(get(toastMessage)?.retryLabel).toBe('profile.username.openSponsoredGas');
    clearToast();
    expect(get(toastMessage)).toBeNull();
    expect(mocks.focusSquadSettingsBundlerEditor).not.toHaveBeenCalled();
  });

  it('shows a plain error toast for non-bundler failures without a settings action', () => {
    showUsernameClaimErrorToast(JSON.stringify({ code: 'USERNAME_TAKEN', message: 'taken' }));
    const toast = get(toastMessage);
    expect(toast?.error).toBe(true);
    expect(toast?.text).toBe('profile.username.errors.taken');
    expect(toast?.retryLabel).toBeUndefined();
  });
});
