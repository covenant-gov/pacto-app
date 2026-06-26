import { invoke } from '@tauri-apps/api/core';
import type {
  CommonsBroadcastDto,
  CommonsPublishBroadcastInput,
} from '../commons/types';

export async function publishCommonsBroadcast(
  input: CommonsPublishBroadcastInput
): Promise<CommonsBroadcastDto> {
  return invoke<CommonsBroadcastDto>('commons_publish_broadcast', { input });
}

export async function fetchCommonsBroadcasts(limit?: number): Promise<CommonsBroadcastDto[]> {
  return invoke<CommonsBroadcastDto[]>('commons_fetch_broadcasts', { limit: limit ?? null });
}

/** Local SQLite cache only — no relay sync; works before Nostr unlock. */
export async function fetchCommonsBroadcastsCached(limit?: number): Promise<CommonsBroadcastDto[]> {
  return invoke<CommonsBroadcastDto[]>('commons_list_cached_broadcasts', { limit: limit ?? null });
}

export async function getLocalActiveCommonsBroadcast(
  subject: 'user' | 'squad',
  subjectId: string
): Promise<CommonsBroadcastDto | null> {
  return invoke<CommonsBroadcastDto | null>('commons_get_local_active', { subject, subjectId });
}

export async function cancelCommonsBroadcast(
  subject: 'user' | 'squad',
  subjectId: string
): Promise<void> {
  await invoke('commons_cancel_broadcast', { subject, subjectId });
}
