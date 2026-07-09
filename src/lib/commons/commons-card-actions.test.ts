import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { openCommonsSquadJoinDm } from './commons-card-actions';
import { newChatDraftMessage, newChatDraftNpub } from '../../stores/dm';
import type { CommonsBroadcastDto } from './types';

vi.mock('../../stores/profiles', () => ({
  loadProfile: vi.fn(),
}));

describe('openCommonsSquadJoinDm', () => {
  beforeEach(() => {
    newChatDraftNpub.set(null);
    newChatDraftMessage.set('');
  });

  it('targets broadcast authorNpub (bot) with a join draft', () => {
    const broadcast: CommonsBroadcastDto = {
      eventId: 'evt1',
      authorNpub: 'npub1botxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      subject: 'squad',
      subjectId: 'squad-mls-id',
      message: 'hello',
      durationHours: 72,
      expiresAt: 9999999999,
      tags: ['a', 'b', 'c'],
      createdAt: 1,
      squadId: 'squad-mls-id',
      squadName: 'Pirates',
    };
    openCommonsSquadJoinDm(broadcast);
    expect(get(newChatDraftNpub)).toBe(broadcast.authorNpub);
    expect(get(newChatDraftMessage)).toMatch(/join Pirates/i);
    expect(get(newChatDraftMessage)).toMatch(/evt1/);
  });
});
