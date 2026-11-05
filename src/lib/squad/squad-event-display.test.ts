import { describe, expect, it, vi } from 'vitest';
import type { NostrProfile } from '../api/nostr';
import type { SquadEventRsvpDto } from '../api/squad-events';
import {
  eventZoneDiffers,
  formatEventEnd,
  formatEventStart,
  formatEventZoneStart,
  latestRsvps,
  memberDisplayLabel,
  rsvpCounts,
  rsvpMembersByStatus,
} from './squad-event-display';

vi.mock('@tauri-apps/api/core');

const ALICE = 'npub1alicefixture00000000000000000000000000000000000000000000000';
const BOB = 'npub1bobfixture000000000000000000000000000000000000000000000000';
const CARA = 'npub1carafixture00000000000000000000000000000000000000000000000';

function rsvp(memberNpub: string, status: SquadEventRsvpDto['status'], updatedAtMs: number): SquadEventRsvpDto {
  return { memberNpub, status, updatedAtMs };
}

function profile(id: string, overrides: Partial<NostrProfile>): NostrProfile {
  return { id, name: '', display_name: '', nickname: '', ...overrides } as NostrProfile;
}

describe('rsvp counts', () => {
  it('three members accepted, tentative, declined count 1/1/1', () => {
    const counts = rsvpCounts([rsvp(ALICE, 'accepted', 1), rsvp(BOB, 'tentative', 2), rsvp(CARA, 'declined', 3)]);
    expect(counts).toEqual({ accepted: 1, tentative: 1, declined: 1 });
  });

  it('a later declined replaces accepted for that member only', () => {
    const rows = [rsvp(ALICE, 'accepted', 10), rsvp(BOB, 'accepted', 11), rsvp(ALICE, 'declined', 20)];
    expect(rsvpCounts(rows)).toEqual({ accepted: 1, tentative: 0, declined: 1 });
    expect(rsvpMembersByStatus(rows)).toEqual({ accepted: [BOB], tentative: [], declined: [ALICE] });
  });

  it('an older answer does not replace a newer one', () => {
    const latest = latestRsvps([rsvp(ALICE, 'declined', 20), rsvp(ALICE, 'accepted', 10)]);
    expect(latest).toEqual([rsvp(ALICE, 'declined', 20)]);
  });

  it('the author create accepted row counts as going', () => {
    expect(rsvpCounts([rsvp(ALICE, 'accepted', 5)])).toEqual({ accepted: 1, tentative: 0, declined: 0 });
  });
});

describe('memberDisplayLabel', () => {
  it('renders a named member by display name, preferring the local nickname', () => {
    expect(memberDisplayLabel(ALICE, profile(ALICE, { name: 'Alice' }), BOB, 'You')).toBe('Alice');
    expect(memberDisplayLabel(ALICE, profile(ALICE, { name: 'Alice', nickname: 'Ali' }), BOB, 'You')).toBe('Ali');
  });

  it('labels the viewer as You', () => {
    expect(memberDisplayLabel(ALICE, profile(ALICE, { name: 'Alice' }), ALICE, 'You')).toBe('You');
  });

  it('keeps unnamed members distinguishable with the short npub', () => {
    const bob = memberDisplayLabel(BOB, profile(BOB, {}), ALICE, 'You');
    const cara = memberDisplayLabel(CARA, undefined, ALICE, 'You');
    expect(bob).toBe(BOB.slice(0, 16));
    expect(cara).toBe(CARA.slice(0, 16));
    expect(bob).not.toBe(cara);
  });
});

describe('event time', () => {
  const allDay = { startUnix: null, startDate: '2026-03-08', startTzid: 'America/New_York' };

  it('renders an all-day 2026-03-08 as March 8 in any viewer zone', () => {
    for (const viewerZone of ['America/Los_Angeles', 'America/New_York', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      const text = formatEventStart(allDay, { locale: 'en-US', viewerZone });
      expect(text).toContain('March 8');
      expect(text).toContain('2026');
    }
  });

  it('renders timed starts in the viewer zone', () => {
    // 2026-03-08T23:30:00Z
    const timed = { startUnix: 1773012600, startDate: null, startTzid: 'America/New_York' };
    expect(formatEventStart(timed, { locale: 'en-US', viewerZone: 'America/Los_Angeles' })).toContain('March 8');
    expect(formatEventStart(timed, { locale: 'en-US', viewerZone: 'Asia/Tokyo' })).toContain('March 9');
  });

  it('shows the event zone only when it differs from the viewer zone', () => {
    const timed = { startUnix: 1773012600, startDate: null, startTzid: 'America/New_York' };
    expect(eventZoneDiffers('America/New_York', 'America/New_York')).toBe(false);
    expect(eventZoneDiffers('America/New_York', 'America/Los_Angeles')).toBe(true);
    expect(formatEventZoneStart(timed, { locale: 'en-US', viewerZone: 'America/New_York' })).toBeNull();
    expect(formatEventZoneStart(timed, { locale: 'en-US', viewerZone: 'America/Los_Angeles' })).toContain('7:30');
    expect(formatEventZoneStart(allDay, { locale: 'en-US', viewerZone: 'America/Los_Angeles' })).toBeNull();
  });

  it('shows the last day of a multi-day all-day event (end exclusive)', () => {
    const range = { ...allDay, endUnix: null, endDate: '2026-03-10' };
    expect(formatEventEnd(range, { locale: 'en-US', viewerZone: 'America/Los_Angeles' })).toContain('March 9');
    expect(formatEventEnd({ ...range, endDate: '2026-03-09' }, { locale: 'en-US' })).toBeNull();
  });

  it('shows only the time for a same-day timed end', () => {
    const range = { startUnix: 1772976600, endUnix: 1772980200, startDate: null, endDate: null, startTzid: 'UTC' };
    const end = formatEventEnd(range, { locale: 'en-US', viewerZone: 'UTC' });
    expect(end).toBe('2:30 PM');
  });
});
