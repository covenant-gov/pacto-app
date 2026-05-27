import type { ParentGovernanceDto } from '$lib/governance/api';
import { describe, expect, it } from 'vitest';
import {
  pactoGovPermissionsCatalog,
  resolveDashboardPermissionsContext,
  treasurySafePermissionsCatalog,
} from './permissions-panel';

describe('resolveDashboardPermissionsContext', () => {
  it('loading when governance is undefined', () => {
    const ctx = resolveDashboardPermissionsContext(undefined);
    expect(ctx.phase).toBe('loading');
    expect(ctx.catalogRows).toEqual([]);
  });

  it('mls_only when no row', () => {
    const ctx = resolveDashboardPermissionsContext(null);
    expect(ctx.phase).toBe('mls_only');
    expect(ctx.catalogRows).toEqual([]);
    expect(ctx.leadNote).toContain('Pacto Gov');
  });

  it('pacto_gov includes catalog and revision', () => {
    const row: ParentGovernanceDto = {
      id: 'pacto-gov-p1',
      parentId: 'p1',
      infraType: 'pacto_gov',
      provider: 'pacto_gov',
      chain: 'sepolia',
      canonicalRef: '1',
      pactoGovRevision: 'abc',
      createdAtMs: 1,
      updatedAtMs: 1,
    };
    const ctx = resolveDashboardPermissionsContext(row);
    expect(ctx.phase).toBe('pacto_gov');
    expect(ctx.catalogRows).toEqual(pactoGovPermissionsCatalog());
    expect(ctx.pactoGovRevision).toBe('abc');
    expect(ctx.showExecutorMappingPlaceholder).toBe(false);
  });

  it('gnosis_safe uses treasury catalog', () => {
    const row: ParentGovernanceDto = {
      id: 'standalone-safe-p1',
      parentId: 'p1',
      infraType: 'standalone_safe',
      provider: 'gnosis_safe',
      chain: 'sepolia',
      canonicalRef: '0xsafe',
      createdAtMs: 1,
      updatedAtMs: 1,
    };
    const ctx = resolveDashboardPermissionsContext(row);
    expect(ctx.phase).toBe('treasury_safe_only');
    expect(ctx.catalogRows).toEqual(treasurySafePermissionsCatalog());
    expect(ctx.showExecutorMappingPlaceholder).toBe(false);
  });

  it('unknown provider is other_provider', () => {
    const ctx = resolveDashboardPermissionsContext({
      parentId: 'p1',
      provider: 'bread_coop',
      chain: 'sepolia',
      canonicalRef: 'x',
      createdAtMs: 1,
      updatedAtMs: 1,
    });
    expect(ctx.phase).toBe('other_provider');
    expect(ctx.catalogRows).toEqual([]);
  });
});
