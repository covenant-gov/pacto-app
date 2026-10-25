import { invoke } from '@tauri-apps/api/core';
import { squadRpcUrlsForInvoke } from '../../squad/squad-rpc-invoke';
import { afterGovWrite } from './internal';

/** Mirrors `TreasuryProposalDto` from Tauri (`serde(rename_all = "camelCase")`). */
export interface TreasuryProposalDto {
  proposalId: string;
  proposer: string;
  to: string;
  valueWei: string;
  operation: string;
  dataHex: string;
  /** keccak256 of execute bytes; empty `dataHex` is filled from replica. */
  dataHash?: string;
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

export async function treasuryAuthorityPropose(params: {
  network: string;
  parentId: string;
  treasuryAuthority: string;
  to: string;
  valueWei?: string;
  dataHex?: string;
  operation?: string;
}): Promise<GovernanceWriteResultDto> {
  const dataHex = params.dataHex?.trim() || '0x';
  const { rememberTreasuryProposeCalldata } = await import('../treasury-proposal-calldata');
  rememberTreasuryProposeCalldata(params.parentId, dataHex);
  return afterGovWrite(
    (await invoke('treasury_authority_propose', {
      network: params.network,
      parentId: params.parentId.trim(),
      treasuryAuthority: params.treasuryAuthority.trim(),
      to: params.to.trim(),
      valueWei: params.valueWei?.trim() || '0',
      dataHex,
      operation: params.operation?.trim() || 'call',
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'ta_proposal', proposedDataHex: dataHex },
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
  dataHex: string;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('treasury_authority_execute', {
      network: params.network,
      parentId: params.parentId.trim(),
      treasuryAuthority: params.treasuryAuthority.trim(),
      proposalId: params.proposalId.trim(),
      dataHex: params.dataHex.trim() || '0x',
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'ta_proposal', proposalId: params.proposalId },
  );
}
