import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { currentUser } from './auth-session';
import { setCurrentNpubForPersistence } from './persistence-context';
import {
  LAST_SEEN_EVENT_CARD_AT_PREFIX,
  countUnseenEventCards,
  eventCardKey,
  lastSeenEventCardAtMsByParentId,
  loadLastSeenEventCardAt,
  markEventsChannelSeen,
  refreshUnseenEventCardsForParent,
  resetEventsHubAlertStores,
  unseenEventCardCountByParentId,
  type EventCardMessageLike,
} from './events-hub-alerts';

const ME = 'npub1me';
const OTHER = 'npub1other';
const PARENT = 'parent-1';

function eventCard(id: string, at: number, npub = OTHER, seriesId: string | null = null): EventCardMessageLike {
  return {
    at,
    npub,
    content: JSON.stringify({
      type: 'squad_event_created',
      payload: { id, parent_id: PARENT, series_id: seriesId, kind: 31923, title: 't', start: 1, end: null },
    }),
  };
}

function seriesCard(seriesId: string, at: number, npub = OTHER): EventCardMessageLike {
  return {
    at,
    npub,
    content: JSON.stringify({
      type: 'squad_event_series_created',
      payload: { series_id: seriesId, parent_id: PARENT, kind: 31923, title: 't', first_start: 1, count: 8 },
    }),
  };
}

describe('eventCardKey', () => {
  it('keys event and series cards and ignores everything else', () => {
    expect(eventCardKey(eventCard('e1', 1).content)).toBe('event:e1');
    expect(eventCardKey(seriesCard('s1', 1).content)).toBe('series:s1');
    expect(eventCardKey('hello')).toBeNull();
    expect(eventCardKey(JSON.stringify({ type: 'dashboard_poll_created', payload: { id: 'p' } }))).toBeNull();
    expect(eventCardKey(JSON.stringify({ schema: 'pacto.squad_event.v1', op: 'rsvp', id: 'e1' }))).toBeNull();
  });
});

describe('countUnseenEventCards', () => {
  it('counts a weekly series card once', () => {
    const msgs = [seriesCard('s1', 10), seriesCard('s1', 11)];
    expect(countUnseenEventCards(msgs, 0, ME)).toBe(1);
  });

  it('skips cards authored by the current npub or marked mine', () => {
    const msgs = [eventCard('e1', 10, ME), { ...eventCard('e2', 10, OTHER), mine: true }, eventCard('e3', 10)];
    expect(countUnseenEventCards(msgs, 0, ME)).toBe(1);
  });

  it('ignores non-card messages and cards at or before the watermark', () => {
    const msgs: EventCardMessageLike[] = [
      { at: 20, npub: OTHER, content: 'plain chat' },
      { at: 20, npub: OTHER, content: JSON.stringify({ type: 'governance_updated', payload: {} }) },
      eventCard('old', 5),
      eventCard('new', 20),
    ];
    expect(countUnseenEventCards(msgs, 5, ME)).toBe(1);
  });
});

describe('events hub alert stores', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
    });
    resetEventsHubAlertStores();
    currentUser.set({ npub: ME, pubkey: 'pk' });
    setCurrentNpubForPersistence(ME);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    currentUser.set(null);
    setCurrentNpubForPersistence(null);
    resetEventsHubAlertStores();
  });

  it('first sight sets a baseline so only later cards badge', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    refreshUnseenEventCardsForParent(PARENT, [eventCard('before', 500), seriesCard('s1', 2_000)]);
    expect(get(unseenEventCardCountByParentId)[PARENT]).toBe(1);
    expect(get(lastSeenEventCardAtMsByParentId)[PARENT]).toBe(1_000);
  });

  it('marking seen clears the badge and persists the newest card time', () => {
    lastSeenEventCardAtMsByParentId.set({ [PARENT]: 0 });
    refreshUnseenEventCardsForParent(PARENT, [eventCard('e1', 400)]);
    expect(get(unseenEventCardCountByParentId)[PARENT]).toBe(1);
    markEventsChannelSeen(PARENT, [eventCard('e1', 400), { at: 900, npub: OTHER, content: 'chat' }]);
    expect(get(unseenEventCardCountByParentId)[PARENT]).toBe(0);
    expect(get(lastSeenEventCardAtMsByParentId)[PARENT]).toBe(400);
    expect(JSON.parse(storage.get(`${LAST_SEEN_EVENT_CARD_AT_PREFIX}_${ME}`) ?? '{}')).toEqual({ [PARENT]: 400 });
  });

  it('restores persisted watermarks', () => {
    storage.set(`${LAST_SEEN_EVENT_CARD_AT_PREFIX}_${ME}`, JSON.stringify({ [PARENT]: 999, bad: 'x' }));
    loadLastSeenEventCardAt(ME);
    expect(get(lastSeenEventCardAtMsByParentId)).toEqual({ [PARENT]: 999 });
  });
});
