import type { GovProcessCard } from './gov-process';
import { crewPendingStatus } from './gov-process';
import { executableTreasuryProposals, isMutinyExecutable } from './gov-proposal-lists';

export type GovExecuteUiState = {
  showExecute: boolean;
  executeEnabled: boolean;
  /** i18n key preferred; empty when enabled */
  disabledReasonKey: string;
  unlockAtSec: number | null;
};

/** Board/card Execute visibility vs enabled (delay before privilege). */
export function govExecuteUiState(params: {
  card: GovProcessCard;
  privilegeReasonKey?: string;
  nowSec?: number;
}): GovExecuteUiState {
  const now = params.nowSec ?? Math.floor(Date.now() / 1000);
  const privilegeKey = params.privilegeReasonKey?.trim() || '';
  const { card } = params;

  if (card.kind === 'crew_add' || card.kind === 'crew_remove') {
    const unlockAtSec = card.executableAt > 0 ? card.executableAt : null;
    const delayLocked = crewPendingStatus(card.executableAt, now) === 'pending';
    if (delayLocked) {
      return {
        showExecute: true,
        executeEnabled: false,
        disabledReasonKey: 'governance.proposal.executeLockedUntil',
        unlockAtSec,
      };
    }
    return {
      showExecute: true,
      executeEnabled: !privilegeKey,
      disabledReasonKey: privilegeKey,
      unlockAtSec,
    };
  }

  if (card.kind === 'treasury') {
    const show = executableTreasuryProposals([card.proposal]).length > 0;
    return {
      showExecute: show,
      executeEnabled: show && !privilegeKey,
      disabledReasonKey: show ? privilegeKey : '',
      unlockAtSec: null,
    };
  }

  const show = card.kind === 'mutiny' && isMutinyExecutable(card.status);
  return {
    showExecute: show,
    executeEnabled: show && !privilegeKey,
    disabledReasonKey: show ? privilegeKey : '',
    unlockAtSec: null,
  };
}
