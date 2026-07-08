import { activeTopNavTab, activeView } from '../../stores/navigation';
import {
  activeDmId,
  addPendingDm,
  composingNewChat,
  newChatDraftNpub,
  newChatDraftMessage,
} from '../../stores/dm';
import { loadProfile } from '../../stores/profiles';
import { getInvokeErrorMessage } from '../utils/tauri-errors';
import type { CommonsBroadcastDto } from './types';
import {
  commonsJoinRequestBlockReason,
  recordJoinRequestSent,
  squadIdFromBroadcast,
} from './commons-join-request';
import { submitCommonsJoinRequest } from './join-requests';

/**
 * Open the DMs "New Chat" compose view with the recipient and a partial
 * greeting pre-filled so the sender can finish the message before sending.
 */
export function openCommonsUserDmRequest(authorNpub: string, displayName?: string): void {
  if (!authorNpub.startsWith('npub1')) return;
  const name = displayName?.trim();
  newChatDraftNpub.set(authorNpub);
  newChatDraftMessage.set(name ? `Hi ${name}, ` : 'Hi, ');
  activeDmId.set(null);
  composingNewChat.set(true);
  activeTopNavTab.set('dms');
  activeView.set('hub');
  void loadProfile(authorNpub);
}

export async function sendCommonsJoinRequest(
  broadcast: CommonsBroadcastDto,
  requesterNpub: string,
  localSquadIds: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const blockReason = commonsJoinRequestBlockReason(broadcast, requesterNpub, localSquadIds);
  if (blockReason) {
    return { ok: false, error: blockReason };
  }

  const squadId = squadIdFromBroadcast(broadcast);
  try {
    const result = await submitCommonsJoinRequest({
      squadId,
      squadName: broadcast.squadName ?? 'Squad',
      broadcastEventId: broadcast.eventId,
    });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    recordJoinRequestSent(squadId);
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: getInvokeErrorMessage(e, 'Could not send join request.') };
  }
}
