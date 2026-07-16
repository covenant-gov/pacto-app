import { describe, expect, it } from 'vitest';
import {
  gateRequiresCaptain,
  gateRequiresCrew,
  resolveGovernancePrivilege,
} from './governance-privilege';

describe('resolveGovernancePrivilege', () => {
  it('detects captain and crew wearers', () => {
    const p = resolveGovernancePrivilege({
      myAddress: '0xAAA',
      safeAddress: '0xSAFE',
      captainWearers: ['0xaaa'],
      crewWearers: ['0xbbb'],
    });
    expect(p.wearsCaptain).toBe(true);
    expect(p.wearsCrew).toBe(false);
    expect(p.roleLabel).toBe('Captain');
  });

  it('detects Safe-as-captain', () => {
    const p = resolveGovernancePrivilege({
      myAddress: '0xAAA',
      safeAddress: '0xSAFE',
      captainWearers: ['0xsafe'],
      crewWearers: ['0xaaa'],
    });
    expect(p.captainIsSafe).toBe(true);
    expect(p.wearsCrew).toBe(true);
    expect(gateRequiresCaptain(p).enabled).toBe(false);
    expect(gateRequiresCaptain(p).reason).toMatch(/Safe/i);
    expect(gateRequiresCrew(p).enabled).toBe(true);
  });
});
