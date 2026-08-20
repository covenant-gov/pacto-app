import type { GovProcessCard } from './gov-process';
import { crewPendingStatus } from './gov-process';
import { isCrewOffboardExecutable, isCrewOffboardExpirable } from './crew-offboard';
import {
  executableTreasuryProposals,
  isMutinyExecutable,
  isMutinyExpirable,
} from './gov-proposal-lists';

export type GovExecuteUiState = {
  showExecute: boolean;
  executeEnabled: boolean;
  /** i18n key preferred; empty when enabled */
  disabledReasonKey: string;
  unlockAtSec: number | null;
  showExpire: boolean;
  expireEnabled: boolean;
  expireReasonKey: string;
};

const NO_EXPIRE = {
  showExpire: false,
  expireEnabled: false,
  expireReasonKey: '',
} as const;

/** Board/card Execute visibility vs enabled (delay before privilege). */
export function govExecuteUiState(params: {
  card: GovProcessCard;
  privilegeReasonKey?: string;
  nowSec?: number;
}): GovExecuteUiState {
  const now = params.nowSec ?? Math.floor(Date.now() / 1000);
  const privilegeKey = params.privilegeReasonKey?.trim() || '';
  const { card } = params;

  switch (card.kind) {
    case 'crew_add':
    case 'crew_remove': {
      const unlockAtSec = card.executableAt > 0 ? card.executableAt : null;
      const delayLocked = crewPendingStatus(card.executableAt, now) === 'pending';
      if (delayLocked) {
        return {
          showExecute: true,
          executeEnabled: false,
          disabledReasonKey: 'governance.proposal.executeLockedUntil',
          unlockAtSec,
          ...NO_EXPIRE,
        };
      }
      return {
        showExecute: true,
        executeEnabled: !privilegeKey,
        disabledReasonKey: privilegeKey,
        unlockAtSec,
        ...NO_EXPIRE,
      };
    }
    case 'treasury': {
      const show = executableTreasuryProposals([card.proposal]).length > 0;
      return {
        showExecute: show,
        executeEnabled: show && !privilegeKey,
        disabledReasonKey: show ? privilegeKey : '',
        unlockAtSec: null,
        ...NO_EXPIRE,
      };
    }
    case 'crew_offboard': {
      const expired = isCrewOffboardExpirable(card.status, now);
      const show = isCrewOffboardExecutable(card.status, card.quorumBps, now);
      return {
        showExecute: show,
        executeEnabled: show && !privilegeKey,
        disabledReasonKey: show ? privilegeKey : '',
        unlockAtSec: card.status.deadline > 0 ? card.status.deadline : null,
        showExpire: expired,
        expireEnabled: expired && !privilegeKey,
        expireReasonKey: expired ? privilegeKey : '',
      };
    }
    case 'mutiny': {
      const expired = isMutinyExpirable(card.status, now);
      const show = isMutinyExecutable(card.status, now);
      return {
        showExecute: show,
        executeEnabled: show && !privilegeKey,
        disabledReasonKey: show ? privilegeKey : '',
        unlockAtSec: card.status.deadline > 0 ? card.status.deadline : null,
        showExpire: expired,
        expireEnabled: expired && !privilegeKey,
        expireReasonKey: expired ? privilegeKey : '',
      };
    }
  }
}
