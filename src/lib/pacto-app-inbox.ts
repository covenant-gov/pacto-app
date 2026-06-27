/**
 * Pacto App synthetic DM thread (local inbox for squad / squad-pair invites).
 * See ai-docs/networks/RNF_PLAN.md RNF-4.
 */
import {
  formatSquadInviteMessage,
  parseSquadInviteMessage,
  sendDmMessage,
  type SquadInvitePayload,
} from './api/nostr';
import type { DmMessage } from '../stores/app';

export const PACTO_APP_DM_THREAD_ID = '__pacto_app__';
export const PACTO_APP_DISPLAY_NAME = 'Inbox';

export interface PactoAppInboxEntry extends DmMessage {
  /** Npub of the user who sent the invite (for display + DM deep link). */
  inviterNpub: string;
}

export function isPactoAppThreadId(id: string | null | undefined): boolean {
  return id === PACTO_APP_DM_THREAD_ID;
}

/** Squad / squad-pair invites routed to the Pacto App inbox. */
export function isPactoAppRoutableInviteContent(content: string): boolean {
  return parseSquadInviteMessage(content) !== null;
}

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

export function toPactoAppInboxEntry(message: DmMessage, inviterNpub: string): PactoAppInboxEntry {
  return { ...message, inviterNpub };
}

export function mergePactoAppInboxEntry(
  list: PactoAppInboxEntry[],
  entry: PactoAppInboxEntry
): PactoAppInboxEntry[] {
  if (list.some((m) => m.id === entry.id)) return list;
  return [...list, entry].sort((a, b) => a.at - b.at);
}

/** Drop squad invite rows from a peer DM thread (shown in Pacto App instead). */
export function filterPeerThreadMessages(messages: DmMessage[]): DmMessage[] {
  return messages.filter((m) => !isPactoAppRoutableInviteContent(m.content ?? ''));
}

/** Send squad / squad-pair invite over Nostr; recipient ingests into Pacto App inbox locally. */
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
