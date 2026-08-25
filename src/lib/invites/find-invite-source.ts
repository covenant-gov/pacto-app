import { parseChannelInSquadMessage, parseSquadInviteMessage } from '../api/nostr';
import { sameMlsGroupId } from './accept-invite';
import type { DmMessage } from '../../stores/dm';

/** Where a pending MLS welcome's invite DM lives, and the human-readable name for it. */
export interface WelcomeInviteSource {
  npub: string;
  squadName: string;
  channelName?: string;
}

/**
 * Catch up's `welcome` entries store only an MLS group id and a wrapper
 * event id (KD1/KTD8 — references only, never a squad name). Recovers a
 * squad/channel name and the inviter's DM thread for one by scanning
 * locally cached DM messages for the `squad_invite` / `channel_in_squad`
 * payload that named this group — parsed directly rather than through
 * `resolveDmMessagePresentation`, which hides channel-in-squad DMs in 1:1
 * threads. Returns null when the invite DM hasn't loaded locally yet.
 */
export function findWelcomeInviteSource(
  groupId: string,
  dmMessagesByNpub: Record<string, DmMessage[]>
): WelcomeInviteSource | null {
  for (const [npub, messages] of Object.entries(dmMessagesByNpub)) {
    for (const msg of messages) {
      const content = msg.content ?? '';
      const squadInvite = parseSquadInviteMessage(content);
      if (squadInvite && sameMlsGroupId(squadInvite.groupId, groupId)) {
        return { npub, squadName: squadInvite.squadName };
      }
      const channelInvite = parseChannelInSquadMessage(content);
      if (channelInvite && sameMlsGroupId(channelInvite.channelGroupId, groupId)) {
        return { npub, squadName: channelInvite.squadName, channelName: channelInvite.channelName };
      }
    }
  }
  return null;
}
