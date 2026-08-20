import { invoke } from '@tauri-apps/api/core';
import type { GovernanceProcessKind } from '../announcements';
import { withPactoGovProviderPayloadTxHash } from './pacto-gov-payload';
import { announceGovernanceProcessUpdated } from './governance-process-announce';
import { recordMutinyProcessTx } from './mutiny-process-tx';
import { squadRpcUrlsForInvoke } from '../squad/squad-rpc-invoke';
import type { SquadParamsInput } from './squad-params';
import { squadParamsToInvoke } from './squad-params';

export {
  pactoGovInfraId,
  pactoGovTreasuryEntryId,
  pactoGovWargameInfraId,
  squadAdminInfraId,
  squadSponsorInfraId,
} from './squad-infra-row-id';

/** Mirrors `SquadInfraRow` from Tauri (`serde(rename_all = "camelCase")`). */
export interface SquadInfraDto {
  id: string;
  parentId: string;
  infraType: string;
  chain: string;
  canonicalRef: string;
  pactoGovRevision?: string;
  providerPayload?: string;
  createdAtMs: number;
  updatedAtMs: number;
}

/** Dashboard compat until all surfaces use `infraType` directly. */
export function squadInfraLegacyProvider(infraType: string): string {
  if (infraType === 'standalone_safe') return 'gnosis_safe';
  return infraType;
}

export type ParentGovernanceDto = SquadInfraDto & { provider: string };

export function withLegacyProvider(row: SquadInfraDto): ParentGovernanceDto {
  return { ...row, provider: squadInfraLegacyProvider(row.infraType) };
}

/** Primary row for legacy single-row dashboard surfaces (prefers pacto_gov). */
export function primaryGovernanceView(
  rows: SquadInfraDto[] | undefined,
): ParentGovernanceDto | null | undefined {
  if (rows === undefined) return undefined;
  if (rows.length === 0) return null;
  const row =
    rows.find((r) => r.infraType === 'pacto_gov') ??
    rows.find((r) => r.infraType === 'standalone_safe') ??
    rows.find((r) => r.infraType !== 'pacto_gov_wargame');
  return row ? withLegacyProvider(row) : null;
}

/** Backend: `list_squad_infra`. */
export async function listSquadInfra(parentId: string): Promise<SquadInfraDto[]> {
  const rows = (await invoke('list_squad_infra', { parentId })) as SquadInfraDto[] | null | undefined;
  return rows ?? [];
}

/** Backend: `upsert_squad_infra`. */
export async function upsertSquadInfra(params: {
  id: string;
  parentId: string;
  infraType: string;
  chain?: string | null;
  canonicalRef: string;
  pactoGovRevision?: string | null;
  providerPayload?: string | null;
}): Promise<void> {
  await invoke('upsert_squad_infra', {
    id: params.id,
    parentId: params.parentId,
    infraType: params.infraType,
    chain: params.chain ?? null,
    canonicalRef: params.canonicalRef,
    pactoGovRevision: params.pactoGovRevision ?? null,
    providerPayload: params.providerPayload ?? null,
  });
}

/** Maps legacy announce / UI provider strings to squad infra types. */
export function infraTypeFromLegacyProvider(provider: string): string {
  const p = provider.trim().toLowerCase();
  if (p === 'gnosis_safe' || p === 'gnosis-safe' || p === 'safe') return 'standalone_safe';
  if (p === 'pacto-gov') return 'pacto_gov';
  if (p === 'squad_sponsor') return 'sponsor';
  if (p === 'squad_admin' || p === 'squad-admin') return 'squad_admin';
  return p;
}

/** Sponsor infra row for a parent, if any. */
export function sponsorInfraRow(rows: SquadInfraDto[] | undefined): SquadInfraDto | null {
  return rows?.find((r) => r.infraType === 'sponsor') ?? null;
}

export function hasSponsorInfra(rows: SquadInfraDto[] | undefined): boolean {
  return sponsorInfraRow(rows) != null;
}

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

/** Mirrors `NavePirataDeployResult` from Tauri (`serde(rename_all = "camelCase")`). */
export interface NavePirataDeployResultDto {
  txHash: string;
  chain: string;
  chainId: number;
  topHatId: string;
  safeAddress: string;
  quartermaster: string;
  mutinyModule: string;
  treasuryAuthority: string;
  squadAdminProxy: string;
  providerPayload: string;
  /** Stable `squad_infra` row id persisted by the backend on deploy. */
  infraRowId: string;
}

/** Mirrors `WarGameDeployResult` from Tauri (`serde(rename_all = "camelCase")`). */
export interface WarGameDeployResultDto {
  txHash: string;
  chain: string;
  chainId: number;
  topHatId: string;
  safeAddress: string;
  quartermaster: string;
  mutinyModule: string;
  treasuryAuthority: string;
  squadAdminProxy: string;
  round: string;
  gameSquadId: string;
  sponsorAddress: string;
  retiredSponsor: string | null;
  providerPayload: string;
  infraRowId: string;
}

/** Backend: `deploy_nave_pirata_for_parent`. */
export async function deployNavePirataForParent(params: {
  network: string;
  parentId: string;
  captain: string;
  metadataUri?: string | null;
  saltNonce?: string | null;
  signerWallet?: SquadSponsorDeploySignerWallet;
  /** When UI parent id differs from #announcements MLS id, roster rows may live under this key. */
  altParentId?: string | null;
  squadParams?: SquadParamsInput | null;
}): Promise<NavePirataDeployResultDto> {
  return (await invoke('deploy_nave_pirata_for_parent', {
    network: params.network,
    parentId: params.parentId,
    captain: params.captain,
    metadataUri: params.metadataUri?.trim() ?? '',
    saltNonce: params.saltNonce?.trim() ? params.saltNonce.trim() : null,
    signerWallet: params.signerWallet ?? 'squad',
    altParentId: params.altParentId?.trim() ? params.altParentId.trim() : null,
    squadParams: params.squadParams ? squadParamsToInvoke(params.squadParams) : null,
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as NavePirataDeployResultDto;
}

/** Backend: `deploy_war_game_for_parent`. Always Sepolia. */
export async function deployWarGameForParent(params: {
  parentId: string;
  captain: string;
  metadataUri?: string | null;
  saltNonce?: string | null;
  signerWallet?: SquadSponsorDeploySignerWallet;
  altParentId?: string | null;
  squadParams?: SquadParamsInput | null;
  initialDepositWei?: string | null;
}): Promise<WarGameDeployResultDto> {
  return (await invoke('deploy_war_game_for_parent', {
    network: 'sepolia',
    parentId: params.parentId,
    captain: params.captain,
    metadataUri: params.metadataUri?.trim() ?? '',
    saltNonce: params.saltNonce?.trim() ? params.saltNonce.trim() : null,
    signerWallet: params.signerWallet ?? 'default',
    altParentId: params.altParentId?.trim() ? params.altParentId.trim() : null,
    squadParams: params.squadParams ? squadParamsToInvoke(params.squadParams) : null,
    initialDepositWei: params.initialDepositWei?.trim() ? params.initialDepositWei.trim() : null,
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, 'sepolia'),
  })) as WarGameDeployResultDto;
}

/** Mirrors `NavePirataDeploymentDto` from Tauri (`serde(rename_all = "camelCase")`). */
export interface NavePirataDeploymentDto {
  chain: string;
  chainId: number;
  topHatId: string;
  safe: string;
  quartermaster: string;
  mutinyModule: string;
  treasuryAuthority: string;
  squadAdminProxy: string;
  captainHatId: string;
  crewHatId: string;
  squadAdminHatId: string;
  mutinyRoleHatId: string;
  quartermasterRoleHatId: string;
  treasuryAuthorityRoleHatId: string;
  deployedAt: number;
  deployer: string;
}

export async function getNavePirataDeployment(params: {
  network: string;
  topHatId: string;
  parentId?: string | null;
}): Promise<NavePirataDeploymentDto> {
  return (await invoke('get_nave_pirata_deployment', {
    network: params.network,
    topHatId: params.topHatId.trim(),
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as NavePirataDeploymentDto;
}

/** Backend: `get_war_game_deployment`. Same DTO as Nave Pirata; WarGameRegistry only. */
export async function getWarGameDeployment(params: {
  network: string;
  topHatId: string;
  parentId?: string | null;
}): Promise<NavePirataDeploymentDto> {
  return (await invoke('get_war_game_deployment', {
    network: params.network,
    topHatId: params.topHatId.trim(),
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as NavePirataDeploymentDto;
}

/** Mirrors `TreasuryProposalDto` from Tauri (`serde(rename_all = "camelCase")`). */
export interface TreasuryProposalDto {
  proposalId: string;
  proposer: string;
  to: string;
  valueWei: string;
  operation: string;
  dataHex: string;
  deadline: number;
  snapshot: number;
  yeas: number;
  nays: number;
  captainApproved: boolean;
  captainDefeated: boolean;
  executed: boolean;
  status: string;
}

export async function listTreasuryProposals(params: {
  network: string;
  treasuryAuthority: string;
  maxScan?: number | null;
  parentId?: string | null;
}): Promise<TreasuryProposalDto[]> {
  return (await invoke('list_treasury_proposals', {
    network: params.network,
    treasuryAuthority: params.treasuryAuthority.trim(),
    maxScan: params.maxScan ?? null,
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as TreasuryProposalDto[];
}

export interface TreasuryVoteConfigDto {
  crewVoteMode: string;
  quorumBps: number;
}

/** Backend: `get_treasury_vote_config`. */
export async function getTreasuryVoteConfig(params: {
  network: string;
  treasuryAuthority: string;
  parentId?: string | null;
}): Promise<TreasuryVoteConfigDto> {
  return (await invoke('get_treasury_vote_config', {
    network: params.network,
    treasuryAuthority: params.treasuryAuthority.trim(),
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as TreasuryVoteConfigDto;
}

export async function treasuryProposalHasVoted(params: {
  network: string;
  treasuryAuthority: string;
  proposalId: string;
  voter: string;
  parentId?: string | null;
}): Promise<boolean> {
  return (await invoke('treasury_proposal_has_voted', {
    network: params.network,
    treasuryAuthority: params.treasuryAuthority.trim(),
    proposalId: params.proposalId.trim(),
    voter: params.voter.trim(),
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as boolean;
}

export interface GovernanceWriteResultDto {
  txHash: string;
  chain: string;
  chainId: number;
  /** Module address echoed by Rust when present. */
  treasuryAuthority?: string;
  mutinyModule?: string;
  quartermaster?: string;
  /** Path Rust actually took: sponsored UserOp vs roster-key EOA. */
  fundedBy?: 'sponsored' | 'self_funded';
}

function afterGovWrite(
  result: GovernanceWriteResultDto,
  hint: {
    parentId: string;
    kind: GovernanceProcessKind;
    address?: string;
    proposalId?: string;
    mutinyStart?: boolean;
  },
): GovernanceWriteResultDto {
  if (hint.kind === 'mutiny' && result.txHash?.trim()) {
    recordMutinyProcessTx({
      parentId: hint.parentId,
      txHash: result.txHash,
      isStart: hint.mutinyStart === true,
    });
  }
  void announceGovernanceProcessUpdated({
    parentId: hint.parentId,
    kind: hint.kind,
    address: hint.address,
    proposalId: hint.proposalId,
    txHash: result.txHash,
  });
  return result;
}

export async function treasuryAuthorityPropose(params: {
  network: string;
  parentId: string;
  treasuryAuthority: string;
  to: string;
  valueWei?: string;
  dataHex?: string;
  operation?: string;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('treasury_authority_propose', {
      network: params.network,
      parentId: params.parentId.trim(),
      treasuryAuthority: params.treasuryAuthority.trim(),
      to: params.to.trim(),
      valueWei: params.valueWei?.trim() || '0',
      dataHex: params.dataHex?.trim() || '0x',
      operation: params.operation?.trim() || 'call',
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'ta_proposal' },
  );
}

export async function treasuryAuthorityCrewVote(params: {
  network: string;
  parentId: string;
  treasuryAuthority: string;
  proposalId: string;
  support: boolean;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('treasury_authority_crew_vote', {
      network: params.network,
      parentId: params.parentId.trim(),
      treasuryAuthority: params.treasuryAuthority.trim(),
      proposalId: params.proposalId.trim(),
      support: params.support,
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'ta_proposal', proposalId: params.proposalId },
  );
}

export async function treasuryAuthorityCaptainVote(params: {
  network: string;
  parentId: string;
  treasuryAuthority: string;
  proposalId: string;
  support: boolean;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('treasury_authority_captain_vote', {
      network: params.network,
      parentId: params.parentId.trim(),
      treasuryAuthority: params.treasuryAuthority.trim(),
      proposalId: params.proposalId.trim(),
      support: params.support,
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'ta_proposal', proposalId: params.proposalId },
  );
}

export async function treasuryAuthorityExecute(params: {
  network: string;
  parentId: string;
  treasuryAuthority: string;
  proposalId: string;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('treasury_authority_execute', {
      network: params.network,
      parentId: params.parentId.trim(),
      treasuryAuthority: params.treasuryAuthority.trim(),
      proposalId: params.proposalId.trim(),
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'ta_proposal', proposalId: params.proposalId },
  );
}

export interface MutinyStatusDto {
  activeMutinyId: string;
  proposedNewCaptain: string;
  fromCaptain?: string;
  startedAt: number;
  deadline: number;
  snapshot: number;
  yeas: number;
  executed: boolean;
  captain: string;
}

export async function getMutinyStatus(params: {
  network: string;
  mutinyModule: string;
  parentId?: string | null;
}): Promise<MutinyStatusDto> {
  return (await invoke('get_mutiny_status', {
    network: params.network,
    mutinyModule: params.mutinyModule.trim(),
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as MutinyStatusDto;
}

export async function mutinyHasVoted(params: {
  network: string;
  mutinyModule: string;
  mutinyId: string;
  voter: string;
  parentId?: string | null;
}): Promise<boolean> {
  return (await invoke('mutiny_has_voted', {
    network: params.network,
    mutinyModule: params.mutinyModule.trim(),
    mutinyId: params.mutinyId.trim(),
    voter: params.voter.trim(),
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as boolean;
}

export async function mutinyStartToCrewMember(params: {
  network: string;
  parentId: string;
  mutinyModule: string;
  proposed: string;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('mutiny_start_to_crew_member', {
      network: params.network,
      parentId: params.parentId.trim(),
      mutinyModule: params.mutinyModule.trim(),
      proposed: params.proposed.trim(),
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'mutiny', address: params.proposed, mutinyStart: true },
  );
}

export async function mutinyStartToCommittee(params: {
  network: string;
  parentId: string;
  mutinyModule: string;
  proposed: string;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('mutiny_start_to_committee', {
      network: params.network,
      parentId: params.parentId.trim(),
      mutinyModule: params.mutinyModule.trim(),
      proposed: params.proposed.trim(),
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'mutiny', address: params.proposed, mutinyStart: true },
  );
}

export async function mutinyStartToArbitraryEoa(params: {
  network: string;
  parentId: string;
  mutinyModule: string;
  proposed: string;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('mutiny_start_to_arbitrary_eoa', {
      network: params.network,
      parentId: params.parentId.trim(),
      mutinyModule: params.mutinyModule.trim(),
      proposed: params.proposed.trim(),
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'mutiny', address: params.proposed, mutinyStart: true },
  );
}

export async function mutinyStartToArbitraryContract(params: {
  network: string;
  parentId: string;
  mutinyModule: string;
  proposed: string;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('mutiny_start_to_arbitrary_contract', {
      network: params.network,
      parentId: params.parentId.trim(),
      mutinyModule: params.mutinyModule.trim(),
      proposed: params.proposed.trim(),
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'mutiny', address: params.proposed, mutinyStart: true },
  );
}

export async function mutinyStartToPauseCaptain(params: {
  network: string;
  parentId: string;
  mutinyModule: string;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('mutiny_start_to_pause_captain', {
      network: params.network,
      parentId: params.parentId.trim(),
      mutinyModule: params.mutinyModule.trim(),
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'mutiny', mutinyStart: true },
  );
}

export async function mutinyCastVote(params: {
  network: string;
  parentId: string;
  mutinyModule: string;
  mutinyId: string;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('mutiny_cast_vote', {
      network: params.network,
      parentId: params.parentId.trim(),
      mutinyModule: params.mutinyModule.trim(),
      mutinyId: params.mutinyId.trim(),
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'mutiny' },
  );
}

export async function mutinyExecute(params: {
  network: string;
  parentId: string;
  mutinyModule: string;
  mutinyId: string;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('mutiny_execute', {
      network: params.network,
      parentId: params.parentId.trim(),
      mutinyModule: params.mutinyModule.trim(),
      mutinyId: params.mutinyId.trim(),
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'mutiny' },
  );
}

export async function mutinyExpire(params: {
  network: string;
  parentId: string;
  mutinyModule: string;
  mutinyId: string;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('mutiny_expire', {
      network: params.network,
      parentId: params.parentId.trim(),
      mutinyModule: params.mutinyModule.trim(),
      mutinyId: params.mutinyId.trim(),
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'mutiny' },
  );
}

export async function mutinyCaptainResign(params: {
  network: string;
  parentId: string;
  mutinyModule: string;
  newCaptain: string;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('mutiny_captain_resign', {
      network: params.network,
      parentId: params.parentId.trim(),
      mutinyModule: params.mutinyModule.trim(),
      newCaptain: params.newCaptain.trim(),
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'mutiny', address: params.newCaptain },
  );
}

export interface CrewOffboardDto {
  offboardId: string;
  target: string;
  proposer: string;
  deadline: number;
  snapshot: number;
  yeas: number;
  nays: number;
  executed: boolean;
}

export interface QuartermasterStatusDto {
  crewChangeDelaySecs: string;
  mutinyActive: boolean;
  crewHatSupply?: number;
  bootstrapAvailable?: boolean;
  activeCrewOffboardId: string;
  crewOffboardExpirySecs: string;
  crewOffboardQuorumBps: string;
  offboard?: CrewOffboardDto | null;
}

export interface QuartermasterPendingDto {
  address: string;
  pendingAddAt: string;
  pendingRemoveAt: string;
}

/** Pending crew add/remove discovered via QM logs + `pending*At` verify. */
export interface QuartermasterPendingActionDto {
  kind: 'add' | 'remove';
  address: string;
  executableAt: string;
}

export async function getQuartermasterStatus(params: {
  network: string;
  quartermaster: string;
  parentId?: string | null;
}): Promise<QuartermasterStatusDto> {
  return (await invoke('get_quartermaster_status', {
    network: params.network,
    quartermaster: params.quartermaster.trim(),
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as QuartermasterStatusDto;
}

export async function getQuartermasterPending(params: {
  network: string;
  quartermaster: string;
  address: string;
  parentId?: string | null;
}): Promise<QuartermasterPendingDto> {
  return (await invoke('get_quartermaster_pending', {
    network: params.network,
    quartermaster: params.quartermaster.trim(),
    address: params.address.trim(),
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as QuartermasterPendingDto;
}

export async function listQuartermasterPending(params: {
  network: string;
  parentId: string;
  quartermaster: string;
}): Promise<QuartermasterPendingActionDto[]> {
  return (await invoke('list_quartermaster_pending', {
    network: params.network,
    parentId: params.parentId.trim(),
    quartermaster: params.quartermaster.trim(),
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as QuartermasterPendingActionDto[];
}

export async function quartermasterRequestAddCrew(params: {
  network: string;
  parentId: string;
  quartermaster: string;
  candidate: string;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('quartermaster_request_add_crew', {
      network: params.network,
      parentId: params.parentId.trim(),
      quartermaster: params.quartermaster.trim(),
      candidate: params.candidate.trim(),
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'qm_pending', address: params.candidate },
  );
}

export async function quartermasterCancelAddCrew(params: {
  network: string;
  parentId: string;
  quartermaster: string;
  candidate: string;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('quartermaster_cancel_add_crew', {
      network: params.network,
      parentId: params.parentId.trim(),
      quartermaster: params.quartermaster.trim(),
      candidate: params.candidate.trim(),
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'qm_pending', address: params.candidate },
  );
}

export async function quartermasterExecuteAddCrew(params: {
  network: string;
  parentId: string;
  quartermaster: string;
  candidate: string;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('quartermaster_execute_add_crew', {
      network: params.network,
      parentId: params.parentId.trim(),
      quartermaster: params.quartermaster.trim(),
      candidate: params.candidate.trim(),
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'qm_pending', address: params.candidate },
  );
}

export async function quartermasterBootstrapCrew(params: {
  network: string;
  parentId: string;
  quartermaster: string;
  candidates: string[];
}): Promise<GovernanceWriteResultDto> {
  return (await invoke('quartermaster_bootstrap_crew', {
    network: params.network,
    parentId: params.parentId.trim(),
    quartermaster: params.quartermaster.trim(),
    candidates: params.candidates.map((c) => c.trim()).filter(Boolean),
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as GovernanceWriteResultDto;
}

export async function quartermasterRequestRemoveCrew(params: {
  network: string;
  parentId: string;
  quartermaster: string;
  crew: string;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('quartermaster_request_remove_crew', {
      network: params.network,
      parentId: params.parentId.trim(),
      quartermaster: params.quartermaster.trim(),
      crew: params.crew.trim(),
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'qm_pending', address: params.crew },
  );
}

export async function quartermasterCancelRemoveCrew(params: {
  network: string;
  parentId: string;
  quartermaster: string;
  crew: string;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('quartermaster_cancel_remove_crew', {
      network: params.network,
      parentId: params.parentId.trim(),
      quartermaster: params.quartermaster.trim(),
      crew: params.crew.trim(),
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'qm_pending', address: params.crew },
  );
}

export async function quartermasterExecuteRemoveCrew(params: {
  network: string;
  parentId: string;
  quartermaster: string;
  crew: string;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('quartermaster_execute_remove_crew', {
      network: params.network,
      parentId: params.parentId.trim(),
      quartermaster: params.quartermaster.trim(),
      crew: params.crew.trim(),
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'qm_pending', address: params.crew },
  );
}

export async function crewOffboardHasVoted(params: {
  network: string;
  quartermaster: string;
  offboardId: string;
  voter: string;
  parentId?: string | null;
}): Promise<boolean> {
  return (await invoke('crew_offboard_has_voted', {
    network: params.network,
    quartermaster: params.quartermaster.trim(),
    offboardId: params.offboardId.trim(),
    voter: params.voter.trim(),
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as boolean;
}

export async function quartermasterProposeOffboard(params: {
  network: string;
  parentId: string;
  quartermaster: string;
  target: string;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('quartermaster_propose_offboard', {
      network: params.network,
      parentId: params.parentId.trim(),
      quartermaster: params.quartermaster.trim(),
      target: params.target.trim(),
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'crew_offboard', address: params.target },
  );
}

export async function quartermasterCrewOffboardVote(params: {
  network: string;
  parentId: string;
  quartermaster: string;
  offboardId: string;
  support: boolean;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('quartermaster_crew_offboard_vote', {
      network: params.network,
      parentId: params.parentId.trim(),
      quartermaster: params.quartermaster.trim(),
      offboardId: params.offboardId.trim(),
      support: params.support,
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'crew_offboard' },
  );
}

export async function quartermasterExecuteOffboard(params: {
  network: string;
  parentId: string;
  quartermaster: string;
  offboardId: string;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('quartermaster_execute_offboard', {
      network: params.network,
      parentId: params.parentId.trim(),
      quartermaster: params.quartermaster.trim(),
      offboardId: params.offboardId.trim(),
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'crew_offboard' },
  );
}

export async function quartermasterExpireOffboard(params: {
  network: string;
  parentId: string;
  quartermaster: string;
  offboardId: string;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('quartermaster_expire_offboard', {
      network: params.network,
      parentId: params.parentId.trim(),
      quartermaster: params.quartermaster.trim(),
      offboardId: params.offboardId.trim(),
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'crew_offboard' },
  );
}

/** Mirrors `HatTreeNodeDto` from Tauri (`serde(rename_all = "camelCase")`). */
export interface HatTreeNodeDto {
  hatId: string;
  details: string;
  maxSupply: number;
  supply: number;
  active: boolean;
  children: HatTreeNodeDto[];
}

export async function getHatsTree(params: {
  network: string;
  topHatId: string;
  maxDepth?: number | null;
  maxNodes?: number | null;
  parentId?: string | null;
}): Promise<HatTreeNodeDto> {
  return (await invoke('get_hats_tree', {
    network: params.network,
    topHatId: params.topHatId.trim(),
    maxDepth: params.maxDepth ?? null,
    maxNodes: params.maxNodes ?? null,
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as HatTreeNodeDto;
}

export interface MemberHatLabelDto {
  hatId: string;
  label: string;
}

export interface MemberHatAssignmentDto {
  address: string;
  hats: MemberHatLabelDto[];
}

export async function getMemberHatWearers(params: {
  network: string;
  hatsContract?: string | null;
  memberAddresses: string[];
  hatChecks: { hatId: string; label: string }[];
  parentId?: string | null;
}): Promise<MemberHatAssignmentDto[]> {
  return (await invoke('get_member_hat_wearers', {
    network: params.network,
    hatsContract: params.hatsContract?.trim() ? params.hatsContract.trim() : null,
    memberAddresses: params.memberAddresses,
    hatChecks: params.hatChecks,
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as MemberHatAssignmentDto[];
}

export interface SquadAdminExecutorRolesDto {
  address: string;
  fullPermission: boolean;
  paused: boolean;
  roles: { role: string; enabled: boolean }[];
}

export async function getSquadAdminExecutorRoles(params: {
  network: string;
  squadAdminProxy: string;
  executorAddress: string;
  parentId?: string | null;
}): Promise<SquadAdminExecutorRolesDto> {
  return (await invoke('get_squad_admin_executor_roles', {
    network: params.network,
    squadAdminProxy: params.squadAdminProxy.trim(),
    executorAddress: params.executorAddress.trim(),
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as SquadAdminExecutorRolesDto;
}

/** Wire payload for `governance_updated` when squad-admin infra is deployed. */
export function buildSquadAdminGovernanceAnnouncePayload(params: {
  parentId: string;
  squadAdminProxy: string;
  chain: string;
  providerPayload: string;
  entryId: string;
}): {
  parent_id: string;
  provider: 'squad_admin';
  canonical_ref: string;
  chain: string;
  entry_id: string;
  provider_payload: string;
} {
  return {
    parent_id: params.parentId,
    provider: 'squad_admin',
    canonical_ref: params.squadAdminProxy,
    chain: params.chain,
    entry_id: params.entryId,
    provider_payload: params.providerPayload,
  };
}

/** Mirrors `SquadAdminDeployResult` from Tauri (`serde(rename_all = "camelCase")`). */
export interface SquadAdminDeployResultDto {
  txHash: string;
  chain: string;
  chainId: number;
  squadAdminProxy: string;
  variant: string;
  owner?: string | null;
  captainHatId?: string | null;
  implementation: string;
  providerPayload: string;
  infraRowId: string;
}

/** Backend: `deploy_squad_admin_for_parent`. */
export async function deploySquadAdminForParent(params: {
  network: string;
  parentId: string;
  variant: 'ext_standalone' | 'captain_hat';
  owner?: string | null;
  captainHatId?: string | null;
}): Promise<SquadAdminDeployResultDto> {
  return (await invoke('deploy_squad_admin_for_parent', {
    network: params.network,
    parentId: params.parentId,
    variant: params.variant,
    owner: params.owner?.trim() ? params.owner.trim() : null,
    captainHatId: params.captainHatId?.trim() ? params.captainHatId.trim() : null,
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as SquadAdminDeployResultDto;
}

/** Mirrors `SquadAdminWriteResult` from Tauri. */
export interface SquadAdminWriteResultDto {
  txHash: string;
  chain: string;
  chainId: number;
  squadAdminProxy: string;
}

export async function squadAdminCreateRole(params: {
  network: string;
  parentId: string;
  squadAdminProxy: string;
  roleLabel: string;
}): Promise<SquadAdminWriteResultDto> {
  return (await invoke('squad_admin_create_role', {
    network: params.network,
    parentId: params.parentId.trim(),
    squadAdminProxy: params.squadAdminProxy.trim(),
    roleLabel: params.roleLabel.trim(),
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as SquadAdminWriteResultDto;
}

export async function squadAdminEnableExecutor(params: {
  network: string;
  parentId: string;
  squadAdminProxy: string;
  executorAddress: string;
  roleLabel: string;
}): Promise<SquadAdminWriteResultDto> {
  return (await invoke('squad_admin_enable_executor', {
    network: params.network,
    parentId: params.parentId.trim(),
    squadAdminProxy: params.squadAdminProxy.trim(),
    executorAddress: params.executorAddress.trim(),
    roleLabel: params.roleLabel.trim(),
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as SquadAdminWriteResultDto;
}

export async function squadAdminEnableFullPermission(params: {
  network: string;
  parentId: string;
  squadAdminProxy: string;
  executorAddress: string;
  enable: boolean;
}): Promise<SquadAdminWriteResultDto> {
  return (await invoke('squad_admin_enable_full_permission', {
    network: params.network,
    parentId: params.parentId.trim(),
    squadAdminProxy: params.squadAdminProxy.trim(),
    executorAddress: params.executorAddress.trim(),
    enable: params.enable,
    rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
  })) as SquadAdminWriteResultDto;
}

export interface CapabilityFlagDto {
  allowed: boolean;
  reason: string;
}

export interface SquadCapabilitiesDto {
  parentId: string;
  rosterAddress: string;
  wearsCaptain: boolean;
  wearsCrew: boolean;
  captainIsSafe: boolean;
  squadAdminFull: boolean;
  squadAdminPaused: boolean;
  roleLabel: string;
  capabilities: Record<string, CapabilityFlagDto>;
}

/** Backend: `get_squad_capabilities`. */
export async function getSquadCapabilities(
  parentId: string,
  network?: string | null,
  opts?: { wargame?: boolean },
): Promise<SquadCapabilitiesDto> {
  return (await invoke('get_squad_capabilities', {
    parentId: parentId.trim(),
    rpcUrls: squadRpcUrlsForInvoke(parentId, network),
    wargame: opts?.wargame === true,
  })) as SquadCapabilitiesDto;
}

/** Pacto-gov infra row for a parent, if any. Never matches `pacto_gov_wargame`. */
export function pactoGovInfraRow(rows: SquadInfraDto[] | undefined): SquadInfraDto | null {
  return rows?.find((r) => r.infraType === 'pacto_gov') ?? null;
}

/** War-game stack row for a parent, if any. */
export function pactoGovWargameInfraRow(rows: SquadInfraDto[] | undefined): SquadInfraDto | null {
  return rows?.find((r) => r.infraType === 'pacto_gov_wargame') ?? null;
}

/** Squad-admin infra row for a parent (standalone deploy), if any. */
export function squadAdminInfraRow(rows: SquadInfraDto[] | undefined): SquadInfraDto | null {
  return rows?.find((r) => r.infraType === 'squad_admin') ?? null;
}
