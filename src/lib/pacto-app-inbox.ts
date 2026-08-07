/**
 * Squad / squad-pair invite DM wire format, delivery, and attribution.
 */
import {
  formatSquadInviteMessage,
  parseSquadInviteMessage,
  sendDmMessage,
  type SquadInvitePayload,
} from './api/nostr';
import type { DmMessage } from '../stores/app';

export function resolveInviteInviterNpub(
  message: DmMessage,
  peerNpub: string,
  content: string
): string {
  const squad = parseSquadInviteMessage(content);
  if (squad?.invitedByNpub?.trim()) return squad.invitedByNpub.trim();
  if (message.npub?.trim()) return message.npub.trim();
  return peerNpub;
}

/** Send a squad / squad-pair invite over Nostr as a regular DM. */
export async function sendSquadInviteDm(
  inviteeNpub: string,
  payload: Omit<SquadInvitePayload, 'type'>,
  inviterNpub: string | undefined
): Promise<boolean> {
  const body = formatSquadInviteMessage({
    type: 'squad_invite',
    ...payload,
    invitedByNpub: inviterNpub ?? payload.invitedByNpub,
  });
  return sendDmMessage(inviteeNpub, body);
}
