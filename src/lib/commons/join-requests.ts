import {
  fetchCommonsJoinRequests,
  publishCommonsJoinRequest,
  respondCommonsJoinRequest,
} from '../api/commons';
import { getInvokeErrorMessage } from '../utils/tauri-errors';
import type { CommonsJoinRequestDto, CommonsRespondJoinRequestInput } from './types';

export async function submitCommonsJoinRequest(input: {
  squadId: string;
  squadName: string;
  broadcastEventId: string;
}): Promise<{ ok: true; request: CommonsJoinRequestDto } | { ok: false; error: string }> {
  try {
    const request = await publishCommonsJoinRequest(input);
    return { ok: true, request };
  } catch (e: unknown) {
    return { ok: false, error: getInvokeErrorMessage(e, 'Could not send join request.') };
  }
}

export async function loadPendingJoinRequestsForSquad(
  squadId: string
): Promise<CommonsJoinRequestDto[]> {
  const id = squadId.trim();
  if (!id) return [];
  try {
    return await fetchCommonsJoinRequests([id], true);
  } catch (e) {
    console.warn('[commons] loadPendingJoinRequestsForSquad failed', e);
    return [];
  }
}

export async function respondToCommonsJoinRequest(
  input: CommonsRespondJoinRequestInput
): Promise<{ ok: true; request: CommonsJoinRequestDto } | { ok: false; error: string }> {
  try {
    const request = await respondCommonsJoinRequest(input);
    return { ok: true, request };
  } catch (e: unknown) {
    return { ok: false, error: getInvokeErrorMessage(e, 'Could not update join request.') };
  }
}
