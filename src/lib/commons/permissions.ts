import type { PublicSquadBroadcastTarget } from './squad-create-broadcast';

export interface CanBroadcastSquadInput {
  userNpub?: string | null;
  squad: PublicSquadBroadcastTarget;
}

export const COMMONS_BROADCAST_ROLE_DENIED_REASON = 'Role required soon.';

/** Stub until SquadAdmin on-chain roles gate Commons squad broadcasts. */
export function canBroadcastSquad(_input: CanBroadcastSquadInput): boolean {
  return true;
}

export function broadcastSquadRoleDeniedReason(input: CanBroadcastSquadInput): string | null {
  return canBroadcastSquad(input) ? null : COMMONS_BROADCAST_ROLE_DENIED_REASON;
}
