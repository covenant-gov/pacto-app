import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  buildPactoGovGovernanceAnnouncePayload,
  buildSquadAdminGovernanceAnnouncePayload,
  buildSponsorGovernanceAnnouncePayload,
  buildStandaloneSafeGovernanceAnnouncePayload,
  deployNavePirataForParent,
  deployWarGameForParent,
  deploySquadAdminForParent,
  deploySquadSponsorForParent,
  deploySquadSponsorHatsForParent,
  depositSquadSponsor,
  getSquadSponsorWithdrawable,
  withdrawSquadSponsor,
  getHatsTree,
  getHatWearersForIds,
  getMemberHatWearers,
  getNavePirataDeployment,
  getWarGameDeployment,
  getSquadCapabilities,
  getSquadAdminExecutorRoles,
  getSquadSponsorExtStatus,
  getSquadSponsorSummary,
  getSquadSponsorVariant,
  hasSponsorInfra,
  infraTypeFromLegacyProvider,
  listSquadInfra,
  listQuartermasterPending,
  listTreasuryProposals,
  getTreasuryVoteConfig,
  pactoGovInfraId,
  pactoGovInfraRow,
  pactoGovTreasuryEntryId,
  pactoGovWargameInfraId,
  pactoGovWargameInfraRow,
  primaryGovernanceView,
  mutinyExpire,
  mutinyExecute,
  quartermasterBootstrapCrew,
  quartermasterProposeOffboard,
  quartermasterCrewOffboardVote,
  quartermasterExecuteOffboard,
  quartermasterExpireOffboard,
  crewOffboardHasVoted,
  squadAdminCreateRole,
  squadSponsorSetPermittedAddress,
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
import { sendDmMessage } from '../api/nostr';
import { squads } from '../../stores/squads';
import { governanceProcessNonceByParentId } from '../../stores/navigation';
import { ANNOUNCE_TYPE_GOVERNANCE_PROCESS_UPDATED } from '../announcements';
import { resetMutinyProcessTxStore } from './mutiny-process-tx';
import { get } from 'svelte/store';

vi.mock('@tauri-apps/api/core');
vi.mock('../api/nostr', () => ({
  sendDmMessage: vi.fn().mockResolvedValue(true),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedSendDm = vi.mocked(sendDmMessage);
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
  mockedSendDm.mockReset();
  mockedSendDm.mockResolvedValue(true);
  governanceProcessNonceByParentId.set({});
  squads.set([]);
  resetMutinyProcessTxStore();
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

  it('primaryGovernanceView ignores pacto_gov_wargame', () => {
    const wargame = makeSquadInfra({ infraType: 'pacto_gov_wargame' });
    const sponsor = makeSquadInfra({ infraType: 'sponsor' });
    expect(primaryGovernanceView([wargame])).toBeNull();
    expect(primaryGovernanceView([wargame, sponsor])?.infraType).toBe('sponsor');
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
    expect(pactoGovWargameInfraId(PARENT)).toBe(`pacto-gov-wargame-${PARENT}`);
    expect(squadSponsorInfraId(PARENT)).toBe(`sponsor-${PARENT}`);
    expect(squadAdminInfraId(PARENT)).toBe(`squad-admin-${PARENT}`);
  });

  it('row finders return the matching row or null', () => {
    const pacto = makeSquadInfra({ infraType: 'pacto_gov' });
    const sponsor = makeSquadInfra({ infraType: 'sponsor' });
    const admin = makeSquadInfra({ infraType: 'squad_admin' });
    const wargame = makeSquadInfra({ infraType: 'pacto_gov_wargame' });
    expect(pactoGovInfraRow([pacto, sponsor, admin, wargame])).toEqual(pacto);
    expect(pactoGovWargameInfraRow([pacto, sponsor, admin, wargame])).toEqual(wargame);
    expect(pactoGovInfraRow([wargame])).toBeNull();
    expect(sponsorInfraRow([pacto, sponsor, admin])).toEqual(sponsor);
    expect(squadAdminInfraRow([pacto, sponsor, admin])).toEqual(admin);
    expect(hasSponsorInfra([pacto, sponsor])).toBe(true);
    expect(hasSponsorInfra([pacto])).toBe(false);
    expect(pactoGovInfraRow([])).toBeNull();
    expect(pactoGovInfraRow(undefined)).toBeNull();
  });
});

describe('getSquadSponsorVariant', () => {
  it('prefers the top-level variant over the payload', () => {
    expect(
      getSquadSponsorVariant({ variant: 'ext', providerPayload: '{"variant":"hats"}' }),
    ).toBe('ext');
  });

  it('falls back to the providerPayload variant', () => {
    expect(getSquadSponsorVariant({ providerPayload: '{"variant":"hats"}' })).toBe('hats');
  });

  it('falls back to the payload when the top-level variant is unrecognized', () => {
    expect(
      getSquadSponsorVariant({ variant: 'weird', providerPayload: '{"variant":"ext"}' }),
    ).toBe('ext');
  });

  it('normalizes case and surrounding whitespace', () => {
    expect(getSquadSponsorVariant({ variant: ' HATS ' })).toBe('hats');
  });

  it('returns null for unrecognized or missing values', () => {
    expect(getSquadSponsorVariant(null)).toBeNull();
    expect(getSquadSponsorVariant(undefined)).toBeNull();
    expect(getSquadSponsorVariant({})).toBeNull();
    expect(getSquadSponsorVariant({ variant: 'nope' })).toBeNull();
    expect(getSquadSponsorVariant({ providerPayload: 'not json' })).toBeNull();
    expect(getSquadSponsorVariant({ providerPayload: '{"variant":"nope"}' })).toBeNull();
    expect(getSquadSponsorVariant({ providerPayload: '{"variant":3}' })).toBeNull();
    expect(getSquadSponsorVariant({ providerPayload: '42' })).toBeNull();
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
      signerWallet: 'default',
      rpcUrls: expect.any(Array),
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
      signerWallet: 'default',
      rpcUrls: expect.any(Array),
    });
  });

  it('withdrawSquadSponsor sends withdraw_squad_sponsor with account id', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await withdrawSquadSponsor({
      network: NETWORK,
      parentId: PARENT,
      accountId: '  acc-1 ',
      sponsorAddress: ' 0xabc ',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('withdraw_squad_sponsor', {
      network: NETWORK,
      parentId: PARENT,
      accountId: 'acc-1',
      sponsorAddress: '0xabc',
      rpcUrls: expect.any(Array),
    });
  });

  it('getSquadSponsorWithdrawable trims address args', async () => {
    mockedInvoke.mockResolvedValueOnce('1000');
    await getSquadSponsorWithdrawable({
      network: NETWORK,
      parentId: PARENT,
      accountAddress: ' 0xdef ',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('get_squad_sponsor_withdrawable', {
      network: NETWORK,
      parentId: PARENT,
      accountAddress: '0xdef',
      sponsorAddress: null,
      rpcUrls: expect.any(Array),
    });
  });

  it('deploySquadSponsorHatsForParent sends deploy_squad_sponsor_hats_for_parent', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await deploySquadSponsorHatsForParent({
      network: NETWORK,
      parentId: PARENT,
      topHatId: ' 42 ',
      initialDepositWei: '1000',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('deploy_squad_sponsor_hats_for_parent', {
      network: NETWORK,
      parentId: PARENT,
      topHatId: '42',
      initialDepositWei: '1000',
      signerWallet: 'squad',
      rpcUrls: expect.any(Array),
    });
  });

  it('deploySquadSponsorHatsForParent sends deploy_squad_sponsor_hats_for_parent', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await deploySquadSponsorHatsForParent({
      network: NETWORK,
      parentId: PARENT,
      topHatId: ' 42 ',
      initialDepositWei: '1000',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('deploy_squad_sponsor_hats_for_parent', {
      network: NETWORK,
      parentId: PARENT,
      topHatId: '42',
      initialDepositWei: '1000',
      signerWallet: 'squad',
      rpcUrls: expect.any(Array),
    });
  });

  it('deploySquadSponsorForParent sends deploy_squad_sponsor_for_parent with defaults', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await deploySquadSponsorForParent({ network: NETWORK, parentId: PARENT });
    expect(mockedInvoke).toHaveBeenCalledWith('deploy_squad_sponsor_for_parent', {
      network: NETWORK,
      parentId: PARENT,
      initialDepositWei: null,
      signerWallet: 'default',
      rpcUrls: expect.any(Array),
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
      rpcUrls: expect.any(Array),
    });
  });

  it('getSquadSponsorSummary sends get_squad_sponsor_summary', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await getSquadSponsorSummary({ network: NETWORK, parentId: PARENT });
    expect(mockedInvoke).toHaveBeenCalledWith('get_squad_sponsor_summary', {
      network: NETWORK,
      parentId: PARENT,
      sponsorAddress: null,
      rpcUrls: expect.any(Array),
    });
  });

  it('getSquadSponsorExtStatus sends member addresses trimmed', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await getSquadSponsorExtStatus({
      network: NETWORK,
      parentId: PARENT,
      memberAddresses: [' 0xabc ', '', '0xdef'],
      sponsorAddress: ' 0xsponsor ',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('get_squad_sponsor_ext_status', {
      network: NETWORK,
      parentId: PARENT,
      memberAddresses: ['0xabc', '0xdef'],
      sponsorAddress: '0xsponsor',
      rpcUrls: expect.any(Array),
    });
  });

  it('squadSponsorSetPermittedAddress sends squad_sponsor_set_permitted_address', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await squadSponsorSetPermittedAddress({
      network: NETWORK,
      parentId: PARENT,
      memberAddress: ' 0xabc ',
      permitted: true,
    });
    expect(mockedInvoke).toHaveBeenCalledWith('squad_sponsor_set_permitted_address', {
      network: NETWORK,
      parentId: PARENT,
      memberAddress: '0xabc',
      permitted: true,
      sponsorAddress: null,
      rpcUrls: expect.any(Array),
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
      signerWallet: 'squad',
      altParentId: null,
      squadParams: null,
      rpcUrls: expect.any(Array),
    });
  });

  it('deployNavePirataForParent passes signerWallet when provided', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await deployNavePirataForParent({
      network: NETWORK,
      parentId: PARENT,
      captain: '0xabc',
      metadataUri: 'uri',
      signerWallet: 'default',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('deploy_nave_pirata_for_parent', {
      network: NETWORK,
      parentId: PARENT,
      captain: '0xabc',
      metadataUri: 'uri',
      saltNonce: null,
      signerWallet: 'default',
      altParentId: null,
      squadParams: null,
      rpcUrls: expect.any(Array),
    });
  });

  it('deployNavePirataForParent passes squadParams when provided', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await deployNavePirataForParent({
      network: NETWORK,
      parentId: PARENT,
      captain: '0xabc',
      squadParams: {
        crewChangeDelaySecs: 300,
        proposalExpirySecs: 300,
        crewVoteMode: 'quorum',
        quorumBps: 2500,
      },
    });
    expect(mockedInvoke).toHaveBeenCalledWith(
      'deploy_nave_pirata_for_parent',
      expect.objectContaining({
        squadParams: {
          crewChangeDelaySecs: 300,
          proposalExpirySecs: 300,
          crewVoteMode: 'quorum',
          quorumBps: 2500,
        },
      }),
    );
  });

  it('deployWarGameForParent sends deploy_war_game_for_parent on sepolia', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await deployWarGameForParent({
      parentId: PARENT,
      captain: ' 0xabc ',
      metadataUri: ' pacto://squad/x/wargame ',
      initialDepositWei: ' 1000 ',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('deploy_war_game_for_parent', {
      network: 'sepolia',
      parentId: PARENT,
      captain: ' 0xabc ',
      metadataUri: 'pacto://squad/x/wargame',
      saltNonce: null,
      signerWallet: 'default',
      altParentId: null,
      squadParams: null,
      initialDepositWei: '1000',
      rpcUrls: expect.any(Array),
    });
  });

  it('getNavePirataDeployment sends get_nave_pirata_deployment with trimmed topHatId', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await getNavePirataDeployment({ network: NETWORK, topHatId: ' 42 ' });
    expect(mockedInvoke).toHaveBeenCalledWith('get_nave_pirata_deployment', {
      network: NETWORK,
      topHatId: '42',
      rpcUrls: null,
    });
  });

  it('getWarGameDeployment sends get_war_game_deployment with trimmed topHatId', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await getWarGameDeployment({ network: NETWORK, topHatId: ' 3655 ' });
    expect(mockedInvoke).toHaveBeenCalledWith('get_war_game_deployment', {
      network: NETWORK,
      topHatId: '3655',
      rpcUrls: null,
    });
  });

  it('getSquadCapabilities sends wargame false by default and true when requested', async () => {
    mockedInvoke.mockResolvedValueOnce({}).mockResolvedValueOnce({});
    await getSquadCapabilities(PARENT, NETWORK);
    expect(mockedInvoke).toHaveBeenCalledWith(
      'get_squad_capabilities',
      expect.objectContaining({ parentId: PARENT, wargame: false }),
    );
    await getSquadCapabilities(PARENT, NETWORK, { wargame: true });
    expect(mockedInvoke).toHaveBeenCalledWith(
      'get_squad_capabilities',
      expect.objectContaining({ parentId: PARENT, wargame: true }),
    );
  });

  it('listTreasuryProposals sends list_treasury_proposals', async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    await listTreasuryProposals({ network: NETWORK, treasuryAuthority: '0xabc' });
    expect(mockedInvoke).toHaveBeenCalledWith('list_treasury_proposals', {
      network: NETWORK,
      treasuryAuthority: '0xabc',
      maxScan: null,
      rpcUrls: null,
    });
  });

  it('listTreasuryProposals passes maxScan when provided', async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    await listTreasuryProposals({ network: NETWORK, treasuryAuthority: '0xabc', maxScan: 50 });
    expect(mockedInvoke).toHaveBeenCalledWith('list_treasury_proposals', {
      network: NETWORK,
      treasuryAuthority: '0xabc',
      maxScan: 50,
      rpcUrls: null,
    });
  });

  it('getTreasuryVoteConfig sends get_treasury_vote_config', async () => {
    mockedInvoke.mockResolvedValueOnce({ crewVoteMode: 'majority', quorumBps: 3000 });
    await getTreasuryVoteConfig({ network: NETWORK, treasuryAuthority: '0xabc' });
    expect(mockedInvoke).toHaveBeenCalledWith('get_treasury_vote_config', {
      network: NETWORK,
      treasuryAuthority: '0xabc',
      rpcUrls: null,
    });
  });

  it('listQuartermasterPending sends list_quartermaster_pending', async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    await listQuartermasterPending({
      network: NETWORK,
      parentId: ' parent1 ',
      quartermaster: ' 0xqm ',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('list_quartermaster_pending', {
      network: NETWORK,
      parentId: 'parent1',
      quartermaster: '0xqm',
      rpcUrls: expect.any(Array),
    });
  });

  it('mutinyExpire and offboard writes send trimmed ids', async () => {
    mockedInvoke.mockResolvedValue({ txHash: '0x1', chain: 'sepolia', chainId: 11155111 });
    await mutinyExpire({
      network: NETWORK,
      parentId: ' parent1 ',
      mutinyModule: ' 0xmu ',
      mutinyId: ' 9 ',
    });
    expect(mockedInvoke).toHaveBeenCalledWith(
      'mutiny_expire',
      expect.objectContaining({
        parentId: 'parent1',
        mutinyModule: '0xmu',
        mutinyId: '9',
      }),
    );

    mockedInvoke.mockResolvedValue({ txHash: '0x2', chain: 'sepolia', chainId: 11155111 });
    await quartermasterProposeOffboard({
      network: NETWORK,
      parentId: ' parent1 ',
      quartermaster: ' 0xqm ',
      target: ' 0xabc ',
    });
    expect(mockedInvoke).toHaveBeenCalledWith(
      'quartermaster_propose_offboard',
      expect.objectContaining({
        parentId: 'parent1',
        quartermaster: '0xqm',
        target: '0xabc',
      }),
    );

    mockedInvoke.mockResolvedValue({ txHash: '0x3', chain: 'sepolia', chainId: 11155111 });
    await quartermasterCrewOffboardVote({
      network: NETWORK,
      parentId: 'parent1',
      quartermaster: '0xqm',
      offboardId: ' 2 ',
      support: true,
    });
    expect(mockedInvoke).toHaveBeenCalledWith(
      'quartermaster_crew_offboard_vote',
      expect.objectContaining({ offboardId: '2', support: true }),
    );

    mockedInvoke.mockResolvedValue({ txHash: '0x4', chain: 'sepolia', chainId: 11155111 });
    await quartermasterExecuteOffboard({
      network: NETWORK,
      parentId: 'parent1',
      quartermaster: '0xqm',
      offboardId: '2',
    });
    expect(mockedInvoke).toHaveBeenCalledWith(
      'quartermaster_execute_offboard',
      expect.objectContaining({ offboardId: '2' }),
    );

    mockedInvoke.mockResolvedValue({ txHash: '0x5', chain: 'sepolia', chainId: 11155111 });
    await quartermasterExpireOffboard({
      network: NETWORK,
      parentId: 'parent1',
      quartermaster: '0xqm',
      offboardId: '2',
    });
    expect(mockedInvoke).toHaveBeenCalledWith(
      'quartermaster_expire_offboard',
      expect.objectContaining({ offboardId: '2' }),
    );

    mockedInvoke.mockResolvedValueOnce(true);
    await crewOffboardHasVoted({
      network: NETWORK,
      quartermaster: ' 0xqm ',
      offboardId: ' 2 ',
      voter: ' 0xabc ',
    });
    expect(mockedInvoke).toHaveBeenCalledWith(
      'crew_offboard_has_voted',
      expect.objectContaining({
        quartermaster: '0xqm',
        offboardId: '2',
        voter: '0xabc',
      }),
    );
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
      rpcUrls: null,
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
      rpcUrls: null,
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
      rpcUrls: null,
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
      rpcUrls: null,
    });
  });

  it('getHatWearersForIds sends get_hat_wearers_for_ids', async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    await getHatWearersForIds({
      network: NETWORK,
      hatIds: ['1', '2'],
      fromTxHash: ' 0xabc ',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('get_hat_wearers_for_ids', {
      network: NETWORK,
      hatIds: ['1', '2'],
      fromTxHash: '0xabc',
      hatsContract: null,
      rpcUrls: null,
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
      rpcUrls: null,
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
      rpcUrls: null,
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
      rpcUrls: expect.any(Array),
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
      rpcUrls: expect.any(Array),
    });
  });

  it('squadAdminCreateRole sends squad_admin_create_role with trimmed label', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await squadAdminCreateRole({
      network: NETWORK,
      parentId: 'parent-1',
      squadAdminProxy: '0xadmin',
      roleLabel: ' Treasurer ',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('squad_admin_create_role', {
      network: NETWORK,
      parentId: 'parent-1',
      squadAdminProxy: '0xadmin',
      roleLabel: 'Treasurer',
      rpcUrls: expect.any(Array),
    });
  });

  it('squadAdminEnableExecutor sends squad_admin_enable_executor', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await squadAdminEnableExecutor({
      network: NETWORK,
      parentId: 'parent-1',
      squadAdminProxy: '0xadmin',
      executorAddress: '0xexec',
      roleLabel: ' Treasurer ',
    });
    expect(mockedInvoke).toHaveBeenCalledWith('squad_admin_enable_executor', {
      network: NETWORK,
      parentId: 'parent-1',
      squadAdminProxy: '0xadmin',
      executorAddress: '0xexec',
      roleLabel: 'Treasurer',
      rpcUrls: expect.any(Array),
    });
  });

  it('squadAdminEnableFullPermission sends squad_admin_enable_full_permission', async () => {
    mockedInvoke.mockResolvedValueOnce({});
    await squadAdminEnableFullPermission({
      network: NETWORK,
      parentId: 'parent-1',
      squadAdminProxy: '0xadmin',
      executorAddress: '0xexec',
      enable: true,
    });
    expect(mockedInvoke).toHaveBeenCalledWith('squad_admin_enable_full_permission', {
      network: NETWORK,
      parentId: 'parent-1',
      squadAdminProxy: '0xadmin',
      executorAddress: '0xexec',
      enable: true,
      rpcUrls: expect.any(Array),
    });
  });
});

describe('governance process gossip after writes', () => {
  const writeResult = { txHash: '0xabc', chain: 'sepolia', chainId: 11155111 };

  function withAnnouncementsSquad() {
    squads.set([
      {
        id: PARENT,
        channels: [{ name: 'announcements', groupId: 'gid-1', order: 0 }],
      } as never,
    ]);
  }

  it('mutinyExecute bumps the process nonce even if the MLS announce fails', async () => {
    withAnnouncementsSquad();
    mockedSendDm.mockRejectedValueOnce(new Error('offline'));
    mockedInvoke.mockResolvedValueOnce(writeResult);
    await mutinyExecute({
      network: NETWORK,
      parentId: PARENT,
      mutinyModule: '0xmutiny',
      mutinyId: '1',
    });
    expect(get(governanceProcessNonceByParentId)[PARENT]).toBe(1);
  });

  it('quartermasterBootstrapCrew announces hats process updates', async () => {
    withAnnouncementsSquad();
    mockedInvoke.mockResolvedValueOnce(writeResult);
    await quartermasterBootstrapCrew({
      network: NETWORK,
      parentId: PARENT,
      quartermaster: '0xqm',
      candidates: ['0x1'],
    });
    expect(mockedSendDm).toHaveBeenCalledWith(
      'gid-1',
      expect.stringContaining(ANNOUNCE_TYPE_GOVERNANCE_PROCESS_UPDATED),
      '',
      { virtualBucket: 'announcements' },
    );
    expect(JSON.parse(String(mockedSendDm.mock.calls[0]?.[1])).payload.kind).toBe('hats');
    expect(get(governanceProcessNonceByParentId)[PARENT]).toBe(1);
  });

  it('squadAdminCreateRole announces hats process updates', async () => {
    withAnnouncementsSquad();
    mockedInvoke.mockResolvedValueOnce(writeResult);
    await squadAdminCreateRole({
      network: NETWORK,
      parentId: PARENT,
      squadAdminProxy: '0xadmin',
      roleLabel: 'Treasurer',
    });
    expect(JSON.parse(String(mockedSendDm.mock.calls[0]?.[1])).payload.kind).toBe('hats');
    expect(get(governanceProcessNonceByParentId)[PARENT]).toBe(1);
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
