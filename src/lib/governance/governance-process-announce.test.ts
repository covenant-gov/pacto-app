import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendDmMessage = vi.fn();
vi.mock('../api/nostr', () => ({
  sendDmMessage: (...args: unknown[]) => sendDmMessage(...args),
}));

import { squads } from '../../stores/squads';
import { ANNOUNCE_TYPE_GOVERNANCE_PROCESS_UPDATED } from '../announcements';
import {
  announceGovernanceProcessUpdated,
  buildGovernanceProcessUpdatedPayload,
} from './governance-process-announce';

describe('governance-process-announce', () => {
  beforeEach(() => {
    sendDmMessage.mockReset();
    sendDmMessage.mockResolvedValue(true);
    squads.set([]);
  });

  it('builds optional fields only when set', () => {
    expect(
      buildGovernanceProcessUpdatedPayload({
        parentId: ' p ',
        kind: 'qm_pending',
        address: ' 0x1 ',
        txHash: ' 0xabc ',
      }),
    ).toEqual({
      parent_id: 'p',
      kind: 'qm_pending',
      address: '0x1',
      tx_hash: '0xabc',
    });
    expect(buildGovernanceProcessUpdatedPayload({ parentId: 'p', kind: 'mutiny' })).toEqual({
      parent_id: 'p',
      kind: 'mutiny',
    });
    expect(buildGovernanceProcessUpdatedPayload({ parentId: 'p', kind: 'hats' })).toEqual({
      parent_id: 'p',
      kind: 'hats',
    });
  });

  it('skips send when the parent has no announcements group', async () => {
    await announceGovernanceProcessUpdated({ parentId: 'missing', kind: 'ta_proposal' });
    expect(sendDmMessage).not.toHaveBeenCalled();
  });

  it('posts a process hint to the announcements group', async () => {
    squads.set([
      {
        id: 'parent1',
        channels: [{ name: 'announcements', groupId: 'gid-1', order: 0 }],
      } as never,
    ]);
    await announceGovernanceProcessUpdated({
      parentId: 'parent1',
      kind: 'qm_pending',
      address: '0x1',
      txHash: '0xdead',
    });
    expect(sendDmMessage).toHaveBeenCalledWith(
      'gid-1',
      expect.stringContaining(ANNOUNCE_TYPE_GOVERNANCE_PROCESS_UPDATED),
      '',
      { virtualBucket: 'announcements' },
    );
  });
});
