import { invoke } from '@tauri-apps/api/core';
import { squadRpcUrlsForInvoke } from '../squad/squad-rpc-invoke';
import { afterGovWrite } from './api-internal';
import type { GovernanceWriteResultDto } from './api-treasury';

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
  return afterGovWrite(
    (await invoke('quartermaster_bootstrap_crew', {
      network: params.network,
      parentId: params.parentId.trim(),
      quartermaster: params.quartermaster.trim(),
      candidates: params.candidates.map((c) => c.trim()).filter(Boolean),
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'hats' },
  );
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
