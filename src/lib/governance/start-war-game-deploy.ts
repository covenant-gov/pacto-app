import {
  deployWarGameForParent,
  quartermasterBootstrapCrew,
  type SquadSponsorDeploySignerWallet,
  type WarGameDeployResultDto,
} from './api';
import { announceWarGameUpdated } from './war-game-announce';
import { bootstrapCrewCandidates } from './start-pacto-gov-and-sponsor-deploy';
import { runOnChainInBackground } from '../evm/on-chain-background';
import { resolveSquadRosterEvmAddress } from '../squad/squad-roster-binding';
import { getInvokeErrorMessage } from '../utils/tauri-errors';
import { getAddress, isAddress } from 'viem';
import { showToast } from '../../stores/toast';
import type { SquadParamsInput } from './squad-params';
import { validateSquadParams } from './squad-params';
import type { SupportedChainId } from '../wallet/chains';
import { DEFAULT_SQUAD_PRACTICE_NETWORK, isSquadDeployableChain } from '../squad/squad-network';

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

/** Mint crew hats after deploy when the starter is this round's captain. Soft-fails. */
export async function maybeBootstrapWarGameCrew(params: {
  parentId: string;
  captain: string;
  quartermaster: string;
  memberOptions: { address: string; label?: string }[];
  network?: SupportedChainId;
}): Promise<'bootstrapped' | 'skipped' | 'failed'> {
  const qm = params.quartermaster.trim();
  if (!qm) return 'skipped';
  const candidates = bootstrapCrewCandidates(params.memberOptions, params.captain);
  if (candidates.length === 0) return 'skipped';
  const myRoster = normalizeCaptainAddress((await resolveSquadRosterEvmAddress(params.parentId)) ?? '');
  const captain = normalizeCaptainAddress(params.captain);
  if (!myRoster || !captain || myRoster.toLowerCase() !== captain.toLowerCase()) return 'skipped';
  try {
    await quartermasterBootstrapCrew({
      network: params.network ?? DEFAULT_SQUAD_PRACTICE_NETWORK,
      parentId: params.parentId,
      quartermaster: qm,
      candidates,
    });
    return 'bootstrapped';
  } catch (e) {
    showToast(getInvokeErrorMessage(e, 'Crew bootstrap failed.'));
    return 'failed';
  }
}

/** Submit Practice/Wargame-stack deploy. Returns false when validation fails. */
export function startWarGameDeploy(params: {
  parentId: string;
  announcementsGroupId?: string | null;
  network?: SupportedChainId;
  captain: string;
  initialDepositWei: string;
  signerWallet?: SquadSponsorDeploySignerWallet;
  squadParams?: SquadParamsInput | null;
  memberOptions?: { address: string; label?: string }[];
  bootstrapCrew?: boolean;
  onComplete: (out: WarGameDeployComplete) => void | Promise<void>;
  onReject?: (message: string) => void;
  onError?: (message: string) => void;
}): boolean {
  const parentId = params.parentId.trim();
  if (!parentId) return false;

  const captain = normalizeCaptainAddress(params.captain);
  if (!captain) {
    const message = 'A roster EVM is required as captain.';
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
  const memberOptions = params.memberOptions ?? [];
  const bootstrapCrew = params.bootstrapCrew !== false;
  const network = isSquadDeployableChain(params.network)
    ? params.network
    : DEFAULT_SQUAD_PRACTICE_NETWORK;

  runOnChainInBackground({
    startedToast: 'War-game deploy submitted. Confirmation continues in the background.',
    subject: 'War-game deploy',
    job: () =>
      deployWarGameForParent({
        parentId,
        network,
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
      if (bootstrapCrew) {
        await maybeBootstrapWarGameCrew({
          parentId,
          captain,
          quartermaster: result.quartermaster,
          memberOptions,
          network,
        });
      }
      await params.onComplete(result);
    },
    onError: params.onError,
  });
  return true;
}
