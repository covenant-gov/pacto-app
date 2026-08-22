import { describe, expect, it } from 'vitest';
import {
  crewVoteModeFromUint8,
  crewVoteModeToUint8,
  decodeTreasuryVoteCall,
  encodeSetCrewVoteMode,
  encodeSetQuorumBps,
  parseCrewVoteMode,
  pendingVoteConfigChanges,
  quorumBpsToPercent,
} from './crew-vote-mode';

describe('crew vote mode encoding', () => {
  it('round-trips majority and quorum calldata', () => {
    const majority = encodeSetCrewVoteMode('majority');
    const quorum = encodeSetCrewVoteMode('quorum');
    expect(decodeTreasuryVoteCall(majority)).toEqual({
      kind: 'set_crew_vote_mode',
      mode: 'majority',
    });
    expect(decodeTreasuryVoteCall(quorum)).toEqual({
      kind: 'set_crew_vote_mode',
      mode: 'quorum',
    });
    expect(majority).not.toBe(quorum);
  });

  it('round-trips quorum bps', () => {
    const data = encodeSetQuorumBps(2500);
    expect(decodeTreasuryVoteCall(data)).toEqual({ kind: 'set_quorum_bps', quorumBps: 2500 });
  });

  it('maps uint8 and unknown strings', () => {
    expect(crewVoteModeToUint8('majority')).toBe(0);
    expect(crewVoteModeToUint8('quorum')).toBe(1);
    expect(crewVoteModeFromUint8(1)).toBe('quorum');
    expect(parseCrewVoteMode('nope')).toBe('majority');
    expect(quorumBpsToPercent(3000)).toBe(30);
  });
});

describe('pendingVoteConfigChanges', () => {
  it('proposes mode then quorum bps when switching to quorum with a new threshold', () => {
    expect(
      pendingVoteConfigChanges({
        loadedMode: 'majority',
        loadedBps: 3000,
        draftMode: 'quorum',
        draftBps: 2500,
      }),
    ).toEqual([
      { kind: 'set_crew_vote_mode', mode: 'quorum' },
      { kind: 'set_quorum_bps', quorumBps: 2500 },
    ]);
  });

  it('omits quorum bps when leaving quorum mode', () => {
    expect(
      pendingVoteConfigChanges({
        loadedMode: 'quorum',
        loadedBps: 3000,
        draftMode: 'majority',
        draftBps: 4000,
      }),
    ).toEqual([{ kind: 'set_crew_vote_mode', mode: 'majority' }]);
  });

  it('proposes only quorum bps when already in quorum', () => {
    expect(
      pendingVoteConfigChanges({
        loadedMode: 'quorum',
        loadedBps: 3000,
        draftMode: 'quorum',
        draftBps: 4000,
      }),
    ).toEqual([{ kind: 'set_quorum_bps', quorumBps: 4000 }]);
  });

  it('is empty when nothing applicable changed', () => {
    expect(
      pendingVoteConfigChanges({
        loadedMode: 'majority',
        loadedBps: 3000,
        draftMode: 'majority',
        draftBps: 4000,
      }),
    ).toEqual([]);
  });
});
