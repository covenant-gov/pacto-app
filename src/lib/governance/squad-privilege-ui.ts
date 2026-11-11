import type { SquadPrivilegeDecision } from './squad-privilege-enforce';

/**
 * Control visibility for a privilege decision: `true` allowed, `false` denied,
 * `null` read failed (control stays offered; the backend still enforces).
 */
export function privilegeUiAllowed(decision: SquadPrivilegeDecision): boolean | null {
  if (decision.ok) return true;
  return decision.reason === 'rpc' ? null : false;
}
