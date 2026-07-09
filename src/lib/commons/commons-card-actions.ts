import { activeTopNavTab, activeView } from '../../stores/navigation';
import {
  activeDmId,
  composingNewChat,
  newChatDraftNpub,
  newChatDraftMessage,
} from '../../stores/dm';
import { loadProfile } from '../../stores/profiles';
import type { CommonsBroadcastDto } from './types';
import {
  commonsJoinRequestBlockReason,
  recordJoinRequestSent,
  squadIdFromBroadcast,
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

/** Open a DM to the squad bot (card author) with a join-request draft. */
export function openCommonsSquadJoinDm(broadcast: CommonsBroadcastDto): void {
  const botNpub = broadcast.authorNpub?.trim() ?? '';
  if (!botNpub.startsWith('npub1')) return;
  const squadName = broadcast.squadName?.trim() || 'your squad';
  const squadId = squadIdFromBroadcast(broadcast);
  newChatDraftNpub.set(botNpub);
  newChatDraftMessage.set(
    `I'd like to join ${squadName}${squadId ? ` (${squadId.slice(0, 12)}…)` : ''}. Broadcast: ${broadcast.eventId}`
  );
  activeDmId.set(null);
  composingNewChat.set(true);
  activeTopNavTab.set('dms');
  activeView.set('hub');
  void loadProfile(botNpub);
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

  if (!broadcast.authorNpub?.startsWith('npub1')) {
    return { ok: false, error: 'Squad broadcast is missing a bot author.' };
  }

  const squadId = squadIdFromBroadcast(broadcast);
  openCommonsSquadJoinDm(broadcast);
  recordJoinRequestSent(squadId);
  return { ok: true };
}
