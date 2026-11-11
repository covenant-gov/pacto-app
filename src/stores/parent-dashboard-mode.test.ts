import { describe, expect, it } from 'vitest';
import { parseSquadGovernanceChannelMode } from './navigation';

describe('parseSquadGovernanceChannelMode', () => {
  it('accepts known modes', () => {
    expect(parseSquadGovernanceChannelMode('status')).toBe('status');
    expect(parseSquadGovernanceChannelMode('governance')).toBe('governance');
    expect(parseSquadGovernanceChannelMode('treasury')).toBe('treasury');
    expect(parseSquadGovernanceChannelMode('crew')).toBe('crew');
    expect(parseSquadGovernanceChannelMode('settings')).toBe('status');
  });

  it('resets unknown values to status', () => {
    expect(parseSquadGovernanceChannelMode(null)).toBe('status');
    expect(parseSquadGovernanceChannelMode('')).toBe('status');
    expect(parseSquadGovernanceChannelMode('stickers')).toBe('status');
    expect(parseSquadGovernanceChannelMode('roles')).toBe('status');
    expect(parseSquadGovernanceChannelMode('roles_tree')).toBe('status');
  });
});
