import { invoke } from '@tauri-apps/api/core';
import { squadRpcUrlsForInvoke } from '../../squad/squad-rpc-invoke';
import { afterGovWrite } from './internal';
import type { GovernanceWriteResultDto } from './treasury';

export interface MutinyStatusDto {
  activeMutinyId: string;
  proposedNewCaptain: string;
  fromCaptain?: string;
  startedAt: number;
  deadline: number;
  snapshot: number;
  yeas: number;
  executed: boolean;
  seatFormerCaptain?: boolean;
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
  seatFormerCaptain?: boolean;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('mutiny_start_to_crew_member', {
      network: params.network,
      parentId: params.parentId.trim(),
      mutinyModule: params.mutinyModule.trim(),
      proposed: params.proposed.trim(),
      seatFormerCaptain: params.seatFormerCaptain !== false,
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
  seatFormerCaptain?: boolean;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('mutiny_start_to_committee', {
      network: params.network,
      parentId: params.parentId.trim(),
      mutinyModule: params.mutinyModule.trim(),
      proposed: params.proposed.trim(),
      seatFormerCaptain: params.seatFormerCaptain !== false,
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
  seatFormerCaptain?: boolean;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('mutiny_start_to_arbitrary_eoa', {
      network: params.network,
      parentId: params.parentId.trim(),
      mutinyModule: params.mutinyModule.trim(),
      proposed: params.proposed.trim(),
      seatFormerCaptain: params.seatFormerCaptain !== false,
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
  seatFormerCaptain?: boolean;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('mutiny_start_to_arbitrary_contract', {
      network: params.network,
      parentId: params.parentId.trim(),
      mutinyModule: params.mutinyModule.trim(),
      proposed: params.proposed.trim(),
      seatFormerCaptain: params.seatFormerCaptain !== false,
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'mutiny', address: params.proposed, mutinyStart: true },
  );
}

export async function mutinyStartToPauseCaptain(params: {
  network: string;
  parentId: string;
  mutinyModule: string;
  seatFormerCaptain?: boolean;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('mutiny_start_to_pause_captain', {
      network: params.network,
      parentId: params.parentId.trim(),
      mutinyModule: params.mutinyModule.trim(),
      seatFormerCaptain: params.seatFormerCaptain !== false,
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
  seatFormerCaptain?: boolean;
}): Promise<GovernanceWriteResultDto> {
  return afterGovWrite(
    (await invoke('mutiny_captain_resign', {
      network: params.network,
      parentId: params.parentId.trim(),
      mutinyModule: params.mutinyModule.trim(),
      newCaptain: params.newCaptain.trim(),
      seatFormerCaptain: params.seatFormerCaptain !== false,
      rpcUrls: squadRpcUrlsForInvoke(params.parentId, params.network),
    })) as GovernanceWriteResultDto,
    { parentId: params.parentId, kind: 'mutiny', address: params.newCaptain },
  );
}
