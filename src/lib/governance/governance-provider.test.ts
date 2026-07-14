import { describe, expect, it } from 'vitest';
import {
  pactoGovModuleDescriptors,
  resolveGovernanceProvider,
} from './governance-provider';
import type { SquadInfraDto } from './api';

const pactoRow = (payload: object): SquadInfraDto => ({
  id: '1',
  parentId: 'p1',
  infraType: 'pacto_gov',
  chain: 'sepolia',
  canonicalRef: '3521',
  providerPayload: JSON.stringify({ v: 1, ...payload }),
  createdAtMs: 1,
  updatedAtMs: 1,
});

describe('resolveGovernanceProvider', () => {
  it('returns none without infra', () => {
    expect(resolveGovernanceProvider(undefined)).toBe('none');
    expect(resolveGovernanceProvider([])).toBe('none');
  });

  it('returns pacto_gov when treasury authority is present', () => {
    expect(
      resolveGovernanceProvider([
        pactoRow({ treasuryAuthority: '0x1111111111111111111111111111111111111111' }),
      ]),
    ).toBe('pacto_gov');
  });

  it('returns abi_modules when custom_module.abiRef is present', () => {
    const row: SquadInfraDto = {
      id: '2',
      parentId: 'p1',
      infraType: 'custom_gov',
      chain: 'sepolia',
      canonicalRef: '0xabc',
      providerPayload: JSON.stringify({ custom_module: { abiRef: 'erc20-minimal' } }),
      createdAtMs: 1,
      updatedAtMs: 1,
    };
    expect(resolveGovernanceProvider([row])).toBe('abi_modules');
  });
});

describe('pactoGovModuleDescriptors', () => {
  it('builds modules from payload addresses', () => {
    const modules = pactoGovModuleDescriptors({
      treasuryAuthority: '0x1111111111111111111111111111111111111111',
      mutinyModule: '0x2222222222222222222222222222222222222222',
      quartermaster: '0x3333333333333333333333333333333333333333',
      squadAdminProxy: '0x4444444444444444444444444444444444444444',
      safe: '0x5555555555555555555555555555555555555555',
    });
    expect(modules.map((m) => m.id)).toEqual([
      'treasury_authority',
      'mutiny',
      'quartermaster',
      'squad_admin',
      'safe',
    ]);
  });
});
