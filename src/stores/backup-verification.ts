import { writable, get, type Writable } from 'svelte/store';
import { getBackupVerifiedSetting, setBackupVerifiedSetting } from '../lib/api/settings';

export type BackupVerifiedState = boolean | null;

export const backupVerified: Writable<BackupVerifiedState> = writable(null);
export const backupVerificationModalOpen: Writable<boolean> = writable(false);

export async function loadBackupVerified(): Promise<void> {
  const value = await getBackupVerifiedSetting();
  backupVerified.set(value);
}

export async function markBackupVerified(value = true): Promise<void> {
  await setBackupVerifiedSetting(value);
  backupVerified.set(value);
}

export function isBackupVerified(): boolean {
  return get(backupVerified) === true;
}

export function requireBackupVerified(): boolean {
  if (isBackupVerified()) return true;
  backupVerificationModalOpen.set(true);
  return false;
}
