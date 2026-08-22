import { describe, expect, it } from 'vitest';
import type { SquadInfraDto } from './api';
import {
  resolveSquadAdminContext,
  resolveWarGameSquadAdminContext,
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
