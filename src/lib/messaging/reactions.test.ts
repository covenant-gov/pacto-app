import { describe, it, expect, beforeEach } from 'vitest';
import {
  aggregateReactions,
  pendingReactionSent,
  isPendingReaction,
  clearPendingReactions,
} from './reactions';
import type { Reaction } from '../../stores/dm';

const ME = 'npub1me';
const ALICE = 'npub1alice';
const BOB = 'npub1bob';

describe('aggregateReactions', () => {
  it('returns an empty array when no reactions are provided', () => {
    expect(aggregateReactions([], ME)).toEqual([]);
  });

  it('counts a single reaction and flags when from the current user', () => {
    const reactions: Reaction[] = [{ id: 'r1', reference_id: 'm1', author_id: ME, emoji: '👍' }];
    expect(aggregateReactions(reactions, ME)).toEqual([
      { emoji: '👍', count: 1, includesMe: true, reactorIds: [ME] },
    ]);
  });

  it('aggregates multiple reactions by emoji and sort by count descending', () => {
    const reactions: Reaction[] = [
      { id: 'r1', reference_id: 'm1', author_id: ALICE, emoji: '👍' },
      { id: 'r2', reference_id: 'm1', author_id: BOB, emoji: '👍' },
      { id: 'r3', reference_id: 'm1', author_id: ALICE, emoji: '❤️' },
    ];
    expect(aggregateReactions(reactions, ME)).toEqual([
      { emoji: '👍', count: 2, includesMe: false, reactorIds: [ALICE, BOB] },
      { emoji: '❤️', count: 1, includesMe: false, reactorIds: [ALICE] },
    ]);
  });

  it('marks includesMe when the current user sent one of the reactions', () => {
    const reactions: Reaction[] = [
      { id: 'r1', reference_id: 'm1', author_id: ALICE, emoji: '👍' },
      { id: 'r2', reference_id: 'm1', author_id: ME, emoji: '👍' },
      { id: 'r3', reference_id: 'm1', author_id: BOB, emoji: '👍' },
    ];
    expect(aggregateReactions(reactions, ME)).toEqual([
      { emoji: '👍', count: 3, includesMe: true, reactorIds: [ALICE, ME, BOB] },
    ]);
  });

  it('sorts by emoji ascending when counts are equal', () => {
    const reactions: Reaction[] = [
      { id: 'r1', reference_id: 'm1', author_id: ALICE, emoji: '😂' },
      { id: 'r2', reference_id: 'm1', author_id: BOB, emoji: '👍' },
    ];
    expect(aggregateReactions(reactions, ME)).toEqual([
      { emoji: '👍', count: 1, includesMe: false, reactorIds: [BOB] },
      { emoji: '😂', count: 1, includesMe: false, reactorIds: [ALICE] },
    ]);
  });

  it('counts duplicate emojis from the same author separately but dedupes the reactor list', () => {
    const reactions: Reaction[] = [
      { id: 'r1', reference_id: 'm1', author_id: ALICE, emoji: '👍' },
      { id: 'r2', reference_id: 'm1', author_id: ALICE, emoji: '👍' },
    ];
    expect(aggregateReactions(reactions, ME)).toEqual([
      { emoji: '👍', count: 2, includesMe: false, reactorIds: [ALICE] },
    ]);
  });

  it('collects every distinct reactor npub for an emoji in reactorIds', () => {
    const reactions: Reaction[] = [
      { id: 'r1', reference_id: 'm1', author_id: ALICE, emoji: '🔥' },
      { id: 'r2', reference_id: 'm1', author_id: BOB, emoji: '🔥' },
      { id: 'r3', reference_id: 'm1', author_id: ME, emoji: '🔥' },
    ];
    const [aggregatedFire] = aggregateReactions(reactions, ME);
    expect(aggregatedFire.reactorIds).toEqual([ALICE, BOB, ME]);
    expect(aggregatedFire.count).toBe(3);
  });

  it('orders reactorIds by first appearance in the input array, independent of emoji sort order', () => {
    const reactions: Reaction[] = [
      { id: 'r1', reference_id: 'm1', author_id: BOB, emoji: '❤️' },
      { id: 'r2', reference_id: 'm1', author_id: ALICE, emoji: '❤️' },
      { id: 'r3', reference_id: 'm1', author_id: ME, emoji: '❤️' },
    ];
    const [aggregatedHeart] = aggregateReactions(reactions, ME);
    expect(aggregatedHeart.reactorIds).toEqual([BOB, ALICE, ME]);
  });

  it('keeps reactorIds isolated per emoji when the same author reacts with different emoji', () => {
    const reactions: Reaction[] = [
      { id: 'r1', reference_id: 'm1', author_id: ALICE, emoji: '👍' },
      { id: 'r2', reference_id: 'm1', author_id: ALICE, emoji: '👎' },
    ];
    expect(aggregateReactions(reactions, ME)).toEqual([
      { emoji: '👍', count: 1, includesMe: false, reactorIds: [ALICE] },
      { emoji: '👎', count: 1, includesMe: false, reactorIds: [ALICE] },
    ]);
  });
});

describe('pendingReactionSent', () => {
  beforeEach(() => {
    clearPendingReactions();
  });

  it('tracks a sent reaction by message and emoji', () => {
    pendingReactionSent('m1', '👍');
    expect(isPendingReaction('m1', '👍')).toBe(true);
    expect(isPendingReaction('m1', '❤️')).toBe(false);
  });

  it('keeps pending reactions isolated per message', () => {
    pendingReactionSent('m1', '👍');
    pendingReactionSent('m2', '❤️');
    expect(isPendingReaction('m1', '❤️')).toBe(false);
    expect(isPendingReaction('m2', '👍')).toBe(false);
  });

  it('clears all reactions when called without a message id', () => {
    pendingReactionSent('m1', '👍');
    pendingReactionSent('m2', '❤️');
    clearPendingReactions();
    expect(isPendingReaction('m1', '👍')).toBe(false);
    expect(isPendingReaction('m2', '❤️')).toBe(false);
  });

  it('clears reactions for a single message when a message id is provided', () => {
    pendingReactionSent('m1', '👍');
    pendingReactionSent('m2', '❤️');
    clearPendingReactions('m1');
    expect(isPendingReaction('m1', '👍')).toBe(false);
    expect(isPendingReaction('m2', '❤️')).toBe(true);
  });
});
