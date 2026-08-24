import { describe, expect, it } from 'vitest';
import {
  aclSnapshotLoadKey,
  aclSnapshotShouldRetry,
  fingerprintWearerAddresses,
} from './acl-snapshot-key';

describe('fingerprintWearerAddresses', () => {
  it('lowercases, trims, uniques, and sorts', () => {
    expect(fingerprintWearerAddresses([' 0xBBB ', '0xaaa', '0xAAA', ''])).toBe('0xaaa,0xbbb');
  });

  it('ignores blank ids and empty input', () => {
    expect(fingerprintWearerAddresses(['', '   '])).toBe('');
    expect(fingerprintWearerAddresses(undefined)).toBe('');
    expect(fingerprintWearerAddresses(null)).toBe('');
  });
});

describe('aclSnapshotLoadKey', () => {
  const base = {
    parentId: ' parent1 ',
    network: 'sepolia',
    warGameStack: true,
    processNonce: 2,
    myAddress: ' 0xAbC ',
    captainWearers: ['0xcap'],
    crewWearers: ['0xcrew'],
  };

  it('includes stack, nonce, address, and wearer fingerprints', () => {
    expect(aclSnapshotLoadKey(base)).toBe(
      'parent1|sepolia|wargame|2|0xabc|c:0xcap|r:0xcrew',
    );
  });

  it('treats wearer order as irrelevant', () => {
    const a = aclSnapshotLoadKey({
      ...base,
      captainWearers: ['0xB', '0xA'],
      crewWearers: ['0xD', '0xC'],
    });
    const b = aclSnapshotLoadKey({
      ...base,
      captainWearers: ['0xa', '0xb'],
      crewWearers: ['0xc', '0xd'],
    });
    expect(a).toBe(b);
  });

  it('changes when myAddress or a wearer list changes', () => {
    const start = aclSnapshotLoadKey(base);
    expect(aclSnapshotLoadKey({ ...base, myAddress: '0xdef' })).not.toBe(start);
    expect(aclSnapshotLoadKey({ ...base, crewWearers: ['0xcrew', '0xnew'] })).not.toBe(start);
    expect(aclSnapshotLoadKey({ ...base, warGameStack: false })).toContain('|nave|');
  });
});

describe('aclSnapshotShouldRetry', () => {
  const crew = '0xcrew';
  const captain = '0xcap';

  it('retries only when the address is in a wearer list and the snap flag is false', () => {
    expect(
      aclSnapshotShouldRetry({
        snapshot: { wearsCaptain: false, wearsCrew: false },
        myAddress: crew,
        captainWearers: [captain],
        crewWearers: [crew],
      }),
    ).toBe(true);
    expect(
      aclSnapshotShouldRetry({
        snapshot: { wearsCaptain: false, wearsCrew: false },
        myAddress: captain,
        captainWearers: [captain],
        crewWearers: [crew],
      }),
    ).toBe(true);
    expect(
      aclSnapshotShouldRetry({
        snapshot: { wearsCaptain: false, wearsCrew: true },
        myAddress: crew,
        captainWearers: [],
        crewWearers: [crew],
      }),
    ).toBe(false);
    expect(
      aclSnapshotShouldRetry({
        snapshot: { wearsCaptain: true, wearsCrew: false },
        myAddress: captain,
        captainWearers: [captain],
        crewWearers: [],
      }),
    ).toBe(false);
  });

  it('does not retry without a snapshot, address, or list hit', () => {
    expect(
      aclSnapshotShouldRetry({
        snapshot: null,
        myAddress: crew,
        crewWearers: [crew],
      }),
    ).toBe(false);
    expect(
      aclSnapshotShouldRetry({
        snapshot: { wearsCaptain: false, wearsCrew: false },
        myAddress: '',
        crewWearers: [crew],
      }),
    ).toBe(false);
    expect(
      aclSnapshotShouldRetry({
        snapshot: { wearsCaptain: false, wearsCrew: false },
        myAddress: crew,
        captainWearers: [captain],
        crewWearers: [],
      }),
    ).toBe(false);
  });
});
