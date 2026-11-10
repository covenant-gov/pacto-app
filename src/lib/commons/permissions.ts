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

/**
 * Sync UI hint only. Hard gate is `publishSquadCommonsBroadcast` /
 * `resolveCanBroadcastSquad` (arrival-time / publish against SquadAdmin flags).
 */
export function canBroadcastSquad(_input: CanBroadcastSquadInput): boolean {
  return true;
}

export function broadcastSquadRoleDeniedReason(input: CanBroadcastSquadInput): string | null {
  return canBroadcastSquad(input) ? null : commonsBroadcastRoleDeniedReason();
}

/** Async SquadAdmin flag check for UI disable (FULL or FLAG_BROADCAST). */
export async function resolveCanBroadcastSquad(
  input: CanBroadcastSquadInput,
): Promise<boolean> {
  const id = input.squad?.id?.trim();
  if (!id) return false;
  const { requireMySquadPrivilege } = await import('../governance/squad-privilege-enforce');
  const d = await requireMySquadPrivilege(id, 'broadcast');
  return d.ok;
}
