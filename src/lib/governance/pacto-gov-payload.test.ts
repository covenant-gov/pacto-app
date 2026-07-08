import { describe, expect, it } from 'vitest';
import {
  parsePactoGovProviderPayload,
  withPactoGovProviderPayloadTxHash,
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
