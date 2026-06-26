import { describe, it, expect } from 'vitest';
import { resolveDmMessagePresentation, isInvitePresentation } from './resolve-dm-message-presentation';
import type { DmMessage } from '../../stores/dm';

const SAMPLE_REQUEST = `{"version":1,"type":"wallet_tx_request","request_id":"550e8400-e29b-41d4-a716-446655440000","network":"sepolia","asset":"ETH","amount":"0.05","from_evm_address":"0x1111111111111111111111111111111111111111","created_at_ms":1710000000000}`;

function msg(overrides: Partial<DmMessage> = {}): DmMessage {
  return {
    id: 'm1',
    content: 'hello',
    at: 1,
    mine: false,
    ...overrides,
  };
}

describe('resolveDmMessagePresentation', () => {
  it('returns local-announcement for thread announcements', () => {
    expect(resolveDmMessagePresentation(msg({ is_local_announcement: true, content: 'Blocked' }))).toEqual({
      kind: 'local-announcement',
    });
  });

  it('returns plain for normal text', () => {
    expect(resolveDmMessagePresentation(msg({ content: 'hello' }))).toEqual({ kind: 'plain' });
  });

  it('classifies wallet tx request JSON', () => {
    const p = resolveDmMessagePresentation(msg({ content: SAMPLE_REQUEST }));
    expect(p.kind).toBe('wallet-tx-request');
    if (p.kind === 'wallet-tx-request') {
      expect(p.payload.request_id).toBe('550e8400-e29b-41d4-a716-446655440000');
    }
  });

  it('isInvitePresentation covers invite kinds only', () => {
    expect(isInvitePresentation({ kind: 'squad-invite', payload: {} as never })).toBe(true);
    expect(isInvitePresentation({ kind: 'plain' })).toBe(false);
  });
});
