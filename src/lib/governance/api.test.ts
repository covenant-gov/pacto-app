import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  buildPactoGovGovernanceAnnouncePayload,
  buildSquadAdminGovernanceAnnouncePayload,
  buildSponsorGovernanceAnnouncePayload,
  buildStandaloneSafeGovernanceAnnouncePayload,
  deployNavePirataForParent,
  deploySquadAdminForParent,
  deploySquadSponsorForParent,
  depositSquadSponsor,
  getHatsTree,
  getMemberHatWearers,
  getNavePirataDeployment,
  getSquadAdminExecutorRoles,
  getSquadSponsorSummary,
  hasSponsorInfra,
  infraTypeFromLegacyProvider,
  listSquadInfra,
  listTreasuryProposals,
  pactoGovInfraId,
  pactoGovInfraRow,
  pactoGovTreasuryEntryId,
  primaryGovernanceView,
  squadAdminCreateRole,
  squadAdminEnableExecutor,
  squadAdminEnableFullPermission,
  squadAdminInfraId,
  squadAdminInfraRow,
  squadInfraLegacyProvider,
  squadSponsorInfraId,
  sponsorInfraRow,
  treasuryProposalHasVoted,
  upsertSquadInfra,
  withLegacyProvider,
} from './api';
import type { SquadInfraDto } from './api';

vi.mock('@tauri-apps/api/core');

const mockedInvoke = vi.mocked(invoke);
const PARENT = 'test-parent';
const NETWORK = 'sepolia';

function makeSquadInfra(overrides: Partial<SquadInfraDto> = {}): SquadInfraDto {
  return {
    id: 'id-1',
    parentId: PARENT,
    infraType: 'pacto_gov',
    chain: 'sepolia',
    canonicalRef: '0x1234567890123456789012345678901234567890',
    createdAtMs: 1,
    updatedAtMs: 2,
    ...overrides,
  };
}

beforeEach(() => {
  mockedInvoke.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('squad infra helpers', () => {
  it('squadInfraLegacyProvider maps standalone_safe to gnosis_safe and leaves others unchanged', () => {
    expect(squadInfraLegacyProvider('standalone_safe')).toBe('gnosis_safe');
    expect(squadInfraLegacyProvider('pacto_gov')).toBe('pacto_gov');
    expect(squadInfraLegacyProvider('sponsor')).toBe('sponsor');
  });

  it('withLegacyProvider adds provider field', () => {
    const row = makeSquadInfra({ infraType: 'standalone_safe' });
    expect(withLegacyProvider(row)).toEqual({ ...row, provider: 'gnosis_safe' });
  });

  it('primaryGovernanceView returns undefined for undefined rows', () => {
    expect(primaryGovernanceView(undefined)).toBeUndefined();
  });

  it('primaryGovernanceView returns null for empty rows', () => {
    expect(primaryGovernanceView([])).toBeNull();
  });

  it('primaryGovernanceView prefers pacto_gov, then standalone_safe, then first row', () => {
    const sponsor = makeSquadInfra({ infraType: 'sponsor' });
    const standalone = makeSquadInfra({ infraType: 'standalone_safe' });
    const pacto = makeSquadInfra({ infraType: 'pacto_gov' });
    expect(primaryGovernanceView([sponsor, standalone, pacto])?.infraType).toBe('pacto_gov');
    expect(primaryGovernanceView([sponsor, standalone])?.infraType).toBe('standalone_safe');
    expect(primaryGovernanceView([sponsor])?.infraType).toBe('sponsor');
  });

  it('infraTypeFromLegacyProvider normalizes aliases', () => {
    expect(infraTypeFromLegacyProvider('gnosis_safe')).toBe('standalone_safe');
    expect(infraTypeFromLegacyProvider('gnosis-safe')).toBe('standalone_safe');
    expect(infraTypeFromLegacyProvider('safe')).toBe('standalone_safe');
    expect(infraTypeFromLegacyProvider('pacto-gov')).toBe('pacto_gov');
    expect(infraTypeFromLegacyProvider('squad_sponsor')).toBe('sponsor');
    expect(infraTypeFromLegacyProvider('squad_admin')).toBe('squad_admin');
    expect(infraTypeFromLegacyProvider('squad-admin')).toBe('squad_admin');
    expect(infraTypeFromLegacyProvider('pacto_gov')).toBe('pacto_gov');
  });

  it('id builders return stable parent-scoped ids', () => {
    expect(pactoGovInfraId(PARENT)).toBe(`pacto-gov-${PARENT}`);
    expect(pactoGovTreasuryEntryId(PARENT)).toBe(`pacto-gov-treasury-${PARENT}`);
    expect(squadSponsorInfraId(PARENT)).toBe(`sponsor-${PARENT}`);
    expect(squadAdminInfraId(PARENT)).toBe(`squad-admin-${PARENT}`);
  });

  it('row finders return the matching row or null', () => {
    const pacto = makeSquadInfra({ infraType: 'pacto_gov' });
    const sponsor = makeSquadInfra({ infraType: 'sponsor' });
    const admin = makeSquadInfra({ infraType: 'squad_admin' });
    expect(pactoGovInfraRow([pacto, sponsor, admin])).toEqual(pacto);
    expect(sponsorInfraRow([pacto, sponsor, admin])).toEqual(sponsor);
    expect(squadAdminInfraRow([pacto, sponsor, admin])).toEqual(admin);
    expect(hasSponsorInfra([pacto, sponsor])).toBe(true);
    expect(hasSponsorInfra([pacto])).toBe(false);
    expect(pactoGovInfraRow([])).toBeNull();
    expect(pactoGovInfraRow(undefined)).toBeNull();
  });
});

describe('api command wrappers', () => {
  it('listSquadInfra sends list_squad_infra with parentId', async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    await listSquadInfra(PARENT);
    expect(mockedInvoke).toHaveBeenCalledWith('list_squad_infra', { parentId: PARENT });
  });

  it('listSquadInfra coerces null/undefined to empty array', async () => {
    mockedInvoke.mockResolvedValueOnce(null);
    await expect(listSquadInfra(PARENT)).resolves.toEqual([]);
    mockedInvoke.mockResolvedValueOnce(undefined);
    await expect(listSquadInfra(PARENT)).resolves.toEqual([]);
  });

  it('upsertSquadInfra sends upsert_squad_infra with normalized nulls', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await upsertSquadInfra({
      id: 'id-1',
      parentId: PARENT,
      infraType: 'pacto_gov',
      canonicalRef: '0x1234',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('upsert_squad_infra', {
      id: 'id-1',
      parentId: PARENT,
      infraType: 'pacto_gov',
      chain: null,
      canonicalRef: '0x1234',
      pactoGovRevision: null,
      providerPayload: null,
    });
  });

  it('depositSquadSponsor sends deposit_squad_sponsor with trimmed sponsor address', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await depositSquadSponsor({
      network: NETWORK,
      parentId: PARENT,
      amountWei: '1000',
      sponsorAddress: ' 0xabc ',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('deposit_squad_sponsor', {
      network: NETWORK,
      parentId: PARENT,
      amountWei: '1000',
      sponsorAddress: '0xabc',
    });
  });

  it('depositSquadSponsor normalizes empty sponsor address to null', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await depositSquadSponsor({ network: NETWORK, parentId: PARENT, amountWei: '1000' });
    expect(mockedInvoke).toHaveBeenCalledWith('deposit_squad_sponsor', {
      network: NETWORK,
      parentId: PARENT,
      amountWei: '1000',
      sponsorAddress: null,
    });
  });

  it('deploySquadSponsorForParent sends deploy_squad_sponsor_for_parent with defaults', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await deploySquadSponsorForParent({ network: NETWORK, parentId: PARENT });
    expect(mockedInvoke).toHaveBeenCalledWith('deploy_squad_sponsor_for_parent', {
      network: NETWORK,
      parentId: PARENT,
      initialDepositWei: null,
      signerWallet: 'squad',
    });
  });

  it('deploySquadSponsorForParent passes optional params when provided', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await deploySquadSponsorForParent({
      network: NETWORK,
      parentId: PARENT,
      initialDepositWei: '1000',
      signerWallet: 'default',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('deploy_squad_sponsor_for_parent', {
      network: NETWORK,
      parentId: PARENT,
      initialDepositWei: '1000',
      signerWallet: 'default',
    });
  });

  it('getSquadSponsorSummary sends get_squad_sponsor_summary', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await getSquadSponsorSummary({ network: NETWORK, parentId: PARENT });
    expect(mockedInvoke).toHaveBeenCalledWith('get_squad_sponsor_summary', {
      network: NETWORK,
      parentId: PARENT,
      sponsorAddress: null,
    });
  });

  it('deployNavePirataForParent sends deploy_nave_pirata_for_parent', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await deployNavePirataForParent({
      network: NETWORK,
      parentId: PARENT,
      captain: '0xabc',
      metadataUri: ' https://example.com ',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('deploy_nave_pirata_for_parent', {
      network: NETWORK,
      parentId: PARENT,
      captain: '0xabc',
      metadataUri: 'https://example.com',
      saltNonce: null,
    });
  });

  it('getNavePirataDeployment sends get_nave_pirata_deployment with trimmed topHatId', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await getNavePirataDeployment({ network: NETWORK, topHatId: ' 42 ' });
    expect(mockedInvoke).toHaveBeenCalledWith('get_nave_pirata_deployment', {
      network: NETWORK,
      topHatId: '42',
    });
  });

  it('listTreasuryProposals sends list_treasury_proposals', async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    await listTreasuryProposals({ network: NETWORK, treasuryAuthority: '0xabc' });
    expect(mockedInvoke).toHaveBeenCalledWith('list_treasury_proposals', {
      network: NETWORK,
      treasuryAuthority: '0xabc',
      maxScan: null,
    });
  });

  it('listTreasuryProposals passes maxScan when provided', async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    await listTreasuryProposals({ network: NETWORK, treasuryAuthority: '0xabc', maxScan: 50 });
    expect(mockedInvoke).toHaveBeenCalledWith('list_treasury_proposals', {
      network: NETWORK,
      treasuryAuthority: '0xabc',
      maxScan: 50,
    });
  });

  it('treasuryProposalHasVoted sends treasury_proposal_has_voted with trimmed inputs', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    await treasuryProposalHasVoted({
      network: NETWORK,
      treasuryAuthority: ' 0xabc ',
      proposalId: ' 1 ',
      voter: ' 0xdef ',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('treasury_proposal_has_voted', {
      network: NETWORK,
      treasuryAuthority: '0xabc',
      proposalId: '1',
      voter: '0xdef',
    });
  });

  it('getHatsTree sends get_hats_tree with defaults', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await getHatsTree({ network: NETWORK, topHatId: '42' });
    expect(mockedInvoke).toHaveBeenCalledWith('get_hats_tree', {
      network: NETWORK,
      topHatId: '42',
      maxDepth: null,
      maxNodes: null,
    });
  });

  it('getHatsTree passes optional depth and node limits', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await getHatsTree({ network: NETWORK, topHatId: '42', maxDepth: 3, maxNodes: 100 });
    expect(mockedInvoke).toHaveBeenCalledWith('get_hats_tree', {
      network: NETWORK,
      topHatId: '42',
      maxDepth: 3,
      maxNodes: 100,
    });
  });

  it('getMemberHatWearers sends get_member_hat_wearers', async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    const hatChecks = [{ hatId: '1', label: 'Captain' }];
    await getMemberHatWearers({
      network: NETWORK,
      memberAddresses: ['0xabc'],
      hatChecks,
    });
    expect(mockedInvoke).toHaveBeenCalledWith('get_member_hat_wearers', {
      network: NETWORK,
      hatsContract: null,
      memberAddresses: ['0xabc'],
      hatChecks,
    });
  });

  it('getMemberHatWearers passes hatsContract when provided', async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    await getMemberHatWearers({
      network: NETWORK,
      hatsContract: ' 0xcontract ',
      memberAddresses: ['0xabc'],
      hatChecks: [{ hatId: '1', label: 'Captain' }],
    });
    expect(mockedInvoke).toHaveBeenCalledWith('get_member_hat_wearers', {
      network: NETWORK,
      hatsContract: '0xcontract',
      memberAddresses: ['0xabc'],
      hatChecks: [{ hatId: '1', label: 'Captain' }],
    });
  });

  it('getSquadAdminExecutorRoles sends get_squad_admin_executor_roles', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await getSquadAdminExecutorRoles({
      network: NETWORK,
      squadAdminProxy: ' 0xadmin ',
      executorAddress: ' 0xexec ',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('get_squad_admin_executor_roles', {
      network: NETWORK,
      squadAdminProxy: '0xadmin',
      executorAddress: '0xexec',
    });
  });

  it('deploySquadAdminForParent sends deploy_squad_admin_for_parent with optional owner and captainHatId', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await deploySquadAdminForParent({
      network: NETWORK,
      parentId: PARENT,
      variant: 'captain_hat',
      owner: ' 0xowner ',
      captainHatId: ' 42 ',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('deploy_squad_admin_for_parent', {
      network: NETWORK,
      parentId: PARENT,
      variant: 'captain_hat',
      owner: '0xowner',
      captainHatId: '42',
    });
  });

  it('deploySquadAdminForParent sends deploy_squad_admin_for_parent with null optional fields', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await deploySquadAdminForParent({
      network: NETWORK,
      parentId: PARENT,
      variant: 'ext_standalone',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('deploy_squad_admin_for_parent', {
      network: NETWORK,
      parentId: PARENT,
      variant: 'ext_standalone',
      owner: null,
      captainHatId: null,
    });
  });

  it('squadAdminCreateRole sends squad_admin_create_role with trimmed label', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await squadAdminCreateRole({
      network: NETWORK,
      squadAdminProxy: '0xadmin',
      roleLabel: ' Treasurer ',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('squad_admin_create_role', {
      network: NETWORK,
      squadAdminProxy: '0xadmin',
      roleLabel: 'Treasurer',
    });
  });

  it('squadAdminEnableExecutor sends squad_admin_enable_executor', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await squadAdminEnableExecutor({
      network: NETWORK,
      squadAdminProxy: '0xadmin',
      executorAddress: '0xexec',
      roleLabel: ' Treasurer ',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('squad_admin_enable_executor', {
      network: NETWORK,
      squadAdminProxy: '0xadmin',
      executorAddress: '0xexec',
      roleLabel: 'Treasurer',
    });
  });

  it('squadAdminEnableFullPermission sends squad_admin_enable_full_permission', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await squadAdminEnableFullPermission({
      network: NETWORK,
      squadAdminProxy: '0xadmin',
      executorAddress: '0xexec',
      enable: true,
    });
    expect(mockedInvoke).toHaveBeenCalledWith('squad_admin_enable_full_permission', {
      network: NETWORK,
      squadAdminProxy: '0xadmin',
      executorAddress: '0xexec',
      enable: true,
    });
  });
});

describe('governance announce payload builders', () => {
  it('buildSponsorGovernanceAnnouncePayload returns sponsor-shaped payload', () => {
    const payload = buildSponsorGovernanceAnnouncePayload({
      parentId: PARENT,
      sponsorAddress: '0x1111111111111111111111111111111111111111',
      chain: 'sepolia',
      providerPayload: '{"v":1}',
      entryId: squadSponsorInfraId(PARENT),
    });
    expect(payload).toEqual({
      parent_id: PARENT,
      provider: 'sponsor',
      canonical_ref: '0x1111111111111111111111111111111111111111',
      chain: 'sepolia',
      entry_id: squadSponsorInfraId(PARENT),
      provider_payload: '{"v":1}',
    });
  });

  it('buildPactoGovGovernanceAnnouncePayload omits revision when missing', () => {
    const payload = buildPactoGovGovernanceAnnouncePayload({
      parentId: PARENT,
      topHatId: '42',
      chain: 'sepolia',
      providerPayload: '{"v":1}',
      entryId: pactoGovInfraId(PARENT),
    });
    expect(payload.pacto_gov_revision).toBeUndefined();
    expect(payload.provider).toBe('pacto_gov');
  });

  it('buildPactoGovGovernanceAnnouncePayload includes revision when provided', () => {
    const payload = buildPactoGovGovernanceAnnouncePayload({
      parentId: PARENT,
      topHatId: '42',
      chain: 'sepolia',
      providerPayload: '{"v":1}',
      entryId: pactoGovInfraId(PARENT),
      pactoGovRevision: 'rev-1',
    });
    expect(payload.pacto_gov_revision).toBe('rev-1');
  });

  it('buildSquadAdminGovernanceAnnouncePayload returns squad_admin-shaped payload', () => {
    const payload = buildSquadAdminGovernanceAnnouncePayload({
      parentId: PARENT,
      squadAdminProxy: '0x2222222222222222222222222222222222222222',
      chain: 'sepolia',
      providerPayload: '{"v":1}',
      entryId: squadAdminInfraId(PARENT),
    });
    expect(payload).toEqual({
      parent_id: PARENT,
      provider: 'squad_admin',
      canonical_ref: '0x2222222222222222222222222222222222222222',
      chain: 'sepolia',
      entry_id: squadAdminInfraId(PARENT),
      provider_payload: '{"v":1}',
    });
  });

  it('buildStandaloneSafeGovernanceAnnouncePayload returns gnosis_safe-shaped payload', () => {
    const payload = buildStandaloneSafeGovernanceAnnouncePayload({
      parentId: PARENT,
      safeAddress: '0x3333333333333333333333333333333333333333',
      chain: 'sepolia',
      providerPayload: '{"v":1}',
      entryId: 'vault-1',
    });
    expect(payload).toEqual({
      parent_id: PARENT,
      provider: 'gnosis_safe',
      canonical_ref: '0x3333333333333333333333333333333333333333',
      chain: 'sepolia',
      entry_id: 'vault-1',
      provider_payload: '{"v":1}',
    });
  });
});
