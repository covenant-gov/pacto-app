import { invoke } from '@tauri-apps/api/core';

const BACKUP_VERIFIED_KEY = 'backup_verified';

export async function getSqlSetting(key: string): Promise<string | null> {
  return await invoke<string | null>('get_sql_setting', { key });
}

export async function setSqlSetting(key: string, value: string): Promise<void> {
  await invoke('set_sql_setting', { key, value });
}

export async function getBackupVerifiedSetting(): Promise<boolean> {
  try {
    const value = await getSqlSetting(BACKUP_VERIFIED_KEY);
    return value === 'true';
  } catch {
    // If the setting cannot be read (e.g. no current account), treat as unverified.
    return false;
  }
}

export async function setBackupVerifiedSetting(value: boolean): Promise<void> {
  await setSqlSetting(BACKUP_VERIFIED_KEY, value ? 'true' : 'false');
}
