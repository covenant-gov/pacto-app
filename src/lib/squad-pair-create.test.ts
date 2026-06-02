import { describe, expect, it, vi } from 'vitest';
import {
  buildPairedSquads,
  collectInviteNpubsForSquads,
  pairPartnerExcludeSquadIds,
  resolvePairAnchorFromHub,
  partnerSquadCandidates,
} from './squad-pair-create';
import type { Squad } from '../stores/squads';

const anchor: Squad = {
  id: 'anchor',
  name: 'Squad A',
  channels: [{ name: 'announcements', groupId: 'g-a', order: 0 }],
  kind: 'squad',
  createdAt: 1,
  updatedAt: 1,
};

const partner: Squad = {
  id: 'partner',
  name: 'Squad B',
  channels: [{ name: 'announcements', groupId: 'g-b', order: 0 }],
  kind: 'squad',
  createdAt: 2,
  updatedAt: 2,
};

const existingPair: Squad = {
  id: 'pair',
  name: 'Pair',
  channels: [{ name: 'announcements', groupId: 'g-p', order: 0 }],
  kind: 'squad-pair',
  pairedSquads: [
    { id: 'anchor', name: 'Squad A' },
    { id: 'partner', name: 'Squad B' },
  ],
  createdAt: 3,
  updatedAt: 3,
};

describe('resolvePairAnchorFromHub', () => {
  it('returns the hub when it is a regular squad', () => {
    expect(resolvePairAnchorFromHub(anchor, [anchor, partner])).toEqual(anchor);
  });

  it('returns the first anchor squad when the hub is a squad-pair', () => {
    expect(resolvePairAnchorFromHub(existingPair, [anchor, partner, existingPair])).toEqual(anchor);
  });
});

describe('pairPartnerExcludeSquadIds', () => {
  it('excludes sibling anchors when pairing from a squad-pair hub', () => {
    expect(pairPartnerExcludeSquadIds(existingPair, anchor)).toEqual(['partner']);
  });

  it('returns empty when pairing from a regular squad', () => {
    expect(pairPartnerExcludeSquadIds(anchor, anchor)).toEqual([]);
  });
});

describe('partnerSquadCandidates', () => {
  it('excludes anchor, squad-pairs, and squads without channels', () => {
    const empty: Squad = {
      ...partner,
      id: 'empty',
      name: 'Empty',
      channels: [],
    };
    const list = partnerSquadCandidates([anchor, partner, existingPair, empty], anchor.id);
    expect(list.map((s) => s.id)).toEqual(['partner']);
  });
});

describe('buildPairedSquads', () => {
  it('returns anchor and partner refs', () => {
    expect(buildPairedSquads(anchor, partner)).toEqual([
      { id: 'anchor', name: 'Squad A' },
      { id: 'partner', name: 'Squad B' },
    ]);
  });
});

describe('collectInviteNpubsForSquads', () => {
  it('unions members from both squads and excludes self', async () => {
    const fetchMembers = vi.fn(async (gid: string) => {
      if (gid === 'g-a') return { members: ['me', 'alice'] };
      if (gid === 'g-b') return { members: ['me', 'bob', 'alice'] };
      return { members: [] };
    });
    const npubs = await collectInviteNpubsForSquads([anchor, partner], 'me', fetchMembers);
    expect(npubs.sort()).toEqual(['alice', 'bob']);
  });
});
