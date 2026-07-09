import { activeTopNavTab, activeView } from '../../stores/navigation';
import {
  activeDmId,
  composingNewChat,
  newChatDraftNpub,
  newChatDraftMessage,
} from '../../stores/dm';
import { loadProfile } from '../../stores/profiles';
import { sendDmMessage } from '../api/nostr';
import { getInvokeErrorMessage } from '../utils/tauri-errors';
import type { CommonsBroadcastDto } from './types';
import {
  commonsJoinRequestBlockReason,
  formatCommonsJoinRequestMessage,
  recordJoinRequestSent,
  squadIdFromBroadcast,
  type CommonsJoinRequestPayload,
} from './commons-join-request';

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
  const payload: CommonsJoinRequestPayload = {
    type: 'commons_join_request',
    squadId,
    squadName: broadcast.squadName ?? 'Squad',
    squadKind: broadcast.squadKind,
    broadcastEventId: broadcast.eventId,
    requesterNpub,
  };

  try {
    const ok = await sendDmMessage(broadcast.authorNpub, formatCommonsJoinRequestMessage(payload));
    if (!ok) {
      return { ok: false, error: 'Could not send join request.' };
    }
    recordJoinRequestSent(squadId);
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: getInvokeErrorMessage(e, 'Could not send join request.') };
  }
}
