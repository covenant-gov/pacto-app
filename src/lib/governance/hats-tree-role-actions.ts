import type { MutinyStatusDto, QuartermasterStatusDto } from './api';
import type { GovernancePrivilege } from './governance-privilege';
import type { MemberEvmOption } from './war-game-captain';

export type HatsTreeRoleActionKind = 'treasury' | 'mutiny' | 'quartermaster';

export type HatsTreeCommandAction =
  | 'submitProposal'
  | 'voteMode'
  | 'startMutiny'
  | 'resign'
  | 'addCrew'
  | 'removeCrew'
  | 'proposeOffboard'
  | 'bootstrapCrew';

export type HatsTreeCommandContext = {
  privilege: GovernancePrivilege;
  capabilitiesPending: boolean;
  mutinyStatus: MutinyStatusDto | null;
  qmStatus: QuartermasterStatusDto | null;
  treasuryAuthority: string;
  mutinyModule: string;
  quartermaster: string;
  network: string;
  parentId: string;
  memberEvmOptions: MemberEvmOption[];
  crewMemberOptions: MemberEvmOption[];
  memberOptionsLoading: boolean;
  captainWearers: string[];
  crewWearers: string[];
  warGameStack: boolean;
  refreshProposals: () => void;
  refreshMutiny: () => void;
  refreshQm: () => void;
};

export type HatsTreeActionsApi = {
  command: HatsTreeCommandContext | null;
  open: (action: HatsTreeCommandAction) => void;
};

export const HATS_TREE_ACTIONS_KEY = Symbol('hats-tree-actions');

/** Nave role labels that host in-tree command CTAs. */
export function hatsTreeRoleActionKind(roleLabel: string): HatsTreeRoleActionKind | null {
  switch (roleLabel.trim()) {
    case 'Treasury Authority Role':
      return 'treasury';
    case 'Mutiny Role':
      return 'mutiny';
    case 'Quartermaster Role':
      return 'quartermaster';
    default:
      return null;
  }
}
