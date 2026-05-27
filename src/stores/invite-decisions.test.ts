import { describe, expect, it } from 'vitest';
import { INVITE_DECISION_SCOPED_PREFIXES } from './invite-decisions';

describe('invite-decisions', () => {
  it('does not persist removed squad invite EVM share prefixes', () => {
    const prefixes = INVITE_DECISION_SCOPED_PREFIXES as readonly string[];
    expect(prefixes).not.toContain('pacto_squad_invite_evm_shared');
    expect(prefixes).not.toContain('pacto_squad_invite_evm_skipped');
  });
});
