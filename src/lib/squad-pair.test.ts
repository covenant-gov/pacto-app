import { describe, expect, it } from 'vitest';
import {
  normalizeStoredSquad,
  partnerSquadsForAnchor,
  partnerSquadsForHubParent,
} from './squad-pair';

const regularSquad = {
  id: 'squad-a',
  name: 'Squad A',
  channels: [{ name: 'announcements', groupId: 'g-a', order: 0 }],
  createdAt: 1,
  updatedAt: 1,
};

const squadPair = {
  id: 'pair-ab',
  name: 'A ↔ B',
  kind: 'squad-pair' as const,
  pairedSquads: [
    { id: 'squad-a', name: 'Squad A' },
    { id: 'squad-b', name: 'Squad B' },
  ] as const,
  channels: [{ name: 'announcements', groupId: 'g-pair', order: 0 }],
  createdAt: 2,
  updatedAt: 2,
};

describe('normalizeStoredSquad', () => {
  it('defaults missing kind to squad', () => {
    expect(normalizeStoredSquad(regularSquad).kind).toBe('squad');
    expect(normalizeStoredSquad(regularSquad).pairedSquads).toBeUndefined();
  });

  it('keeps squad-pair kind and normalizes pairedSquads to a pair', () => {
    const normalized = normalizeStoredSquad({
      ...squadPair,
      pairedSquads: [...squadPair.pairedSquads],
    });
    expect(normalized.kind).toBe('squad-pair');
    expect(normalized.pairedSquads).toEqual([
      { id: 'squad-a', name: 'Squad A' },
      { id: 'squad-b', name: 'Squad B' },
    ]);
  });

  it('drops invalid pairedSquads when fewer than two anchors', () => {
    const normalized = normalizeStoredSquad({
      ...squadPair,
      kind: 'squad-pair',
      pairedSquads: [{ id: 'squad-a', name: 'Squad A' }],
    });
    expect(normalized.pairedSquads).toBeUndefined();
  });

  it('defaults visibility to private and strips tags', () => {
    expect(normalizeStoredSquad(regularSquad).visibility).toBe('private');
    expect(normalizeStoredSquad(regularSquad).commonsTags).toBeUndefined();
    expect(
      normalizeStoredSquad({ ...regularSquad, visibility: 'private', commonsTags: ['neo'] }).commonsTags
    ).toBeUndefined();
  });

  it('keeps exactly three normalized tags when Commons is on', () => {
    const normalized = normalizeStoredSquad({
      ...regularSquad,
      visibility: 'public',
      commonsTags: ['#Neo', 'dao', 'art'],
    });
    expect(normalized.visibility).toBe('public');
    expect(normalized.commonsTags).toEqual(['neo', 'dao', 'art']);
  });

  it('drops incomplete or invalid tag defaults when Commons is on', () => {
    expect(
      normalizeStoredSquad({
        ...regularSquad,
        visibility: 'public',
        commonsTags: ['#Neo', 'dao'],
      }).commonsTags
    ).toBeUndefined();
    expect(
      normalizeStoredSquad({
        ...regularSquad,
        visibility: 'public',
        commonsTags: ['!!!'],
      }).commonsTags
    ).toBeUndefined();
  });
});

describe('partnerSquadsForAnchor', () => {
  it('returns squad-pairs that reference the anchor id', () => {
    const otherPair = {
      ...squadPair,
      id: 'pair-bc',
      name: 'B ↔ C',
      pairedSquads: [
        { id: 'squad-b', name: 'Squad B' },
        { id: 'squad-c', name: 'Squad C' },
      ] as const,
    };
    const list = partnerSquadsForAnchor(
      [regularSquad, { ...squadPair, pairedSquads: [...squadPair.pairedSquads] }, otherPair],
      'squad-a'
    );
    expect(list.map((s) => s.id)).toEqual(['pair-ab']);
  });

  it('returns empty when anchor has no partner squad-pairs', () => {
    expect(partnerSquadsForAnchor([regularSquad], 'squad-a')).toEqual([]);
  });
});

describe('partnerSquadsForHubParent', () => {
  it('matches partnerSquadsForAnchor on a regular squad', () => {
    const pair = {
      ...squadPair,
      pairedSquads: [...squadPair.pairedSquads],
    };
    expect(partnerSquadsForHubParent([regularSquad, pair], 'squad-a')).toEqual(
      partnerSquadsForAnchor([regularSquad, pair], 'squad-a')
    );
  });

  it('lists sibling pairs from both anchors when viewing a squad-pair', () => {
    const pairAb = {
      ...squadPair,
      id: 'pair-ab',
      pairedSquads: [
        { id: 'squad-a', name: 'Squad A' },
        { id: 'squad-b', name: 'Squad B' },
      ] as const,
    };
    const pairBc = {
      ...squadPair,
      id: 'pair-bc',
      name: 'B ↔ C',
      pairedSquads: [
        { id: 'squad-b', name: 'Squad B' },
        { id: 'squad-c', name: 'Squad C' },
      ] as const,
    };
    const pairAc = {
      ...squadPair,
      id: 'pair-ac',
      name: 'A ↔ C',
      pairedSquads: [
        { id: 'squad-a', name: 'Squad A' },
        { id: 'squad-c', name: 'Squad C' },
      ] as const,
    };
    const squads = [regularSquad, pairAb, pairBc, pairAc];
    const listed = partnerSquadsForHubParent(squads, 'pair-ab').map((s) => s.id);
    expect(listed).toEqual(['pair-ac', 'pair-bc']);
  });

  it('excludes the active squad-pair from its own partner list', () => {
    const pair = { ...squadPair, pairedSquads: [...squadPair.pairedSquads] };
    expect(partnerSquadsForHubParent([regularSquad, pair], pair.id)).toEqual([]);
  });
});
