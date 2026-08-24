import { describe, expect, it } from 'vitest';
import type { SquadInfraDto } from './api';
import {
  resolveSettingsPrivilegesAdmin,
  resolveSquadAdminContext,
  resolveWarGameSquadAdminContext,
  settingsPrivilegesRevision,
} from './squad-admin-payload';

function row(overrides: Partial<SquadInfraDto> = {}): SquadInfraDto {
  return {
    id: 'id-1',
    parentId: 'parent-1',
    infraType: 'pacto_gov',
    chain: 'sepolia',
    canonicalRef: '1',
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides,
  };
}

describe('resolveWarGameSquadAdminContext', () => {
  it('reads squadAdminProxy from pacto_gov_wargame payload', () => {
    const ctx = resolveWarGameSquadAdminContext(
      row({
        infraType: 'pacto_gov_wargame',
        providerPayload: JSON.stringify({
          v: 1,
          squadAdminProxy: '0x4444444444444444444444444444444444444444',
        }),
      }),
    );
    expect(ctx).toEqual({
      proxy: '0x4444444444444444444444444444444444444444',
      chain: 'sepolia',
      source: 'pacto_gov_wargame',
      variant: 'nave_pirata',
    });
  });

  it('ignores live pacto_gov rows', () => {
    expect(
      resolveWarGameSquadAdminContext(
        row({
          providerPayload: JSON.stringify({
            squadAdminProxy: '0x4444444444444444444444444444444444444444',
          }),
        }),
      ),
    ).toBeNull();
  });
});

describe('resolveSquadAdminContext', () => {
  it('does not treat pacto_gov_wargame as live pacto_gov', () => {
    expect(
      resolveSquadAdminContext([
        row({
          infraType: 'pacto_gov_wargame',
          providerPayload: JSON.stringify({
            squadAdminProxy: '0x4444444444444444444444444444444444444444',
          }),
        }),
      ]),
    ).toBeNull();
  });
});

const liveProxy = '0x1111111111111111111111111111111111111111';
const wargameProxy = '0x4444444444444444444444444444444444444444';

describe('resolveSettingsPrivilegesAdmin', () => {
  it('prefers live Squad Admin over war-game', () => {
    expect(
      resolveSettingsPrivilegesAdmin([
        row({
          infraType: 'pacto_gov',
          providerPayload: JSON.stringify({ squadAdminProxy: liveProxy }),
        }),
        row({
          id: 'wg-1',
          infraType: 'pacto_gov_wargame',
          providerPayload: JSON.stringify({ squadAdminProxy: wargameProxy }),
        }),
      ]),
    ).toMatchObject({ proxy: liveProxy, source: 'pacto_gov' });
  });

  it('falls back to war-game when live admin is absent', () => {
    expect(
      resolveSettingsPrivilegesAdmin([
        row({
          infraType: 'pacto_gov_wargame',
          providerPayload: JSON.stringify({ squadAdminProxy: wargameProxy }),
        }),
      ]),
    ).toMatchObject({ proxy: wargameProxy, source: 'pacto_gov_wargame' });
  });

  it('returns null when neither stack has a proxy', () => {
    expect(resolveSettingsPrivilegesAdmin([row()])).toBeNull();
  });
});

describe('settingsPrivilegesRevision', () => {
  it('uses the war-game row when that stack is the resolved admin', () => {
    const rows = [
      row({ pactoGovRevision: 'live-rev' }),
      row({
        id: 'wg-1',
        infraType: 'pacto_gov_wargame',
        pactoGovRevision: 'wg-rev',
        providerPayload: JSON.stringify({ squadAdminProxy: wargameProxy }),
      }),
    ];
    const ctx = resolveSettingsPrivilegesAdmin(rows);
    expect(settingsPrivilegesRevision(rows, ctx)).toBe('wg-rev');
  });

  it('uses the live pacto-gov revision when live admin wins', () => {
    const rows = [
      row({
        pactoGovRevision: 'live-rev',
        providerPayload: JSON.stringify({ squadAdminProxy: liveProxy }),
      }),
      row({
        id: 'wg-1',
        infraType: 'pacto_gov_wargame',
        pactoGovRevision: 'wg-rev',
        providerPayload: JSON.stringify({ squadAdminProxy: wargameProxy }),
      }),
    ];
    const ctx = resolveSettingsPrivilegesAdmin(rows);
    expect(settingsPrivilegesRevision(rows, ctx)).toBe('live-rev');
  });
});
