import { describe, expect, it } from 'vitest';
import { withPendingBoardFocusModes } from './board-visited-modes';

describe('withPendingBoardFocusModes', () => {
  it('keeps the active mode and seeds pending events for another squad deep link', () => {
    const seeded = withPendingBoardFocusModes(['docs'], 'docs', { seedEvents: true });
    expect([...seeded].sort()).toEqual(['docs', 'events']);
  });

  it('seeds docs when a docs focus is pending while on polls', () => {
    const seeded = withPendingBoardFocusModes(['polls'], 'polls', { seedDocs: true });
    expect([...seeded].sort()).toEqual(['docs', 'polls']);
  });

  it('is a no-op beyond adding the active mode when nothing is pending', () => {
    expect([...withPendingBoardFocusModes([], 'events')]).toEqual(['events']);
  });
});
