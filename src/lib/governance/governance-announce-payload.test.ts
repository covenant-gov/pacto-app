import { describe, expect, it } from 'vitest';
import {
  buildPactoGovGovernanceAnnouncePayload,
  buildSponsorGovernanceAnnouncePayload,
  buildSquadAdminGovernanceAnnouncePayload,
  buildStandaloneSafeGovernanceAnnouncePayload,
  infraTypeFromLegacyProvider,
  pactoGovInfraId,
  squadAdminInfraId,
  squadSponsorInfraId,
} from './api';

const PARENT = 'smoke-squad-alpha';

describe('governance_updated announce payloads (A4 wire shape)', () => {
  it('sponsor payload includes stable entry_id and provider', () => {
    const entryId = squadSponsorInfraId(PARENT);
    const payload = buildSponsorGovernanceAnnouncePayload({
      parentId: PARENT,
      sponsorAddress: '0x1111111111111111111111111111111111111111',
      chain: 'sepolia',
      providerPayload: '{"v":1}',
      entryId,
    });
    expect(payload.parent_id).toBe(PARENT);
    expect(payload.provider).toBe('sponsor');
    expect(payload.entry_id).toBe(entryId);
    expect(payload.canonical_ref).toMatch(/^0x/i);
    expect(infraTypeFromLegacyProvider(payload.provider)).toBe('sponsor');
  });

  it('pacto_gov payload uses top hat as canonical_ref', () => {
    const entryId = pactoGovInfraId(PARENT);
    const payload = buildPactoGovGovernanceAnnouncePayload({
      parentId: PARENT,
      topHatId: '42',
      chain: 'sepolia',
      providerPayload: '{"v":1}',
      entryId,
    });
    expect(payload.provider).toBe('pacto_gov');
    expect(payload.canonical_ref).toBe('42');
    expect(payload.entry_id).toBe(entryId);
  });

  it('squad_admin payload maps provider for ingest', () => {
    const entryId = squadAdminInfraId(PARENT);
    const proxy = '0x2222222222222222222222222222222222222222';
    const payload = buildSquadAdminGovernanceAnnouncePayload({
      parentId: PARENT,
      squadAdminProxy: proxy,
      chain: 'sepolia',
      providerPayload: '{"v":1}',
      entryId,
    });
    expect(payload.provider).toBe('squad_admin');
    expect(infraTypeFromLegacyProvider(payload.provider)).toBe('squad_admin');
    expect(payload.entry_id).toBe(entryId);
  });

  it('standalone Safe payload uses gnosis_safe provider slug', () => {
    const safe = '0x3333333333333333333333333333333333333333';
    const entryId = 'vault-entry-1';
    const payload = buildStandaloneSafeGovernanceAnnouncePayload({
      parentId: PARENT,
      safeAddress: safe,
      chain: 'sepolia',
      providerPayload: '{"v":1}',
      entryId,
    });
    expect(payload.provider).toBe('gnosis_safe');
    expect(infraTypeFromLegacyProvider(payload.provider)).toBe('standalone_safe');
    expect(payload.entry_id).toBe(entryId);
    expect(payload.canonical_ref).toBe(safe);
  });
});
