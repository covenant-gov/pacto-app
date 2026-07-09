import { sendDmMessage } from '../api/nostr';
import { getInvokeErrorMessage } from '../utils/tauri-errors';
import type { CommonsBroadcastDto } from './types';
import {
  commonsJoinRequestBlockReason,
  recordJoinRequestSent,
  squadIdFromBroadcast,
} from './commons-join-request';
import { formatBotJoinDm } from '../squad/squad-join-mls';
import { activeTopNavTab, activeView } from '../../stores/navigation';
import {
  activeDmId,
  composingNewChat,
  newChatDraftNpub,
  newChatDraftMessage,
} from '../../stores/dm';
import { loadProfile } from '../../stores/profiles';

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

/** Send a structured join request DM to the squad bot (card author). */
export async function sendCommonsJoinRequest(
  broadcast: CommonsBroadcastDto,
  requesterNpub: string,
  localSquadIds: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const blockReason = commonsJoinRequestBlockReason(broadcast, requesterNpub, localSquadIds);
  if (blockReason) {
    return { ok: false, error: blockReason };
  }

  const botNpub = broadcast.authorNpub?.trim() ?? '';
  if (!botNpub.startsWith('npub1')) {
    return { ok: false, error: 'Squad broadcast is missing a bot author.' };
  }

  const squadId = squadIdFromBroadcast(broadcast);
  const content = formatBotJoinDm({
    squadId,
    squadName: broadcast.squadName ?? 'Squad',
    broadcastEventId: broadcast.eventId,
  });
  try {
    await sendDmMessage(botNpub, content);
    recordJoinRequestSent(squadId);
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: getInvokeErrorMessage(e, 'Could not send join request.') };
  }
}
