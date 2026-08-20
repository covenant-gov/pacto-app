import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendDmMessage = vi.fn();
vi.mock('../api/nostr', () => ({
  sendDmMessage: (...args: unknown[]) => sendDmMessage(...args),
}));

import { squads } from '../../stores/squads';
import {
  ANNOUNCE_TYPE_WAR_GAME_UPDATED,
  buildAnnounceContent,
  isAnnouncementsGovernanceAnnounce,
  parseAnnouncement,
} from '../announcements';
import { deriveVirtualBucketFromMessageContent } from '../mls/virtual-channel-bucket';
import {
  announceWarGameUpdated,
  buildWarGameUpdatedPayload,
  warGameActionFromDeploy,
  warGameActionFromProviderPayload,
} from './war-game-announce';
import { pactoGovWargameInfraId } from './squad-infra-row-id';

const PARENT = 'parent-1';
const GAME_SQUAD_ID = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('war-game-announce', () => {
  beforeEach(() => {
    sendDmMessage.mockReset();
    sendDmMessage.mockResolvedValue(true);
    squads.set([]);
  });

  it('maps deploy vs redeploy from retiredSponsor', () => {
    expect(warGameActionFromDeploy({ retiredSponsor: null })).toBe('deploy');
    expect(warGameActionFromDeploy({ retiredSponsor: ' 0xabc ' })).toBe('redeploy');
  });

  it('maps action from stored provider payload', () => {
    expect(warGameActionFromProviderPayload(JSON.stringify({ status: 'active' }))).toBe('deploy');
    expect(
      warGameActionFromProviderPayload(
        JSON.stringify({ status: 'active', retiredSponsor: '0xabc' }),
      ),
    ).toBe('redeploy');
    expect(warGameActionFromProviderPayload(JSON.stringify({ status: 'retired' }))).toBe('retire');
  });

  it('posts war_game_updated to announcements with round and gameSquadId', () => {
    const payload = buildWarGameUpdatedPayload({
      parentId: PARENT,
      action: 'deploy',
      topHatId: '42',
      chain: 'sepolia',
      providerPayload: JSON.stringify({
        v: 1,
        status: 'active',
        gameSquadId: GAME_SQUAD_ID,
        round: '1',
        sponsor: '0x5555555555555555555555555555555555555555',
      }),
      round: '1',
      gameSquadId: GAME_SQUAD_ID,
      sponsor: '0x5555555555555555555555555555555555555555',
    });
    expect(payload.entry_id).toBe(pactoGovWargameInfraId(PARENT));
    const content = buildAnnounceContent({
      type: ANNOUNCE_TYPE_WAR_GAME_UPDATED,
      payload,
    });
    expect(JSON.parse(content).pacto_virtual_bucket).toBe('announcements');
    expect(deriveVirtualBucketFromMessageContent(content)).toBe('announcements');
    const parsed = parseAnnouncement(content);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(isAnnouncementsGovernanceAnnounce(parsed)).toBe(true);
    expect(parsed.type).toBe(ANNOUNCE_TYPE_WAR_GAME_UPDATED);
    if (parsed.type !== ANNOUNCE_TYPE_WAR_GAME_UPDATED) return;
    expect(parsed.payload.round).toBe('1');
    expect(parsed.payload.game_squad_id).toBe(GAME_SQUAD_ID);
  });

  it('sends announce when announcements group id is present', async () => {
    await announceWarGameUpdated({
      parentId: PARENT,
      announcementsGroupId: 'ann-gid',
      result: {
        txHash: '0xabc',
        chain: 'sepolia',
        chainId: 11155111,
        topHatId: '42',
        safeAddress: '0x2',
        quartermaster: '0x3',
        mutinyModule: '0x4',
        treasuryAuthority: '0x5',
        squadAdminProxy: '0x6',
        round: '1',
        gameSquadId: GAME_SQUAD_ID,
        sponsorAddress: '0x8',
        retiredSponsor: null,
        providerPayload: '{"status":"active"}',
        infraRowId: pactoGovWargameInfraId(PARENT),
      },
    });
    expect(sendDmMessage).toHaveBeenCalledWith(
      'ann-gid',
      expect.stringContaining(ANNOUNCE_TYPE_WAR_GAME_UPDATED),
      '',
      { virtualBucket: 'announcements' },
    );
  });

  it('skips announce when no announcements group id', async () => {
    await announceWarGameUpdated({
      parentId: PARENT,
      result: {
        txHash: '0xabc',
        chain: 'sepolia',
        chainId: 11155111,
        topHatId: '42',
        safeAddress: '0x2',
        quartermaster: '0x3',
        mutinyModule: '0x4',
        treasuryAuthority: '0x5',
        squadAdminProxy: '0x6',
        round: '1',
        gameSquadId: GAME_SQUAD_ID,
        sponsorAddress: '0x8',
        retiredSponsor: null,
        providerPayload: '{}',
        infraRowId: 'id',
      },
    });
    expect(sendDmMessage).not.toHaveBeenCalled();
  });
});
