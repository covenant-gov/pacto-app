import { describe, expect, it } from 'vitest';
import {
  parsePactoGovProviderPayload,
  withPactoGovProviderPayloadTxHash,
  pactoGovDeployAnnounceRows,
  txHashFromPactoGovProviderPayload,
} from './pacto-gov-payload';

describe('withPactoGovProviderPayloadTxHash', () => {
  it('adds txHash to v1 provider_payload when missing', () => {
    const raw = JSON.stringify({
      v: 1,
      parentId: 'squad-a',
      safe: '0x1111111111111111111111111111111111111111',
    });
    const out = withPactoGovProviderPayloadTxHash(raw, '0xabc123');
    const parsed = parsePactoGovProviderPayload(out);
    expect(parsed?.txHash).toBe('0xabc123');
    expect(parsed?.safe).toBe('0x1111111111111111111111111111111111111111');
  });

  it('is idempotent when txHash already matches', () => {
    const raw = JSON.stringify({ v: 1, txHash: '0xabc123' });
    expect(withPactoGovProviderPayloadTxHash(raw, '0xabc123')).toBe(raw);
  });

  it('returns raw string when JSON is invalid', () => {
    expect(withPactoGovProviderPayloadTxHash('not-json', '0x1')).toBe('not-json');
  });
});

describe('pactoGovDeployAnnounceRows', () => {
  it('lists module addresses and top hat in stable order', () => {
    const providerPayload = JSON.stringify({
      v: 1,
      safe: '0x1111111111111111111111111111111111111111',
      squadAdminProxy: '0x2222222222222222222222222222222222222222',
      quartermaster: '0x3333333333333333333333333333333333333333',
      mutinyModule: '0x4444444444444444444444444444444444444444',
      treasuryAuthority: '0x5555555555555555555555555555555555555555',
    });
    const rows = pactoGovDeployAnnounceRows({ providerPayload, topHatId: '3519' });
    expect(rows).toEqual([
      { kind: 'address', label: 'Treasury Safe', address: '0x1111111111111111111111111111111111111111' },
      { kind: 'address', label: 'Squad Admin', address: '0x2222222222222222222222222222222222222222' },
      { kind: 'address', label: 'Quartermaster', address: '0x3333333333333333333333333333333333333333' },
      { kind: 'address', label: 'Mutiny module', address: '0x4444444444444444444444444444444444444444' },
      { kind: 'address', label: 'Treasury Authority', address: '0x5555555555555555555555555555555555555555' },
      { kind: 'hat', label: 'Top hat', hatId: '3519' },
    ]);
  });
});

describe('txHashFromPactoGovProviderPayload', () => {
  it('reads txHash and tx_hash', () => {
    expect(txHashFromPactoGovProviderPayload(JSON.stringify({ txHash: '0xabc' }))).toBe('0xabc');
    expect(txHashFromPactoGovProviderPayload(JSON.stringify({ tx_hash: '0xdef' }))).toBe('0xdef');
  });
});
