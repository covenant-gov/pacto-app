import { describe, expect, it } from 'vitest';
import { buildPoaGovernanceAnnouncePayload, infraTypeFromLegacyProvider, poaInfraId } from './api';
import {
  buildPoaProviderPayload,
  hasPoaInfra,
  parsePoaProviderPayload,
  poaInfraRow,
} from './poa-payload';
import type { SquadInfraDto } from './api';

const PARENT = 'smoke-squad-poa';
const ORG_ID = '0xa71879ef0e38b15fe7080196c0102f859e0ca8e7b8c0703ec8df03c66befd069';
const EXECUTOR = '0x4444444444444444444444444444444444444444';

function row(overrides: Partial<SquadInfraDto>): SquadInfraDto {
  return {
    id: 'poa-x',
    parentId: PARENT,
    infraType: 'poa',
    chain: 'gnosis',
    canonicalRef: ORG_ID,
    createdAtMs: 0,
    updatedAtMs: 0,
    ...overrides,
  };
}

describe('poa provider payload', () => {
  it('round-trips v1 fields', () => {
    const raw = buildPoaProviderPayload({
      orgId: ORG_ID,
      executor: EXECUTOR,
      label: 'Poa DAO',
    });
    const parsed = parsePoaProviderPayload(raw);
    expect(parsed?.v).toBe(1);
    expect(parsed?.org_id).toBe(ORG_ID);
    expect(parsed?.executor).toBe(EXECUTOR);
    expect(parsed?.label).toBe('Poa DAO');
  });

  it('omits empty optional fields', () => {
    const parsed = parsePoaProviderPayload(buildPoaProviderPayload({ orgId: ORG_ID }));
    expect(parsed?.org_id).toBe(ORG_ID);
    expect(parsed?.executor).toBeUndefined();
  });

  it('returns null on garbage or empty input', () => {
    expect(parsePoaProviderPayload('not json')).toBeNull();
    expect(parsePoaProviderPayload('')).toBeNull();
    expect(parsePoaProviderPayload(undefined)).toBeNull();
  });
});

describe('poa infra row selectors', () => {
  it('finds and reports the poa row', () => {
    const rows = [row({ infraType: 'sponsor' }), row({ infraType: 'poa' })];
    expect(poaInfraRow(rows)?.infraType).toBe('poa');
    expect(hasPoaInfra(rows)).toBe(true);
    expect(hasPoaInfra([row({ infraType: 'sponsor' })])).toBe(false);
  });
});

describe('poa governance_updated announce payload (A4 wire shape)', () => {
  it('uses orgId as canonical_ref and poa provider slug', () => {
    const entryId = poaInfraId(PARENT);
    const payload = buildPoaGovernanceAnnouncePayload({
      parentId: PARENT,
      orgId: ORG_ID,
      chain: 'gnosis',
      providerPayload: '{"v":1}',
      entryId,
    });
    expect(payload.provider).toBe('poa');
    expect(payload.canonical_ref).toBe(ORG_ID);
    expect(payload.entry_id).toBe(entryId);
    // Provider slug + aliases must map to the same infra_type the Rust allowlist canonicalizes to.
    expect(infraTypeFromLegacyProvider(payload.provider)).toBe('poa');
    expect(infraTypeFromLegacyProvider('poa_gov')).toBe('poa');
    expect(infraTypeFromLegacyProvider('pop')).toBe('poa');
  });
});
