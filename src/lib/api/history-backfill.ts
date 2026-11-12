import { invoke } from '@tauri-apps/api/core';
import type { HistoryBucket, HistoryMessage } from '../messaging/history-backfill';

export async function exportChannelHistory(
  groupId: string,
  bucket: HistoryBucket
): Promise<HistoryMessage[]> {
  return invoke<HistoryMessage[]>('export_channel_history', { groupId, bucket });
}

export async function importChannelHistory(
  groupId: string,
  bucket: HistoryBucket,
  messages: HistoryMessage[]
): Promise<string[]> {
  return invoke<string[]>('import_channel_history', { groupId, bucket, messages });
}

export async function listImportedHistoryIds(groupId: string): Promise<string[]> {
  return invoke<string[]>('list_imported_history_ids', { groupId });
}

export async function sendHistoryGiftWrap(recipientNpub: string, content: string): Promise<void> {
  await invoke('send_history_gift_wrap', { recipientNpub, content });
}
