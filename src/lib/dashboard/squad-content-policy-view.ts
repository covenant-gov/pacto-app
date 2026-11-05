import type { SquadContentPolicyFlag, SquadContentPolicyView } from '../api/squad-content-policy';

/** `lockedOut`: restriction on while no admin is still a member, so nobody can add. */
export type SquadContentPolicyFlagState = 'open' | 'adminOnly' | 'lockedOut';

export interface SquadContentPolicyRow {
  flag: SquadContentPolicyFlag;
  /** i18n stem under `governance.contentPolicy`. */
  copyKey: 'events' | 'docs';
  state: SquadContentPolicyFlagState;
  /** Admins get a switch unless locked out; everyone else reads the state. */
  control: 'switch' | 'readonly';
  checked: boolean;
}

/** One row per flag, in display order. */
export function squadContentPolicyRows(view: SquadContentPolicyView): SquadContentPolicyRow[] {
  const flags = [
    { flag: 'restrict_event_create', copyKey: 'events', on: view.restrictEventCreate },
    { flag: 'restrict_doc_add', copyKey: 'docs', on: view.restrictDocAdd },
  ] as const;
  return flags.map(({ flag, copyKey, on }) => {
    const state: SquadContentPolicyFlagState = !on ? 'open' : view.adminIsMember ? 'adminOnly' : 'lockedOut';
    const control = view.callerIsAdmin && state !== 'lockedOut' ? 'switch' : 'readonly';
    return { flag, copyKey, state, control, checked: on };
  });
}
