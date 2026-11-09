import { describe, expect, it } from 'vitest';
import { withPendingToolsFocusModes } from './tools-visited-modes';

describe('withPendingToolsFocusModes', () => {
  it('keeps the active mode and seeds pending events for another squad deep link', () => {
    const seeded = withPendingToolsFocusModes(['docs'], 'docs', { seedEvents: true });
    expect([...seeded].sort()).toEqual(['docs', 'events']);
  });

  it('seeds docs when a docs focus is pending while on polls', () => {
    const seeded = withPendingToolsFocusModes(['polls'], 'polls', { seedDocs: true });
    expect([...seeded].sort()).toEqual(['docs', 'polls']);
  });

  it('is a no-op beyond adding the active mode when nothing is pending', () => {
    expect([...withPendingToolsFocusModes([], 'events')]).toEqual(['events']);
  });
});
