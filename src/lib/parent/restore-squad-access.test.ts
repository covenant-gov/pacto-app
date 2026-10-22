import { describe, expect, it } from 'vitest';
import {
  planSquadMemberRestore,
  squadOwningGroupId,
  type GroupMembershipSnapshot,
} from './restore-squad-access';
import type { Channel, Squad } from '../../stores/squads';

function channel(partial: Partial<Channel> & Pick<Channel, 'name' | 'groupId'>): Channel {
  return { order: 0, ...partial };
}

const channels: Channel[] = [
  channel({ name: 'announcements', groupId: 'g-ann', order: 0 }),
  channel({ name: 'polls', groupId: 'g-ann', order: 1 }),
  channel({ name: 'ops', groupId: 'g-ops', order: 2, access: 'open' }),
  channel({ name: 'secret', groupId: 'g-sec', order: 3, access: 'closed' }),
  channel({ name: 'settings', groupId: '__settings', order: 4 }),
];

function membership(members: string[], admins: string[]): GroupMembershipSnapshot {
  return { members, admins };
}

describe('squadOwningGroupId', () => {
  const squad: Squad = {
    id: 'g-ann',
    name: 'Alpha',
    channels,
    kind: 'squad',
    createdAt: 1,
    updatedAt: 1,
  };

  it('matches the squad id and a channel group id', () => {
    expect(squadOwningGroupId([squad], 'g-ann')?.id).toBe('g-ann');
    expect(squadOwningGroupId([squad], 'g-sec')?.name).toBe('Alpha');
  });

  it('returns undefined for a bare MLS group', () => {
    expect(squadOwningGroupId([squad], 'g-other')).toBeUndefined();
    expect(squadOwningGroupId([squad], '  ')).toBeUndefined();
  });
});

describe('planSquadMemberRestore', () => {
  const base = {
    channels,
    announcementsGroupId: 'g-ann',
    memberNpub: 'npub1bob',
    selfNpub: 'npub1admin',
  };

  it('restores channels the member still belongs to when this device is admin', () => {
    const plan = planSquadMemberRestore({
      ...base,
      membershipByGroupId: new Map([
        ['g-ops', membership(['npub1bob', 'npub1admin'], ['npub1admin'])],
        ['g-sec', membership(['npub1bob'], ['npub1admin'])],
      ]),
    });
    expect(plan.restoreGroupIds).toEqual(['g-ops', 'g-sec']);
    expect(plan.admitOpen).toEqual([]);
  });

  it('admits missing open channels and skips closed channels and groups this device is not in', () => {
    const plan = planSquadMemberRestore({
      ...base,
      membershipByGroupId: new Map<string, GroupMembershipSnapshot | null>([
        ['g-ops', membership(['npub1admin'], ['npub1admin'])],
        ['g-sec', null],
      ]),
    });
    expect(plan.restoreGroupIds).toEqual([]);
    expect(plan.admitOpen).toEqual([{ groupId: 'g-ops', name: 'ops' }]);
  });

  it('skips an existing leaf when this device is not an admin of that channel', () => {
    const plan = planSquadMemberRestore({
      ...base,
      membershipByGroupId: new Map([
        ['g-sec', membership(['npub1bob', 'npub1admin'], ['npub1other'])],
        ['g-ops', membership(['npub1bob'], [])],
      ]),
    });
    expect(plan.restoreGroupIds).toEqual([]);
    expect(plan.admitOpen).toEqual([]);
  });
});
