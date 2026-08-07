import { writable } from 'svelte/store';

/** Cross-component request to open the create-squad modal pre-filled, e.g. from an MLS reset notice. */
export interface SquadRecreatePrefill {
  name: string;
  memberNpubs: string[];
}

/** Set by a requester, consumed (and cleared) by the Navbar that owns the create-squad modal. */
export const squadRecreateRequest = writable<SquadRecreatePrefill | null>(null);

export function requestSquadRecreate(prefill: SquadRecreatePrefill): void {
  squadRecreateRequest.set(prefill);
}
