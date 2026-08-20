import { describe, expect, it } from 'vitest';
import { parseWarGameStackMeta } from './war-game-payload';

describe('parseWarGameStackMeta', () => {
  it('defaults to active with no round', () => {
    expect(parseWarGameStackMeta(null)).toEqual({ status: 'active', round: '' });
    expect(parseWarGameStackMeta('')).toEqual({ status: 'active', round: '' });
    expect(parseWarGameStackMeta('{')).toEqual({ status: 'active', round: '' });
  });

  it('reads active and retired status', () => {
    expect(parseWarGameStackMeta(JSON.stringify({ status: 'active', round: '3' }))).toEqual({
      status: 'active',
      round: '3',
    });
    expect(parseWarGameStackMeta(JSON.stringify({ status: 'retired', round: 4 }))).toEqual({
      status: 'retired',
      round: '4',
    });
  });
});
