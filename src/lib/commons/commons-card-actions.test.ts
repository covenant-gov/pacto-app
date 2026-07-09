import { describe, expect, it, vi, beforeEach } from 'vitest';
import { sendCommonsJoinRequest } from './commons-card-actions';
import type { CommonsBroadcastDto } from './types';

vi.mock('../api/nostr', () => ({
  sendDmMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../stores/profiles', () => ({
  loadProfile: vi.fn(),
}));

import { sendDmMessage } from '../api/nostr';

describe('sendCommonsJoinRequest', () => {
  beforeEach(() => {
    vi.mocked(sendDmMessage).mockClear();
  });

  it('sends structured bot join DM to broadcast author', async () => {
    const broadcast: CommonsBroadcastDto = {
      eventId: 'evt1',
      authorNpub: 'npub1botxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      subject: 'squad',
      subjectId: 'squad-mls-id',
      message: 'hello',
      durationHours: 72,
      expiresAt: 9999999999,
      tags: ['a', 'b', 'c'],
      createdAt: 1,
      squadId: 'squad-mls-id',
      squadName: 'Pirates',
    };
    const result = await sendCommonsJoinRequest(broadcast, 'npub1me', []);
    expect(result).toEqual({ ok: true });
    expect(sendDmMessage).toHaveBeenCalledWith(
      broadcast.authorNpub,
      expect.stringContaining('pacto.squad.bot_join_dm.v1')
    );
  });
});
