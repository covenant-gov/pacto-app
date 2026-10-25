import { invoke } from '@tauri-apps/api/core';
import { withPactoGovProviderPayloadTxHash } from './pacto-gov-payload';
import { squadRpcUrlsForInvoke } from '../squad/squad-rpc-invoke';

/** Warn when pool balance falls below this wei threshold (0.005 ETH). */
export const SPONSOR_LOW_BALANCE_WEI = 5_000_000_000_000_000n;

/** Mirrors `SquadSponsorDepositResult` from Tauri (`serde(rename_all = "camelCase")`). */
export interface SquadSponsorDepositResultDto {
  txHash: string;
  chain: string;
  chainId: number;
  sponsorAddress: string;
  amountWei: string;
  poolBalanceWei: string;
}

/** Backend: `deposit_squad_sponsor`. */
export async function depositSquadSponsor(params: {
  network: string;
  parentId: string;
  amountWei: string;
  sponsorAddress?: string | null;
  /** Default signer (Settings wallet); use squad for roster-bound key only. */
  signerWallet?: SquadSponsorDeploySignerWallet;
}): Promise<SquadSponsorDepositResultDto> {
  return (await invoke('deposit_squad_sponsor', {
    network: params.network,
    parentId: params.parentId,
    amountWei: params.amountWei.trim(),
    sponsorAddress: params.sponsorAddress?.trim() ? params.sponsorAddress.trim() : null,
    signerWallet: params.signerWallet ?? 'default',
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as SquadSponsorDepositResultDto;
}

export interface SquadSponsorWithdrawResultDto {
  txHash: string;
  chain: string;
  chainId: number;
  sponsorAddress: string;
  signerAddress: string;
  poolBalanceWei: string;
}

/** Backend: `withdraw_squad_sponsor` — burns shares for the chosen local account. */
export async function withdrawSquadSponsor(params: {
  network: string;
  parentId: string;
  accountId: string;
  sponsorAddress?: string | null;
}): Promise<SquadSponsorWithdrawResultDto> {
  return (await invoke('withdraw_squad_sponsor', {
    network: params.network,
    parentId: params.parentId,
    accountId: params.accountId.trim(),
    sponsorAddress: params.sponsorAddress?.trim() ? params.sponsorAddress.trim() : null,
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as SquadSponsorWithdrawResultDto;
}

/** Backend: `get_squad_sponsor_withdrawable` — pro-rata wei for an address. */
export async function getSquadSponsorWithdrawable(params: {
  network: string;
  parentId: string;
  accountAddress: string;
  sponsorAddress?: string | null;
}): Promise<string> {
  return (await invoke('get_squad_sponsor_withdrawable', {
    network: params.network,
    parentId: params.parentId,
    accountAddress: params.accountAddress.trim(),
    sponsorAddress: params.sponsorAddress?.trim() ? params.sponsorAddress.trim() : null,
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as string;
}

export type SquadSponsorVariant = 'ext' | 'hats';

/** Normalizes a top-level or persisted payload variant into `'ext' | 'hats'`. */
export function getSquadSponsorVariant(
  source: { variant?: string | null; providerPayload?: string | null } | null | undefined,
): SquadSponsorVariant | null {
  const top = source?.variant?.trim().toLowerCase();
  if (top === 'ext' || top === 'hats') return top;
  const raw = source?.providerPayload?.trim();
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'variant' in parsed) {
      const payloadVariant = parsed.variant;
      if (typeof payloadVariant === 'string') {
        const norm = payloadVariant.trim().toLowerCase();
        if (norm === 'ext' || norm === 'hats') return norm;
      }
    }
  } catch {
    // ignore malformed payload
  }
  return null;
}

/** Mirrors `SquadSponsorDeployResult` from Tauri (`serde(rename_all = "camelCase")`). */
export interface SquadSponsorDeployResultDto {
  txHash: string;
  chain: string;
  chainId: number;
  squadId: string;
  sponsorAddress: string;
  paymasterAddress: string;
  /** 'ext' or 'hats'; absent on results from older backends. */
  variant?: SquadSponsorVariant;
  providerPayload: string;
  infraRowId: string;
}

export type LaunchpadDeployOptionId =
  | 'full-gov'
  | 'pacto-gov'
  | 'sponsor-ext'
  | 'sponsor-hats'
  | 'sponsor-wire'
  | 'squad-admin-ext';

/** Mirrors `LaunchpadComponentStatus` from Tauri (`serde(rename_all = "camelCase")`). */
export interface LaunchpadComponentStatusDto {
  deployed: boolean;
  deployedAddress?: string | null;
  variant?: string | null;
  addressOwner?: string | null;
  owner?: string | null;
  hatsWired?: boolean | null;
}

/** Mirrors `LaunchpadDeployOption` from Tauri (`serde(rename_all = "camelCase")`). */
export interface LaunchpadDeployOptionDto {
  id: LaunchpadDeployOptionId;
  deployed: boolean;
  enabled: boolean;
  disabledReasonKey?: string | null;
  disabledReasonValues?: Record<string, string> | null;
  deployedAddress?: string | null;
}

/** Mirrors `SquadDeployLaunchpadState` from Tauri (`serde(rename_all = "camelCase")`). */
export interface SquadDeployLaunchpadStateDto {
  myRosterEvm: string | null;
  pactoGov: LaunchpadComponentStatusDto;
  sponsor: LaunchpadComponentStatusDto;
  admin: LaunchpadComponentStatusDto;
  options: LaunchpadDeployOptionDto[];
}

/** Backend: `get_squad_deploy_launchpad_state`. */
export async function getSquadDeployLaunchpadState(params: {
  parentId: string;
  network: string;
}): Promise<SquadDeployLaunchpadStateDto> {
  return (await invoke('get_squad_deploy_launchpad_state', {
    parentId: params.parentId.trim(),
    network: params.network,
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as SquadDeployLaunchpadStateDto;
}

/** Backend: `deploy_squad_sponsor_for_parent`. */
export type SquadSponsorDeploySignerWallet = 'default' | 'squad';

export async function deploySquadSponsorForParent(params: {
  network: string;
  parentId: string;
  initialDepositWei?: string | null;
  /** Prefer Default for Ext ala carte; roster remains addressOwner on-chain. */
  signerWallet?: SquadSponsorDeploySignerWallet;
}): Promise<SquadSponsorDeployResultDto> {
  return (await invoke('deploy_squad_sponsor_for_parent', {
    network: params.network,
    parentId: params.parentId,
    initialDepositWei: params.initialDepositWei?.trim() ? params.initialDepositWei.trim() : null,
    signerWallet: params.signerWallet ?? 'default',
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as SquadSponsorDeployResultDto;
}

/** Backend: `deploy_squad_sponsor_hats_for_parent` (hat-first SquadSponsor). */
export async function deploySquadSponsorHatsForParent(params: {
  network: string;
  parentId: string;
  topHatId: string;
  initialDepositWei?: string | null;
  signerWallet?: SquadSponsorDeploySignerWallet;
}): Promise<SquadSponsorDeployResultDto> {
  return (await invoke('deploy_squad_sponsor_hats_for_parent', {
    network: params.network,
    parentId: params.parentId,
    topHatId: params.topHatId.trim(),
    initialDepositWei: params.initialDepositWei?.trim() ? params.initialDepositWei.trim() : null,
    signerWallet: params.signerWallet ?? 'squad',
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as SquadSponsorDeployResultDto;
}


/**
 * Combined deploy action: Nave Pirata gov + hats squad sponsor + optional crew bootstrap
 * (sponsor-only variant finishes the hats sponsor when gov already exists). Single
 * agent-callable entry point with the wizard's validation and soft-failure handling.
 */
export {
  startHatsSponsorOnlyDeploy,
  startPactoGovAndSponsorDeploy,
} from './start-pacto-gov-and-sponsor-deploy';
export type { CombinedGovSponsorDeployComplete } from './start-pacto-gov-and-sponsor-deploy';

/** Mirrors `SquadSponsorSummary` from Tauri (`serde(rename_all = "camelCase")`). */
export interface SquadSponsorSummaryDto {
  chain: string;
  chainId: number;
  parentId: string;
  squadId: string;
  sponsorAddress: string;
  paymasterAddress: string;
  variant: string;
  topHatId: string;
  poolBalanceWei: string;
  totalShares: string;
}

/** Backend: `get_squad_sponsor_summary`. */
export async function getSquadSponsorSummary(params: {
  network: string;
  parentId: string;
  sponsorAddress?: string | null;
}): Promise<SquadSponsorSummaryDto> {
  return (await invoke('get_squad_sponsor_summary', {
    network: params.network,
    parentId: params.parentId,
    sponsorAddress: params.sponsorAddress?.trim() ? params.sponsorAddress.trim() : null,
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as SquadSponsorSummaryDto;
}

/** Mirrors `SquadSponsoredFeeUsageRow` from Tauri (`serde(rename_all = "camelCase")`). */
export interface SquadSponsoredFeeUsageDto {
  id: string;
  parentId: string;
  chain: string;
  chainId: number;
  actorNpub: string;
  actorEvm: string;
  amountWei: string;
  selector: string;
  action: string;
  target: string;
  userOpHash: string;
  txHash: string;
  createdAtMs: number;
}

/** Backend: `list_squad_sponsored_fee_usage` (newest first; default cap 50). */
export async function listSquadSponsoredFeeUsage(params: {
  parentId: string;
  limit?: number;
}): Promise<SquadSponsoredFeeUsageDto[]> {
  return (await invoke('list_squad_sponsored_fee_usage', {
    parentId: params.parentId.trim(),
    limit: params.limit,
  })) as SquadSponsoredFeeUsageDto[];
}

/** Mirrors `SquadSponsorExtStatus` from Tauri. */
export interface SquadSponsorExtMemberPermitDto {
  address: string;
  permitted: boolean;
}

export interface SquadSponsorExtStatusDto {
  chain: string;
  chainId: number;
  parentId: string;
  sponsorAddress: string;
  addressOwner: string;
  hatsWired: boolean;
  memberPermits: SquadSponsorExtMemberPermitDto[];
  /** True when member lookups hit the backend cap (64); page `memberAddresses` in chunks. */
  memberPermitsTruncated: boolean;
}

/** Backend: `get_squad_sponsor_ext_status`. */
export async function getSquadSponsorExtStatus(params: {
  network: string;
  parentId: string;
  memberAddresses: string[];
  sponsorAddress?: string | null;
}): Promise<SquadSponsorExtStatusDto> {
  return (await invoke('get_squad_sponsor_ext_status', {
    network: params.network,
    parentId: params.parentId,
    memberAddresses: params.memberAddresses.map((a) => a.trim()).filter(Boolean),
    sponsorAddress: params.sponsorAddress?.trim() ? params.sponsorAddress.trim() : null,
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as SquadSponsorExtStatusDto;
}

export interface SquadSponsorSetPermittedResultDto {
  txHash: string;
  chain: string;
  chainId: number;
  sponsorAddress: string;
  memberAddress: string;
  permitted: boolean;
}

/** Backend: `squad_sponsor_set_permitted_address`. */
export async function squadSponsorSetPermittedAddress(params: {
  network: string;
  parentId: string;
  memberAddress: string;
  permitted: boolean;
  sponsorAddress?: string | null;
}): Promise<SquadSponsorSetPermittedResultDto> {
  return (await invoke('squad_sponsor_set_permitted_address', {
    network: params.network,
    parentId: params.parentId,
    memberAddress: params.memberAddress.trim(),
    permitted: params.permitted,
    sponsorAddress: params.sponsorAddress?.trim() ? params.sponsorAddress.trim() : null,
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as SquadSponsorSetPermittedResultDto;
}

/** Wire payload for `governance_updated` when squad sponsor infra is deployed or refreshed. */
export function buildSponsorGovernanceAnnouncePayload(params: {
  parentId: string;
  sponsorAddress: string;
  chain: string;
  providerPayload: string;
  entryId: string;
}): {
  parent_id: string;
  provider: 'sponsor';
  canonical_ref: string;
  chain: string;
  entry_id: string;
  provider_payload: string;
} {
  return {
    parent_id: params.parentId,
    provider: 'sponsor',
    canonical_ref: params.sponsorAddress,
    chain: params.chain,
    entry_id: params.entryId,
    provider_payload: params.providerPayload,
  };
}

/** Wire payload for `governance_updated` when pacto-gov (Nave Pirata) infra is deployed. */
export function buildPactoGovGovernanceAnnouncePayload(params: {
  parentId: string;
  topHatId: string;
  chain: string;
  providerPayload: string;
  entryId: string;
  txHash?: string | null;
  pactoGovRevision?: string | null;
}): {
  parent_id: string;
  provider: 'pacto_gov';
  canonical_ref: string;
  chain: string;
  entry_id: string;
  provider_payload: string;
  pacto_gov_revision?: string;
} {
  return {
    parent_id: params.parentId,
    provider: 'pacto_gov',
    canonical_ref: params.topHatId,
    chain: params.chain,
    entry_id: params.entryId,
    provider_payload: withPactoGovProviderPayloadTxHash(params.providerPayload, params.txHash),
    ...(params.pactoGovRevision?.trim()
      ? { pacto_gov_revision: params.pactoGovRevision.trim() }
      : {}),
  };
}

/** Wire payload for `governance_updated` when a standalone vault Safe is linked. */
export function buildStandaloneSafeGovernanceAnnouncePayload(params: {
  parentId: string;
  safeAddress: string;
  chain: string;
  providerPayload: string;
  entryId: string;
}): {
  parent_id: string;
  provider: 'gnosis_safe';
  canonical_ref: string;
  chain: string;
  entry_id: string;
  provider_payload: string;
} {
  return {
    parent_id: params.parentId,
    provider: 'gnosis_safe',
    canonical_ref: params.safeAddress,
    chain: params.chain,
    entry_id: params.entryId,
    provider_payload: params.providerPayload,
  };
}
