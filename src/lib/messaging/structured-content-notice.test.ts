import { describe, expect, it, beforeAll } from 'vitest';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { initI18n } from '../i18n';
import {
  isStructuredProductContent,
  summarizeStructuredMessageContent,
} from './structured-content-notice';

beforeAll(async () => {
  await initI18n('en');
});

describe('summarizeStructuredMessageContent', () => {
  const tFn = () => get(t);

  it('returns null for plain text', () => {
    expect(summarizeStructuredMessageContent('hello', tFn())).toBeNull();
  });

  it('summarizes join response with status', () => {
    expect(
      summarizeStructuredMessageContent(
        JSON.stringify({
          schema: 'pacto.squad.bot_join_response.v1',
          squadName: 'zzz',
          status: 'accepted',
        }),
        tFn()
      )
    ).toBe('Join request for zzz was accepted');
  });

  it('summarizes allowlist type', () => {
    expect(
      summarizeStructuredMessageContent(
        JSON.stringify({ type: 'squad_contract_allowlist_updated', payload: {} }),
        tFn()
      )
    ).toBe('Contract allowlist updated');
  });

  it('summarizes squad network update with display name', () => {
    expect(
      summarizeStructuredMessageContent(
        JSON.stringify({
          type: 'squad_network_updated',
          payload: { parent_id: 'g1', chain: 'sepolia' },
        }),
        tFn()
      )
    ).toBe('Squad network updated to Sepolia');
    expect(
      summarizeStructuredMessageContent(
        JSON.stringify({
          type: 'squad_network_updated',
          payload: { parent_id: 'g1', chain: 'local' },
        }),
        tFn()
      )
    ).toBe('Squad network updated to Local Anvil');
  });

  it('detects structured product content', () => {
    expect(isStructuredProductContent('{"type":"governance_updated"}')).toBe(true);
    expect(isStructuredProductContent('hi')).toBe(false);
    expect(isStructuredProductContent('{"kind":"pacto.mentions.envelope.v1"}')).toBe(false);
  });

  it('summarizes new outbound-invite and channels catalog types', () => {
    expect(
      summarizeStructuredMessageContent(JSON.stringify({ type: 'squad_outbound_invite' })),
    ).toBe('Squad invite pending');
    expect(
      summarizeStructuredMessageContent(JSON.stringify({ type: 'squad_admit_needed' })),
    ).toBe('Squad member admit');
    expect(
      summarizeStructuredMessageContent(JSON.stringify({ type: 'squad_channels_catalog' })),
    ).toBe('Squad channels updated');
    expect(
      summarizeStructuredMessageContent(JSON.stringify({ type: 'squad_invite_accepted' })),
    ).toBe('Squad join update');
  });
});

