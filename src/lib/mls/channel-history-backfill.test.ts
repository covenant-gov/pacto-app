import { describe, expect, it } from 'vitest';
import {
  HISTORY_REQUEST_MAX_AGE_MS,
  HISTORY_SERVE_COOLDOWN_MS,
  claimHistoryServeSlot,
  clearHistoryBackfillSession,
  designatedCandidates,
  designatedForAttempt,
  giftMatchesAttempt,
  historyBackfillRequest,
  historyRequestForSelf,
  isHistoryGiftWrapContent,
  isHistoryRequestContent,
  isStaleHistoryRequest,
} from './channel-history-backfill';

const REQUEST_ID = 'a'.repeat(32);
const GROUP = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';

describe('historyBackfillRequest', () => {
  it('asks announcements for that bucket and skips the other hub shelves', () => {
    expect(historyBackfillRequest('announcements')).toEqual({ bucket: 'announcements' });
    expect(historyBackfillRequest('Polls')).toBeNull();
    expect(historyBackfillRequest('join-requests')).toBeNull();
    expect(historyBackfillRequest('personal-alerts')).toBeNull();
    expect(historyBackfillRequest('ops')).toEqual({ bucket: null });
  });
});

describe('designatedCandidates', () => {
  it('sorts the roster and drops this device', () => {
    expect(designatedCandidates(['npub1c', 'npub1a', 'npub1b', 'npub1a'], 'npub1b')).toEqual([
      'npub1a',
      'npub1c',
    ]);
    expect(designatedForAttempt(['npub1a', 'npub1c'], 2)).toBe('npub1c');
    expect(designatedForAttempt(['npub1a'], 2)).toBeNull();
  });
});

describe('history protocol hide', () => {
  it('recognizes a request and a gift wrap before the payload is fully valid', () => {
    expect(isHistoryRequestContent(JSON.stringify({ type: 'history_request' }))).toBe(true);
    expect(isHistoryGiftWrapContent(JSON.stringify({ type: 'history_chunk', messages: [] }))).toBe(true);
    expect(isHistoryGiftWrapContent(JSON.stringify({ type: 'history_unavailable' }))).toBe(true);
    expect(isHistoryGiftWrapContent('hello')).toBe(false);
  });

  it('serves only the designated member', () => {
    const request = {
      type: 'history_request',
      version: 1,
      requestId: REQUEST_ID,
      groupId: GROUP,
      bucket: null,
      attempt: 1,
      designatedNpub: 'npub1a',
    };
    expect(historyRequestForSelf(JSON.stringify(request), 'npub1a')?.attempt).toBe(1);
    expect(historyRequestForSelf(JSON.stringify(request), 'npub1b')).toBeNull();
  });

  it('accepts a chunk or an empty reply only from the member this attempt asked', () => {
    const expected = {
      requestId: REQUEST_ID,
      groupId: GROUP,
      bucket: null,
      designatedNpub: 'npub1a',
    };
    const chunk = {
      type: 'history_chunk',
      version: 1,
      requestId: REQUEST_ID,
      groupId: GROUP,
      bucket: null,
      index: 0,
      total: 1,
      messages: [
        {
          id: 'm1',
          kind: 14,
          createdAt: 1,
          authorNpub: 'npub1a',
          content: 'hi',
          tags: [],
          referenceId: null,
        },
      ],
    };
    const unavailable = {
      type: 'history_unavailable',
      version: 1,
      requestId: REQUEST_ID,
      groupId: GROUP,
      bucket: null,
      reason: 'empty',
    };
    expect(giftMatchesAttempt(JSON.stringify(chunk), expected, 'npub1a')).toBe('chunk');
    expect(giftMatchesAttempt(JSON.stringify(unavailable), expected, 'npub1a')).toBe('unavailable');
    expect(giftMatchesAttempt(JSON.stringify(chunk), expected, 'npub1c')).toBeNull();
  });
});

describe('isStaleHistoryRequest', () => {
  it('rejects old, missing, and non-positive send times', () => {
    const now = 1_700_000_000_000;
    expect(isStaleHistoryRequest(now - 1000, now)).toBe(false);
    expect(isStaleHistoryRequest(now - HISTORY_REQUEST_MAX_AGE_MS - 1, now)).toBe(true);
    expect(isStaleHistoryRequest(undefined, now)).toBe(true);
    expect(isStaleHistoryRequest(0, now)).toBe(true);
    expect(isStaleHistoryRequest(Number.NaN, now)).toBe(true);
  });
});

describe('claimHistoryServeSlot', () => {
  it('allows one claim per requester and group inside the cooldown', () => {
    clearHistoryBackfillSession();
    const now = 1_700_000_000_000;
    expect(claimHistoryServeSlot('npub1a', GROUP, now)).toBe(true);
    expect(claimHistoryServeSlot('npub1a', GROUP.toUpperCase(), now + 1)).toBe(false);
    expect(claimHistoryServeSlot('npub1b', GROUP, now + 1)).toBe(true);
    expect(claimHistoryServeSlot('npub1a', 'other', now + 1)).toBe(true);
    expect(claimHistoryServeSlot('npub1a', GROUP, now + HISTORY_SERVE_COOLDOWN_MS)).toBe(true);
  });
});
