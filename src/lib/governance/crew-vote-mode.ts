import { type Abi, decodeFunctionData, encodeFunctionData, type Hex } from 'viem';
import type { CrewVoteMode } from './squad-params';
import { isCrewVoteMode } from './squad-params';

/** uint8: MAJORITY_SNAPSHOT = 0, QUORUM_OF_CAST = 1. */
export const CREW_VOTE_MODE_MAJORITY = 0;
export const CREW_VOTE_MODE_QUORUM = 1;

export const TREASURY_VOTE_ABI = [
  {
    type: 'function',
    name: 'setCrewVoteMode',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_mode', type: 'uint8' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setQuorumBps',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_quorumBps', type: 'uint256' }],
    outputs: [],
  },
] as const satisfies Abi;

export function crewVoteModeToUint8(mode: CrewVoteMode): number {
  return mode === 'quorum' ? CREW_VOTE_MODE_QUORUM : CREW_VOTE_MODE_MAJORITY;
}

export function crewVoteModeFromUint8(raw: number | bigint): CrewVoteMode {
  return Number(raw) === CREW_VOTE_MODE_QUORUM ? 'quorum' : 'majority';
}

export function parseCrewVoteMode(raw: string | null | undefined): CrewVoteMode {
  return isCrewVoteMode(raw) ? raw : 'majority';
}

export function encodeSetCrewVoteMode(mode: CrewVoteMode): Hex {
  return encodeFunctionData({
    abi: TREASURY_VOTE_ABI,
    functionName: 'setCrewVoteMode',
    args: [crewVoteModeToUint8(mode)],
  });
}

export function encodeSetQuorumBps(quorumBps: number): Hex {
  return encodeFunctionData({
    abi: TREASURY_VOTE_ABI,
    functionName: 'setQuorumBps',
    args: [BigInt(quorumBps)],
  });
}

export type DecodedTreasuryVoteCall =
  | { kind: 'set_crew_vote_mode'; mode: CrewVoteMode }
  | { kind: 'set_quorum_bps'; quorumBps: number };

export function decodeTreasuryVoteCall(dataHex: string): DecodedTreasuryVoteCall | null {
  try {
    const decoded = decodeFunctionData({
      abi: TREASURY_VOTE_ABI,
      data: dataHex as Hex,
    });
    if (decoded.functionName === 'setCrewVoteMode') {
      return {
        kind: 'set_crew_vote_mode',
        mode: crewVoteModeFromUint8(decoded.args[0] as number),
      };
    }
    if (decoded.functionName === 'setQuorumBps') {
      const bps = Number(decoded.args[0]);
      return { kind: 'set_quorum_bps', quorumBps: bps };
    }
  } catch {
    return null;
  }
  return null;
}

export function quorumBpsToPercent(bps: number): number {
  return Math.round((bps / 100) * 10) / 10;
}

export type VoteConfigChange =
  | { kind: 'set_crew_vote_mode'; mode: CrewVoteMode }
  | { kind: 'set_quorum_bps'; quorumBps: number };

/** TA proposals to submit for a live settings edit. Quorum bps only when draft mode is quorum. */
export function pendingVoteConfigChanges(args: {
  loadedMode: CrewVoteMode;
  loadedBps: number;
  draftMode: CrewVoteMode;
  draftBps: number;
}): VoteConfigChange[] {
  const out: VoteConfigChange[] = [];
  if (args.draftMode !== args.loadedMode) {
    out.push({ kind: 'set_crew_vote_mode', mode: args.draftMode });
  }
  if (args.draftMode === 'quorum' && args.draftBps !== args.loadedBps) {
    out.push({ kind: 'set_quorum_bps', quorumBps: args.draftBps });
  }
  return out;
}
