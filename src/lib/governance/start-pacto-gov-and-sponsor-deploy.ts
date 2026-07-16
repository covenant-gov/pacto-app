import {
  deployNavePirataForParent,
  deploySquadSponsorHatsForParent,
  quartermasterBootstrapCrew,
  type SquadSponsorDeployResultDto,
  type SquadSponsorDeploySignerWallet,
} from './api';
import { runOnChainInBackground } from '../evm/on-chain-background';
import { resolveSquadRosterEvmAddress } from '../squad/squad-roster-binding';
import type { SupportedChainId } from '../wallet/chains';
import { getInvokeErrorMessage } from '../utils/tauri-errors';
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
  } | null;
  bootstrapped: boolean;
  /** Set when gov+sponsor succeeded but crew mint failed (soft-fail). */
  bootstrapError?: string;
  /** Gov mined but hats sponsor failed — open Finish sponsor from Launchpad. */
  finishSponsorNeeded?: boolean;
  sponsorError?: string;
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

/**
 * Bootstrap in the combined wizard when this identity is captain (roster EVM).
 * Deploy gas may come from Default; crew mint is signed by the roster key and may
 * use sponsor UserOp when that key has no ETH.
 */
export function canBootstrapCrewDuringDeploy(params: {
  /** Retained for call-site compatibility; deploy payer no longer gates bootstrap. */
  signerWallet: SquadSponsorDeploySignerWallet;
  /** True when Default and squad-assigned resolve to the same address. */
  signersAreSame?: boolean;
  captainAddress: string;
  squadRosterAddress: string | null | undefined;
}): boolean {
  void params.signerWallet;
  void params.signersAreSame;
  const roster = normalizeAddress(params.squadRosterAddress ?? '');
  const captain = normalizeAddress(params.captainAddress);
  if (!roster || !captain) return false;
  return roster.toLowerCase() === captain.toLowerCase();
}

/**
 * Soft-fails so gov+sponsor still finalize. Caller must only invoke when
 * {@link canBootstrapCrewDuringDeploy} is true (self as captain).
 */
async function runBootstrapCrewStep(params: {
  network: SupportedChainId;
  parentId: string;
  quartermaster: string;
  candidates: string[];
  /** Combined deploy: captain address must be this user's roster key. */
  captainMustBeRoster?: string;
  onProgress?: (step: 'bootstrap') => void;
}): Promise<{ bootstrapped: boolean; bootstrapError?: string }> {
  params.onProgress?.('bootstrap');
  try {
    const rosterRaw = await resolveSquadRosterEvmAddress(params.parentId);
    const roster = normalizeAddress(rosterRaw ?? '');
    if (!roster) {
      throw new Error('Missing squad-assigned EVM — cannot sign crew bootstrap.');
    }
    const required = params.captainMustBeRoster
      ? normalizeAddress(params.captainMustBeRoster)
      : null;
    if (required && roster.toLowerCase() !== required.toLowerCase()) {
      throw new Error(
        'Crew bootstrap is signed by your squad key as captain. Pick yourself as captain to bootstrap now, or mint later from Governance → Captain.',
      );
    }
    await quartermasterBootstrapCrew({
      network: params.network,
      parentId: params.parentId,
      quartermaster: params.quartermaster,
      candidates: params.candidates,
    });
    return { bootstrapped: true };
  } catch (e) {
    const bootstrapError = getInvokeErrorMessage(e, 'Crew bootstrap failed.');
    return { bootstrapped: false, bootstrapError };
  }
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
      let sponsorResult: SquadSponsorDeployResultDto | null = null;
      let finishSponsorNeeded = false;
      let sponsorError: string | undefined;
      try {
        sponsorResult = await deploySquadSponsorHatsForParent({
          network,
          parentId,
          topHatId: govResult.topHatId,
          initialDepositWei: depositWei,
          signerWallet,
        });
      } catch (e) {
        finishSponsorNeeded = true;
        sponsorError = getInvokeErrorMessage(e, 'Sponsor deploy failed after Pacto Gov succeeded.');
      }

      let bootstrapped = false;
      let bootstrapError: string | undefined;
      if (sponsorResult && params.bootstrapCrew && crewCandidates.length > 0) {
        const rosterRaw = await resolveSquadRosterEvmAddress(parentId);
        if (
          canBootstrapCrewDuringDeploy({
            signerWallet,
            captainAddress: captain,
            squadRosterAddress: rosterRaw,
          })
        ) {
          const boot = await runBootstrapCrewStep({
            network,
            parentId,
            quartermaster: govResult.quartermaster,
            candidates: crewCandidates,
            captainMustBeRoster: captain,
            onProgress: () => params.onProgress?.('bootstrap'),
          });
          bootstrapped = boot.bootstrapped;
          bootstrapError = boot.bootstrapError;
        }
      }

      return {
        govResult,
        sponsorResult,
        bootstrapped,
        bootstrapError,
        finishSponsorNeeded,
        sponsorError,
      };
    },
    onSuccess: async ({
      govResult,
      sponsorResult,
      bootstrapped,
      bootstrapError,
      finishSponsorNeeded,
      sponsorError,
    }) => {
      await params.onComplete({
        gov: {
          txHash: govResult.txHash,
          chain: govResult.chain,
          topHatId: govResult.topHatId,
          safeAddress: govResult.safeAddress,
          providerPayload: govResult.providerPayload,
          infraRowId: govResult.infraRowId,
        },
        sponsor: sponsorResult
          ? {
              txHash: sponsorResult.txHash,
              chain: sponsorResult.chain,
              sponsorAddress: sponsorResult.sponsorAddress,
              providerPayload: sponsorResult.providerPayload,
              infraRowId: sponsorResult.infraRowId,
            }
          : null,
        bootstrapped,
        bootstrapError,
        finishSponsorNeeded,
        sponsorError,
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

  const signerWallet = params.signerWallet ?? 'squad';

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
        signerWallet,
      });

      let bootstrapped = false;
      let bootstrapError: string | undefined;
      if (params.bootstrapCrew && crewCandidates.length > 0 && qm) {
        const rosterRaw = await resolveSquadRosterEvmAddress(parentId);
        const captainForGate = params.captainAddress?.trim() || rosterRaw || '';
        if (
          canBootstrapCrewDuringDeploy({
            signerWallet,
            captainAddress: captainForGate,
            squadRosterAddress: rosterRaw,
          })
        ) {
          const boot = await runBootstrapCrewStep({
            network,
            parentId,
            quartermaster: qm,
            candidates: crewCandidates,
            captainMustBeRoster: captainForGate || undefined,
            onProgress: () => params.onProgress?.('bootstrap'),
          });
          bootstrapped = boot.bootstrapped;
          bootstrapError = boot.bootstrapError;
        }
      }

      return { sponsorResult, bootstrapped, bootstrapError };
    },
    onSuccess: async ({ sponsorResult, bootstrapped, bootstrapError }) => {
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
        bootstrapError,
      });
    },
    onError: params.onError,
  });
  return true;
}
