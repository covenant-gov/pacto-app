import type { PublicSquadBroadcastTarget } from './squad-create-broadcast';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';

export interface CanBroadcastSquadInput {
  userNpub?: string | null;
  squad: PublicSquadBroadcastTarget;
}

export function commonsBroadcastRoleDeniedReason(): string {
  return get(t)('commons.errors.roleRequired');
}

/** Stub until SquadAdmin on-chain roles gate Commons squad broadcasts. */
export function canBroadcastSquad(_input: CanBroadcastSquadInput): boolean {
  return true;
}

export function broadcastSquadRoleDeniedReason(input: CanBroadcastSquadInput): string | null {
  return canBroadcastSquad(input) ? null : commonsBroadcastRoleDeniedReason();
}
