import { describe, expect, it } from 'vitest';
import { commonsAudienceForFirstBroadcast } from './user-broadcast';

describe('commonsAudienceForFirstBroadcast', () => {
  it('treats the first broadcast ever as a new user', () => {
    expect(commonsAudienceForFirstBroadcast(true)).toBe('new_user');
  });

  it('treats any later broadcast as an active user', () => {
    expect(commonsAudienceForFirstBroadcast(false)).toBe('active_user');
  });
});
