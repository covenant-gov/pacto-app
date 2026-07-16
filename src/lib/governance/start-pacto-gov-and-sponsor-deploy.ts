import {
  deployNavePirataForParent,
  deploySquadSponsorHatsForParent,
  quartermasterBootstrapCrew,
  type SquadSponsorDeployResultDto,
  type SquadSponsorDeploySignerWallet,
} from './api';
import { runOnChainInBackground } from '../evm/on-chain-background';
import type { SupportedChainId } from '../wallet/chains';
import { getAddress, isAddress } from 'viem';
import { showToast } from '../../stores/toast';
import type { PactoGovDeployComplete } from './start-pacto-gov-deploy';

export type CombinedGovSponsorDeployComplete = {
  gov: PactoGovDeployComplete | null;
  sponsor: {
    txHash: string;
    chain: string;
    sponsorAddress: string;
    providerPayload: string;
    infraRowId: string;
  };
  bootstrapped: boolean;
};

function normalizeAddress(raw: string): string | null {
  const t = raw.trim();
  if (!t || !isAddress(t as `0x${string}`)) return null;
  try {
    return getAddress(t as `0x${string}`);
  } catch {
    return null;
  }
}

/** Shared roster EVMs eligible for bootstrapCrew (captain excluded). */
export function bootstrapCrewCandidates(
  memberOptions: { address: string; label?: string }[],
  captainAddress: string,
): string[] {
  const captain = normalizeAddress(captainAddress)?.toLowerCase() ?? '';
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of memberOptions) {
    const addr = normalizeAddress(m.address);
    if (!addr) continue;
    const key = addr.toLowerCase();
    if (captain && key === captain) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(addr);
  }
  return out;
}

/** True when address is one of the squad-assigned roster EVMs (hat recipients). */
export function isRosterHatRecipientAddress(
  address: string,
  memberOptions: { address: string }[],
): boolean {
  const target = normalizeAddress(address)?.toLowerCase();
  if (!target) return false;
  for (const m of memberOptions) {
    const addr = normalizeAddress(m.address)?.toLowerCase();
    if (addr && addr === target) return true;
  }
  return false;
}

/** Sequential Nave Pirata → hats sponsor → optional bootstrapCrew. */
export function startPactoGovAndSponsorDeploy(params: {
  parentId: string;
  squadNetwork: SupportedChainId | null;
  captain: string;
  initialDepositWei: string;
  bootstrapCrew: boolean;
  memberOptions: { address: string; label?: string }[];
  signerWallet?: SquadSponsorDeploySignerWallet;
  onProgress?: (step: 'gov' | 'sponsor' | 'bootstrap') => void;
  onComplete: (out: CombinedGovSponsorDeployComplete) => void | Promise<void>;
  onReject?: (message: string) => void;
  onError?: (message: string) => void;
}): boolean {
  const parentId = params.parentId.trim();
  if (!parentId) return false;

  const network = params.squadNetwork;
  if (!network) {
    const message = 'Set the squad network in Settings before deploying.';
    if (params.onReject) params.onReject(message);
    else showToast(message);
    return false;
  }

  const captain = normalizeAddress(params.captain);
  if (!captain) {
    const message = 'Pick a valid captain EVM address.';
    if (params.onReject) params.onReject(message);
    else showToast(message);
    return false;
  }

  if (!isRosterHatRecipientAddress(captain, params.memberOptions)) {
    const message = 'Captain must be a squad-assigned EVM of an existing member.';
    if (params.onReject) params.onReject(message);
    else showToast(message);
    return false;
  }

  const depositWei = params.initialDepositWei.trim();
  if (!depositWei || !/^\d+$/.test(depositWei) || depositWei === '0') {
    const message = 'Enter a positive initial sponsor deposit.';
    if (params.onReject) params.onReject(message);
    else showToast(message);
    return false;
  }

  const signerWallet = params.signerWallet ?? 'squad';
  const crewCandidates = params.bootstrapCrew
    ? bootstrapCrewCandidates(params.memberOptions, captain)
    : [];
  if (params.bootstrapCrew && crewCandidates.length === 0) {
    const message =
      'Bootstrap needs at least one shared EVM that is not the captain. Uncheck bootstrap or wait for more members.';
    if (params.onReject) params.onReject(message);
    else showToast(message);
    return false;
  }

  runOnChainInBackground({
    startedToast: 'Pacto Gov + sponsor deploy started. Steps continue in the background.',
    subject: 'Pacto Gov + sponsor',
    job: async () => {
      params.onProgress?.('gov');
      const govResult = await deployNavePirataForParent({
        network,
        parentId,
        captain,
        metadataUri: `pacto://squad/${parentId}`,
        signerWallet,
      });

      params.onProgress?.('sponsor');
      const sponsorResult: SquadSponsorDeployResultDto = await deploySquadSponsorHatsForParent({
        network,
        parentId,
        topHatId: govResult.topHatId,
        initialDepositWei: depositWei,
        signerWallet,
      });

      let bootstrapped = false;
      if (params.bootstrapCrew && crewCandidates.length > 0) {
        params.onProgress?.('bootstrap');
        await quartermasterBootstrapCrew({
          network,
          parentId,
          quartermaster: govResult.quartermaster,
          candidates: crewCandidates,
        });
        bootstrapped = true;
      }

      return { govResult, sponsorResult, bootstrapped };
    },
    onSuccess: async ({ govResult, sponsorResult, bootstrapped }) => {
      await params.onComplete({
        gov: {
          txHash: govResult.txHash,
          chain: govResult.chain,
          topHatId: govResult.topHatId,
          safeAddress: govResult.safeAddress,
          providerPayload: govResult.providerPayload,
          infraRowId: govResult.infraRowId,
        },
        sponsor: {
          txHash: sponsorResult.txHash,
          chain: sponsorResult.chain,
          sponsorAddress: sponsorResult.sponsorAddress,
          providerPayload: sponsorResult.providerPayload,
          infraRowId: sponsorResult.infraRowId,
        },
        bootstrapped,
      });
    },
    onError: params.onError,
  });
  return true;
}

/** Hats sponsor only (gov already deployed). Optional bootstrap when quartermaster is known. */
export function startHatsSponsorOnlyDeploy(params: {
  parentId: string;
  squadNetwork: SupportedChainId | null;
  topHatId: string;
  initialDepositWei: string;
  bootstrapCrew: boolean;
  memberOptions: { address: string; label?: string }[];
  /** Required when bootstrapCrew is true. */
  quartermaster?: string;
  /** Used to exclude captain from bootstrap list; optional. */
  captainAddress?: string;
  signerWallet?: SquadSponsorDeploySignerWallet;
  onProgress?: (step: 'sponsor' | 'bootstrap') => void;
  onComplete: (out: CombinedGovSponsorDeployComplete) => void | Promise<void>;
  onReject?: (message: string) => void;
  onError?: (message: string) => void;
}): boolean {
  const parentId = params.parentId.trim();
  if (!parentId) return false;

  const network = params.squadNetwork;
  if (!network) {
    const message = 'Set the squad network in Settings before deploying.';
    if (params.onReject) params.onReject(message);
    else showToast(message);
    return false;
  }

  const topHatId = params.topHatId.trim();
  if (!topHatId) {
    const message = 'Missing Pacto Gov top hat id for hats sponsor.';
    if (params.onReject) params.onReject(message);
    else showToast(message);
    return false;
  }

  const depositWei = params.initialDepositWei.trim();
  if (!depositWei || !/^\d+$/.test(depositWei) || depositWei === '0') {
    const message = 'Enter a positive initial sponsor deposit.';
    if (params.onReject) params.onReject(message);
    else showToast(message);
    return false;
  }

  const crewCandidates = params.bootstrapCrew
    ? bootstrapCrewCandidates(params.memberOptions, params.captainAddress ?? '')
    : [];
  if (params.bootstrapCrew && crewCandidates.length === 0) {
    const message =
      'Bootstrap needs at least one shared EVM. Uncheck bootstrap or wait for more members.';
    if (params.onReject) params.onReject(message);
    else showToast(message);
    return false;
  }

  const qm = params.quartermaster?.trim() ?? '';
  if (params.bootstrapCrew && !qm) {
    const message = 'Quartermaster address required to bootstrap crew.';
    if (params.onReject) params.onReject(message);
    else showToast(message);
    return false;
  }

  runOnChainInBackground({
    startedToast: 'Hats sponsor deploy started. Confirmation continues in the background.',
    subject: 'Hats sponsor',
    job: async () => {
      params.onProgress?.('sponsor');
      const sponsorResult = await deploySquadSponsorHatsForParent({
        network,
        parentId,
        topHatId,
        initialDepositWei: depositWei,
        signerWallet: params.signerWallet ?? 'squad',
      });

      let bootstrapped = false;
      if (params.bootstrapCrew && crewCandidates.length > 0 && qm) {
        params.onProgress?.('bootstrap');
        await quartermasterBootstrapCrew({
          network,
          parentId,
          quartermaster: qm,
          candidates: crewCandidates,
        });
        bootstrapped = true;
      }

      return { sponsorResult, bootstrapped };
    },
    onSuccess: async ({ sponsorResult, bootstrapped }) => {
      await params.onComplete({
        gov: null,
        sponsor: {
          txHash: sponsorResult.txHash,
          chain: sponsorResult.chain,
          sponsorAddress: sponsorResult.sponsorAddress,
          providerPayload: sponsorResult.providerPayload,
          infraRowId: sponsorResult.infraRowId,
        },
        bootstrapped,
      });
    },
    onError: params.onError,
  });
  return true;
}
