import { invoke } from '@tauri-apps/api/core';
import type {
  CommonsBroadcastDto,
  CommonsJoinRequestDto,
  CommonsPublishBroadcastInput,
  CommonsPublishJoinRequestInput,
  CommonsRespondJoinRequestInput,
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

export async function publishCommonsJoinRequest(
  input: CommonsPublishJoinRequestInput
): Promise<CommonsJoinRequestDto> {
  return invoke<CommonsJoinRequestDto>('commons_publish_join_request', { input });
}

export async function fetchCommonsJoinRequests(
  squadIds: string[],
  pendingOnly = true
): Promise<CommonsJoinRequestDto[]> {
  return invoke<CommonsJoinRequestDto[]>('commons_fetch_join_requests', {
    squadIds,
    pendingOnly,
  });
}

export async function respondCommonsJoinRequest(
  input: CommonsRespondJoinRequestInput
): Promise<CommonsJoinRequestDto> {
  return invoke<CommonsJoinRequestDto>('commons_respond_join_request', { input });
}
