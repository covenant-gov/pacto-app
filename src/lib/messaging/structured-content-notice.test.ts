import { describe, expect, it } from 'vitest';
import {
  isStructuredProductContent,
  summarizeStructuredMessageContent,
} from './structured-content-notice';

describe('summarizeStructuredMessageContent', () => {
  const tFn = (key: string) => key;

  it('returns null for plain text', () => {
    expect(summarizeStructuredMessageContent('hello', tFn)).toBeNull();
  });

  it('summarizes join response with status', () => {
    expect(
      summarizeStructuredMessageContent(
        JSON.stringify({
          schema: 'pacto.squad.bot_join_response.v1',
          squadName: 'zzz',
          status: 'accepted',
        }),
        tFn
      )
    ).toBe('messaging.structuredNotice.joinRequestAccepted');
  });

  it('summarizes allowlist type', () => {
    expect(
      summarizeStructuredMessageContent(
        JSON.stringify({ type: 'squad_contract_allowlist_updated', payload: {} }),
        tFn
      )
    ).toBe('messaging.structuredNotice.contractAllowlistUpdated');
  });

  it('summarizes squad rpc update', () => {
    expect(
      summarizeStructuredMessageContent(JSON.stringify({ type: 'squad_rpc_updated', payload: {} }), tFn)
    ).toBe('messaging.structuredNotice.squadRpcUpdated');
  });

  it('summarizes squad network update with display name', () => {
    expect(
      summarizeStructuredMessageContent(
        JSON.stringify({
          type: 'squad_network_updated',
          payload: { parent_id: 'g1', chain: 'sepolia' },
        }),
        tFn
      )
    ).toBe('messaging.structuredNotice.squadNetworkUpdatedTo');
    expect(
      summarizeStructuredMessageContent(
        JSON.stringify({
          type: 'squad_network_updated',
          payload: { parent_id: 'g1', chain: 'local' },
        }),
        tFn
      )
    ).toBe('messaging.structuredNotice.squadNetworkUpdatedTo');
  });

  it('detects structured product content', () => {
    expect(isStructuredProductContent('{"type":"governance_updated"}')).toBe(true);
    expect(isStructuredProductContent('hi')).toBe(false);
    expect(isStructuredProductContent('{"kind":"pacto.mentions.envelope.v1"}')).toBe(false);
  });

  it('summarizes new outbound-invite and channels catalog types', () => {
    expect(
      summarizeStructuredMessageContent(JSON.stringify({ type: 'squad_outbound_invite' }), tFn)
    ).toBe('messaging.structuredNotice.squadInvitePending');
    expect(
      summarizeStructuredMessageContent(JSON.stringify({ type: 'squad_admit_needed' }), tFn)
    ).toBe('messaging.structuredNotice.squadMemberAdmit');
    expect(
      summarizeStructuredMessageContent(JSON.stringify({ type: 'squad_channels_catalog' }), tFn)
    ).toBe('messaging.structuredNotice.squadChannelsUpdated');
    expect(
      summarizeStructuredMessageContent(JSON.stringify({ type: 'squad_invite_accepted' }), tFn)
    ).toBe('messaging.structuredNotice.squadInviteAccepted');
  });

  it('covers schema/type fallbacks and invalid JSON', () => {
    expect(summarizeStructuredMessageContent(null, tFn)).toBeNull();
    expect(summarizeStructuredMessageContent(undefined, tFn)).toBeNull();
    expect(summarizeStructuredMessageContent('{', tFn)).toBeNull();
    expect(
      summarizeStructuredMessageContent(JSON.stringify({ schema: 'pacto.unknown.v1' }), tFn)
    ).toBe('messaging.structuredNotice.squadUpdate');
    expect(summarizeStructuredMessageContent(JSON.stringify({ type: 'unknown_type' }), tFn)).toBe(
      'messaging.structuredNotice.squadUpdate'
    );
  });
});
