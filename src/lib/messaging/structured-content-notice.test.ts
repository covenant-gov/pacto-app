import { describe, expect, it } from 'vitest';
import {
  isStructuredProductContent,
  summarizeStructuredMessageContent,
} from './structured-content-notice';

describe('summarizeStructuredMessageContent', () => {
  it('returns null for plain text', () => {
    expect(summarizeStructuredMessageContent('hello')).toBeNull();
  });

  it('summarizes join response with status', () => {
    expect(
      summarizeStructuredMessageContent(
        JSON.stringify({
          schema: 'pacto.squad.bot_join_response.v1',
          squadName: 'zzz',
          status: 'accepted',
        })
      )
    ).toBe('Join request for zzz was accepted');
  });

  it('summarizes allowlist type', () => {
    expect(
      summarizeStructuredMessageContent(
        JSON.stringify({ type: 'squad_contract_allowlist_updated', payload: {} })
      )
    ).toBe('Contract allowlist updated');
  });

  it('detects structured product content', () => {
    expect(isStructuredProductContent('{"type":"governance_updated"}')).toBe(true);
    expect(isStructuredProductContent('hi')).toBe(false);
  });
});
