import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setCurrentNpubForPersistence } from '../../stores/persistence-context';
import {
  commonsJoinRequestBlockReason,
  formatCommonsJoinRequestMessage,
  isJoinRequestRateLimited,
  parseCommonsJoinRequestMessage,
  recordJoinRequestSent,
} from './commons-join-request';
import type { CommonsBroadcastDto } from './types';

const squadBroadcast: CommonsBroadcastDto = {
  eventId: 'evt1',
  authorNpub: 'npub1author',
  subject: 'squad',
  subjectId: 'group-1',
  message: 'Join us',
  durationHours: 24,
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  tags: ['neo'],
  squadId: 'group-1',
  squadName: 'Neo Builders',
  createdAt: 1,
};

describe('parseCommonsJoinRequestMessage', () => {
  it('round-trips payload', () => {
    const payload = {
      type: 'commons_join_request' as const,
      squadId: 'group-1',
      squadName: 'Neo Builders',
      broadcastEventId: 'evt1',
      requesterNpub: 'npub1me',
    };
    const parsed = parseCommonsJoinRequestMessage(formatCommonsJoinRequestMessage(payload));
    expect(parsed).toEqual(payload);
  });
});

describe('commonsJoinRequestBlockReason', () => {
  it('blocks when already a member', () => {
    expect(commonsJoinRequestBlockReason(squadBroadcast, 'npub1me', ['group-1'])).toMatch(/already/i);
  });

  it('blocks own broadcast', () => {
    expect(commonsJoinRequestBlockReason(squadBroadcast, 'npub1author', [])).toMatch(/your squad/i);
  });
});

describe('join request rate limit', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => {
        store.clear();
      },
    });
    setCurrentNpubForPersistence('npub1test');
  });

  it('records and checks cooldown', () => {
    const now = 1_000_000;
    recordJoinRequestSent('group-1', now);
    expect(isJoinRequestRateLimited('group-1', now + 100)).toBe(true);
    expect(isJoinRequestRateLimited('group-1', now + 86401)).toBe(false);
  });
});
