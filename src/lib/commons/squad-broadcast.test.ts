import { describe, expect, it } from 'vitest';
import { formatBroadcastCooldownRemaining } from './squad-broadcast';

describe('formatBroadcastCooldownRemaining', () => {
  it('formats hours and minutes', () => {
    expect(formatBroadcastCooldownRemaining(1000, 0)).toBe('16m');
    expect(formatBroadcastCooldownRemaining(7200, 0)).toBe('2h 0m');
  });

  it('returns empty when expired', () => {
    expect(formatBroadcastCooldownRemaining(100, 200)).toBe('');
  });
});
