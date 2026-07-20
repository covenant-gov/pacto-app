import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  backupVerified,
  backupVerificationModalOpen,
  loadBackupVerified,
  markBackupVerified,
  requireBackupVerified,
} from './backup-verification';

vi.mock('../lib/api/settings', () => ({
  getBackupVerifiedSetting: vi.fn(),
  setBackupVerifiedSetting: vi.fn(),
}));

import {
  getBackupVerifiedSetting,
  setBackupVerifiedSetting,
} from '../lib/api/settings';

const mockedGet = vi.mocked(getBackupVerifiedSetting);
const mockedSet = vi.mocked(setBackupVerifiedSetting);

describe('backup-verification store', () => {
  beforeEach(() => {
    backupVerified.set(null);
    backupVerificationModalOpen.set(false);
    vi.clearAllMocks();
  });

  it('loadBackupVerified hydrates store from SQL setting', async () => {
    mockedGet.mockResolvedValueOnce(true);
    await loadBackupVerified();
    expect(get(backupVerified)).toBe(true);
  });

  it('loadBackupVerified defaults to false when setting is missing', async () => {
    mockedGet.mockResolvedValueOnce(false);
    await loadBackupVerified();
    expect(get(backupVerified)).toBe(false);
  });

  it('markBackupVerified persists and updates the store', async () => {
    await markBackupVerified(true);
    expect(mockedSet).toHaveBeenCalledWith(true);
    expect(get(backupVerified)).toBe(true);
  });

  it('requireBackupVerified returns true when verified', () => {
    backupVerified.set(true);
    expect(requireBackupVerified()).toBe(true);
    expect(get(backupVerificationModalOpen)).toBe(false);
  });

  it('requireBackupVerified opens modal and returns false when unverified', () => {
    backupVerified.set(false);
    expect(requireBackupVerified()).toBe(false);
    expect(get(backupVerificationModalOpen)).toBe(true);
  });
});
