import { deployWarGameForParent, type SquadSponsorDeploySignerWallet, type WarGameDeployResultDto } from './api';
import { announceWarGameUpdated } from './war-game-announce';
import { runOnChainInBackground } from '../evm/on-chain-background';
import { getAddress, isAddress } from 'viem';
import { showToast } from '../../stores/toast';
import type { SquadParamsInput } from './squad-params';
import { validateSquadParams } from './squad-params';

export type WarGameDeployComplete = WarGameDeployResultDto;

function normalizeCaptainAddress(raw: string): string | null {
  const t = raw.trim();
  if (!t || !isAddress(t as `0x${string}`)) return null;
  try {
    return getAddress(t as `0x${string}`);
  } catch {
    return null;
  }
}

/** Submit Sepolia war-game deploy. Returns false when validation fails. */
export function startWarGameDeploy(params: {
  parentId: string;
  announcementsGroupId?: string | null;
  captain: string;
  initialDepositWei: string;
  signerWallet?: SquadSponsorDeploySignerWallet;
  squadParams?: SquadParamsInput | null;
  onComplete: (out: WarGameDeployComplete) => void | Promise<void>;
  onReject?: (message: string) => void;
  onError?: (message: string) => void;
}): boolean {
  const parentId = params.parentId.trim();
  if (!parentId) return false;

  const captain = normalizeCaptainAddress(params.captain);
  if (!captain) {
    const message = 'Your squad-assigned EVM is required as captain.';
    if (params.onReject) params.onReject(message);
    else showToast(message);
    return false;
  }

  const depositWei = params.initialDepositWei.trim();
  if (!depositWei || depositWei === '0') {
    const message = 'Enter an initial deposit greater than zero.';
    if (params.onReject) params.onReject(message);
    else showToast(message);
    return false;
  }

  if (params.squadParams) {
    const paramsErr = validateSquadParams(params.squadParams);
    if (paramsErr) {
      if (params.onReject) params.onReject(paramsErr);
      else showToast(paramsErr);
      return false;
    }
  }

  const announcements = params.announcementsGroupId?.trim() || '';
  const altParentId = announcements && announcements !== parentId ? announcements : null;

  runOnChainInBackground({
    startedToast: 'War-game deploy submitted. Confirmation continues in the background.',
    subject: 'War-game deploy',
    job: () =>
      deployWarGameForParent({
        parentId,
        captain,
        metadataUri: `pacto://squad/${parentId}/wargame`,
        altParentId,
        squadParams: params.squadParams ?? null,
        initialDepositWei: depositWei,
        signerWallet: params.signerWallet ?? 'default',
      }),
    onSuccess: async (result) => {
      await announceWarGameUpdated({
        parentId,
        announcementsGroupId: announcements || null,
        result,
      });
      await params.onComplete(result);
    },
    onError: params.onError,
  });
  return true;
}
