import { describe, expect, it } from 'vitest';
import { resolveHubSponsorRow, warGameArchiveCapabilities } from './hub-sponsor';
import type { SquadInfraDto } from './api';

const LIVE = '0x1111111111111111111111111111111111111111';
const ROUND = '0x2222222222222222222222222222222222222222';

function row(overrides: Partial<SquadInfraDto> = {}): SquadInfraDto {
  return {
    id: 'id-1',
    parentId: 'parent-1',
    infraType: 'sponsor',
    chain: 'sepolia',
    canonicalRef: LIVE,
    createdAtMs: 1,
    updatedAtMs: 2,
    ...overrides,
  };
}

describe('resolveHubSponsorRow', () => {
  const live = row();
  const wargame = row({
    id: 'pgw-1',
    infraType: 'pacto_gov_wargame',
    canonicalRef: '3655',
    providerPayload: JSON.stringify({ sponsor: ROUND, status: 'active', round: '4' }),
  });

  it('uses the live sponsor row off the wargame hub', () => {
    expect(resolveHubSponsorRow({ warGameStack: false, rows: [live, wargame] })?.canonicalRef).toBe(
      LIVE,
    );
    expect(resolveHubSponsorRow({ warGameStack: false, rows: [wargame] })).toBeNull();
  });

  it('uses the round clone on the wargame hub even when a live sponsor row exists', () => {
    const resolved = resolveHubSponsorRow({ warGameStack: true, rows: [live, wargame] });
    expect(resolved?.canonicalRef).toBe(ROUND);
    expect(resolved?.infraType).toBe('pacto_gov_wargame');
  });

  it('returns null on the wargame hub without a round sponsor', () => {
    expect(resolveHubSponsorRow({ warGameStack: true, rows: [live] })).toBeNull();
    expect(
      resolveHubSponsorRow({
        warGameStack: true,
        rows: [row({ infraType: 'pacto_gov_wargame', providerPayload: '{}' })],
      }),
    ).toBeNull();
  });

  it('returns null in archive view even when a round clone exists', () => {
    expect(
      resolveHubSponsorRow({ warGameStack: true, rows: [live, wargame], archiveView: true }),
    ).toBeNull();
  });
});

describe('warGameArchiveCapabilities', () => {
  it('denies writes with the archive gate reason', () => {
    const snap = warGameArchiveCapabilities('parent-1');
    expect(snap.wearsCaptain).toBe(false);
    expect(snap.wearsCrew).toBe(false);
    expect(snap.capabilities.proposeTreasury).toEqual({
      allowed: false,
      reason: 'governance.gate.warGameArchive',
    });
    expect(snap.capabilities.executeTreasury?.allowed).toBe(false);
  });
});
