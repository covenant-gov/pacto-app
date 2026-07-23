import { invoke } from '@tauri-apps/api/core';
import { withPactoGovProviderPayloadTxHash } from './pacto-gov-payload';

export {
  pactoGovInfraId,
  pactoGovTreasuryEntryId,
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
    rows[0];
  return withLegacyProvider(row);
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
  })) as SquadSponsorSummaryDto;
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
}): Promise<NavePirataDeployResultDto> {
  return (await invoke('deploy_nave_pirata_for_parent', {
    network: params.network,
    parentId: params.parentId,
    captain: params.captain,
    metadataUri: params.metadataUri?.trim() ?? '',
    saltNonce: params.saltNonce?.trim() ? params.saltNonce.trim() : null,
    signerWallet: params.signerWallet ?? 'squad',
    altParentId: params.altParentId?.trim() ? params.altParentId.trim() : null,
  })) as NavePirataDeployResultDto;
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
}): Promise<NavePirataDeploymentDto> {
  return (await invoke('get_nave_pirata_deployment', {
    network: params.network,
    topHatId: params.topHatId.trim(),
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
}): Promise<TreasuryProposalDto[]> {
  return (await invoke('list_treasury_proposals', {
    network: params.network,
    treasuryAuthority: params.treasuryAuthority.trim(),
    maxScan: params.maxScan ?? null,
  })) as TreasuryProposalDto[];
}

export async function treasuryProposalHasVoted(params: {
  network: string;
  treasuryAuthority: string;
  proposalId: string;
  voter: string;
}): Promise<boolean> {
  return (await invoke('treasury_proposal_has_voted', {
    network: params.network,
    treasuryAuthority: params.treasuryAuthority.trim(),
    proposalId: params.proposalId.trim(),
    voter: params.voter.trim(),
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
  return (await invoke('treasury_authority_propose', {
    network: params.network,
    parentId: params.parentId.trim(),
    treasuryAuthority: params.treasuryAuthority.trim(),
    to: params.to.trim(),
    valueWei: params.valueWei?.trim() || '0',
    dataHex: params.dataHex?.trim() || '0x',
    operation: params.operation?.trim() || 'call',
  })) as GovernanceWriteResultDto;
}

export async function treasuryAuthorityCrewVote(params: {
  network: string;
  parentId: string;
  treasuryAuthority: string;
  proposalId: string;
  support: boolean;
}): Promise<GovernanceWriteResultDto> {
  return (await invoke('treasury_authority_crew_vote', {
    network: params.network,
    parentId: params.parentId.trim(),
    treasuryAuthority: params.treasuryAuthority.trim(),
    proposalId: params.proposalId.trim(),
    support: params.support,
  })) as GovernanceWriteResultDto;
}

export async function treasuryAuthorityCaptainVote(params: {
  network: string;
  parentId: string;
  treasuryAuthority: string;
  proposalId: string;
  support: boolean;
}): Promise<GovernanceWriteResultDto> {
  return (await invoke('treasury_authority_captain_vote', {
    network: params.network,
    parentId: params.parentId.trim(),
    treasuryAuthority: params.treasuryAuthority.trim(),
    proposalId: params.proposalId.trim(),
    support: params.support,
  })) as GovernanceWriteResultDto;
}

export async function treasuryAuthorityExecute(params: {
  network: string;
  parentId: string;
  treasuryAuthority: string;
  proposalId: string;
}): Promise<GovernanceWriteResultDto> {
  return (await invoke('treasury_authority_execute', {
    network: params.network,
    parentId: params.parentId.trim(),
    treasuryAuthority: params.treasuryAuthority.trim(),
    proposalId: params.proposalId.trim(),
  })) as GovernanceWriteResultDto;
}

export interface MutinyStatusDto {
  activeMutinyId: string;
  proposedNewCaptain: string;
  startedAt: number;
  snapshot: number;
  yeas: number;
  executed: boolean;
  captain: string;
}

export async function getMutinyStatus(params: {
  network: string;
  mutinyModule: string;
}): Promise<MutinyStatusDto> {
  return (await invoke('get_mutiny_status', {
    network: params.network,
    mutinyModule: params.mutinyModule.trim(),
  })) as MutinyStatusDto;
}

export async function mutinyHasVoted(params: {
  network: string;
  mutinyModule: string;
  mutinyId: string;
  voter: string;
}): Promise<boolean> {
  return (await invoke('mutiny_has_voted', {
    network: params.network,
    mutinyModule: params.mutinyModule.trim(),
    mutinyId: params.mutinyId.trim(),
    voter: params.voter.trim(),
  })) as boolean;
}

export async function mutinyStartToCrewMember(params: {
  network: string;
  parentId: string;
  mutinyModule: string;
  proposed: string;
}): Promise<GovernanceWriteResultDto> {
  return (await invoke('mutiny_start_to_crew_member', {
    network: params.network,
    parentId: params.parentId.trim(),
    mutinyModule: params.mutinyModule.trim(),
    proposed: params.proposed.trim(),
  })) as GovernanceWriteResultDto;
}

export async function mutinyStartToCommittee(params: {
  network: string;
  parentId: string;
  mutinyModule: string;
  proposed: string;
}): Promise<GovernanceWriteResultDto> {
  return (await invoke('mutiny_start_to_committee', {
    network: params.network,
    parentId: params.parentId.trim(),
    mutinyModule: params.mutinyModule.trim(),
    proposed: params.proposed.trim(),
  })) as GovernanceWriteResultDto;
}

export async function mutinyStartToArbitraryEoa(params: {
  network: string;
  parentId: string;
  mutinyModule: string;
  proposed: string;
}): Promise<GovernanceWriteResultDto> {
  return (await invoke('mutiny_start_to_arbitrary_eoa', {
    network: params.network,
    parentId: params.parentId.trim(),
    mutinyModule: params.mutinyModule.trim(),
    proposed: params.proposed.trim(),
  })) as GovernanceWriteResultDto;
}

export async function mutinyStartToArbitraryContract(params: {
  network: string;
  parentId: string;
  mutinyModule: string;
  proposed: string;
}): Promise<GovernanceWriteResultDto> {
  return (await invoke('mutiny_start_to_arbitrary_contract', {
    network: params.network,
    parentId: params.parentId.trim(),
    mutinyModule: params.mutinyModule.trim(),
    proposed: params.proposed.trim(),
  })) as GovernanceWriteResultDto;
}

export async function mutinyStartToPauseCaptain(params: {
  network: string;
  parentId: string;
  mutinyModule: string;
}): Promise<GovernanceWriteResultDto> {
  return (await invoke('mutiny_start_to_pause_captain', {
    network: params.network,
    parentId: params.parentId.trim(),
    mutinyModule: params.mutinyModule.trim(),
  })) as GovernanceWriteResultDto;
}

export async function mutinyCastVote(params: {
  network: string;
  parentId: string;
  mutinyModule: string;
  mutinyId: string;
}): Promise<GovernanceWriteResultDto> {
  return (await invoke('mutiny_cast_vote', {
    network: params.network,
    parentId: params.parentId.trim(),
    mutinyModule: params.mutinyModule.trim(),
    mutinyId: params.mutinyId.trim(),
  })) as GovernanceWriteResultDto;
}

export async function mutinyExecute(params: {
  network: string;
  parentId: string;
  mutinyModule: string;
  mutinyId: string;
}): Promise<GovernanceWriteResultDto> {
  return (await invoke('mutiny_execute', {
    network: params.network,
    parentId: params.parentId.trim(),
    mutinyModule: params.mutinyModule.trim(),
    mutinyId: params.mutinyId.trim(),
  })) as GovernanceWriteResultDto;
}

export async function mutinyCaptainResign(params: {
  network: string;
  parentId: string;
  mutinyModule: string;
  newCaptain: string;
}): Promise<GovernanceWriteResultDto> {
  return (await invoke('mutiny_captain_resign', {
    network: params.network,
    parentId: params.parentId.trim(),
    mutinyModule: params.mutinyModule.trim(),
    newCaptain: params.newCaptain.trim(),
  })) as GovernanceWriteResultDto;
}

export interface QuartermasterStatusDto {
  crewChangeDelaySecs: string;
  mutinyActive: boolean;
  crewHatSupply?: number;
  bootstrapAvailable?: boolean;
}

export interface QuartermasterPendingDto {
  address: string;
  pendingAddAt: string;
  pendingRemoveAt: string;
}

/** Pending crew add/remove discovered via QM logs + `pending*At` verify. */
export interface QuartermasterPendingActionDto {
  kind: 'add' | 'remove' | string;
  address: string;
  executableAt: string;
}

export async function getQuartermasterStatus(params: {
  network: string;
  quartermaster: string;
}): Promise<QuartermasterStatusDto> {
  return (await invoke('get_quartermaster_status', {
    network: params.network,
    quartermaster: params.quartermaster.trim(),
  })) as QuartermasterStatusDto;
}

export async function getQuartermasterPending(params: {
  network: string;
  quartermaster: string;
  address: string;
}): Promise<QuartermasterPendingDto> {
  return (await invoke('get_quartermaster_pending', {
    network: params.network,
    quartermaster: params.quartermaster.trim(),
    address: params.address.trim(),
  })) as QuartermasterPendingDto;
}

export async function listQuartermasterPending(params: {
  network: string;
  quartermaster: string;
  fromBlock?: number;
}): Promise<QuartermasterPendingActionDto[]> {
  return (await invoke('list_quartermaster_pending', {
    network: params.network,
    quartermaster: params.quartermaster.trim(),
    fromBlock: params.fromBlock ?? null,
  })) as QuartermasterPendingActionDto[];
}

export async function quartermasterRequestAddCrew(params: {
  network: string;
  parentId: string;
  quartermaster: string;
  candidate: string;
}): Promise<GovernanceWriteResultDto> {
  return (await invoke('quartermaster_request_add_crew', {
    network: params.network,
    parentId: params.parentId.trim(),
    quartermaster: params.quartermaster.trim(),
    candidate: params.candidate.trim(),
  })) as GovernanceWriteResultDto;
}

export async function quartermasterCancelAddCrew(params: {
  network: string;
  parentId: string;
  quartermaster: string;
  candidate: string;
}): Promise<GovernanceWriteResultDto> {
  return (await invoke('quartermaster_cancel_add_crew', {
    network: params.network,
    parentId: params.parentId.trim(),
    quartermaster: params.quartermaster.trim(),
    candidate: params.candidate.trim(),
  })) as GovernanceWriteResultDto;
}

export async function quartermasterExecuteAddCrew(params: {
  network: string;
  parentId: string;
  quartermaster: string;
  candidate: string;
}): Promise<GovernanceWriteResultDto> {
  return (await invoke('quartermaster_execute_add_crew', {
    network: params.network,
    parentId: params.parentId.trim(),
    quartermaster: params.quartermaster.trim(),
    candidate: params.candidate.trim(),
  })) as GovernanceWriteResultDto;
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
  })) as GovernanceWriteResultDto;
}

export async function quartermasterRequestRemoveCrew(params: {
  network: string;
  parentId: string;
  quartermaster: string;
  crew: string;
}): Promise<GovernanceWriteResultDto> {
  return (await invoke('quartermaster_request_remove_crew', {
    network: params.network,
    parentId: params.parentId.trim(),
    quartermaster: params.quartermaster.trim(),
    crew: params.crew.trim(),
  })) as GovernanceWriteResultDto;
}

export async function quartermasterCancelRemoveCrew(params: {
  network: string;
  parentId: string;
  quartermaster: string;
  crew: string;
}): Promise<GovernanceWriteResultDto> {
  return (await invoke('quartermaster_cancel_remove_crew', {
    network: params.network,
    parentId: params.parentId.trim(),
    quartermaster: params.quartermaster.trim(),
    crew: params.crew.trim(),
  })) as GovernanceWriteResultDto;
}

export async function quartermasterExecuteRemoveCrew(params: {
  network: string;
  parentId: string;
  quartermaster: string;
  crew: string;
}): Promise<GovernanceWriteResultDto> {
  return (await invoke('quartermaster_execute_remove_crew', {
    network: params.network,
    parentId: params.parentId.trim(),
    quartermaster: params.quartermaster.trim(),
    crew: params.crew.trim(),
  })) as GovernanceWriteResultDto;
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
}): Promise<HatTreeNodeDto> {
  return (await invoke('get_hats_tree', {
    network: params.network,
    topHatId: params.topHatId.trim(),
    maxDepth: params.maxDepth ?? null,
    maxNodes: params.maxNodes ?? null,
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
}): Promise<MemberHatAssignmentDto[]> {
  return (await invoke('get_member_hat_wearers', {
    network: params.network,
    hatsContract: params.hatsContract?.trim() ? params.hatsContract.trim() : null,
    memberAddresses: params.memberAddresses,
    hatChecks: params.hatChecks,
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
}): Promise<SquadAdminExecutorRolesDto> {
  return (await invoke('get_squad_admin_executor_roles', {
    network: params.network,
    squadAdminProxy: params.squadAdminProxy.trim(),
    executorAddress: params.executorAddress.trim(),
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
export async function getSquadCapabilities(parentId: string): Promise<SquadCapabilitiesDto> {
  return (await invoke('get_squad_capabilities', {
    parentId: parentId.trim(),
  })) as SquadCapabilitiesDto;
}

/** Pacto-gov infra row for a parent, if any. */
export function pactoGovInfraRow(rows: SquadInfraDto[] | undefined): SquadInfraDto | null {
  return rows?.find((r) => r.infraType === 'pacto_gov') ?? null;
}

/** Squad-admin infra row for a parent (standalone deploy), if any. */
export function squadAdminInfraRow(rows: SquadInfraDto[] | undefined): SquadInfraDto | null {
  return rows?.find((r) => r.infraType === 'squad_admin') ?? null;
}
