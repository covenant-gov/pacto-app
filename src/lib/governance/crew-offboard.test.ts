import { describe, expect, it } from 'vitest';
import type { CrewOffboardDto, QuartermasterStatusDto } from './api';
import {
  isCrewOffboardActive,
  isCrewOffboardExecutable,
  isCrewOffboardExpirable,
  parseQuorumBps,
  quorumOfCastPassed,
} from './crew-offboard';

function offboard(overrides: Partial<CrewOffboardDto> = {}): CrewOffboardDto {
  return {
    offboardId: '1',
    target: '0xabc',
    proposer: '0xdef',
    deadline: 200,
    snapshot: 10,
    yeas: 2,
    nays: 1,
    executed: false,
    ...overrides,
  };
}

describe('crew-offboard helpers', () => {
  it('parses quorum bps with fallback', () => {
    expect(parseQuorumBps('3000')).toBe(3000);
    expect(parseQuorumBps(2500)).toBe(2500);
    expect(parseQuorumBps('bad')).toBe(3000);
    expect(parseQuorumBps(undefined)).toBe(3000);
  });

  it('passes quorum-of-cast when turnout and yeas win', () => {
    expect(quorumOfCastPassed(2, 1, 10, 3000)).toBe(true);
    expect(quorumOfCastPassed(3, 0, 10, 3000)).toBe(true);
    expect(quorumOfCastPassed(2, 0, 10, 3000)).toBe(false);
    expect(quorumOfCastPassed(2, 2, 10, 3000)).toBe(false);
    expect(quorumOfCastPassed(1, 0, 10, 3000)).toBe(false);
  });

  it('detects active offboard from QM status or round dto', () => {
    const qm: QuartermasterStatusDto = {
      crewChangeDelaySecs: '60',
      mutinyActive: false,
      activeCrewOffboardId: '4',
      crewOffboardExpirySecs: '300',
      crewOffboardQuorumBps: '3000',
      offboard: offboard({ offboardId: '4' }),
    };
    expect(isCrewOffboardActive(qm)).toBe(true);
    expect(isCrewOffboardActive({ ...qm, activeCrewOffboardId: '0', offboard: null })).toBe(false);
    expect(isCrewOffboardActive(offboard())).toBe(true);
    expect(isCrewOffboardActive(offboard({ executed: true }))).toBe(false);
  });

  it('execute before deadline; expire after even if quorum already met', () => {
    const ready = offboard({ yeas: 3, nays: 0, deadline: 200 });
    expect(isCrewOffboardExecutable(ready, 3000, 199)).toBe(true);
    expect(isCrewOffboardExpirable(ready, 199)).toBe(false);
    expect(isCrewOffboardExecutable(ready, 3000, 200)).toBe(false);
    expect(isCrewOffboardExpirable(ready, 200)).toBe(true);
  });
});
