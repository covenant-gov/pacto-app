import { describe, expect, it } from 'vitest';
import { crewHatLookupAddress, squadMemberEvmForDisplay } from './squad-roster-key-choice';

describe('squadMemberEvmForDisplay', () => {
  const me = 'npub1me';
  const peer = 'npub1peer';
  const map = {
    [me]: '0xorphan',
    [peer]: '0xpeer',
  };

  it('omits self when key choice is still needed', () => {
    expect(squadMemberEvmForDisplay(map, me, true)).toEqual({ [peer]: '0xpeer' });
  });

  it('keeps self when bound', () => {
    expect(squadMemberEvmForDisplay(map, me, false)).toEqual(map);
  });
});

describe('crewHatLookupAddress', () => {
  const me = 'npub1me';
  const peer = 'npub1peer';

  it('uses the raw roster address when present', () => {
    expect(
      crewHatLookupAddress({
        npub: peer,
        rawRosterEvmByNpub: { [peer]: '0xpeer' },
        viewerNpub: me,
        viewerBindAddress: '0xbind',
      }),
    ).toBe('0xpeer');
  });

  it('falls back to the viewer bind for self when the roster row is missing', () => {
    expect(
      crewHatLookupAddress({
        npub: me,
        rawRosterEvmByNpub: {},
        viewerNpub: me,
        viewerBindAddress: '0xbind',
      }),
    ).toBe('0xbind');
  });

  it('does not apply the viewer bind to other members', () => {
    expect(
      crewHatLookupAddress({
        npub: peer,
        rawRosterEvmByNpub: {},
        viewerNpub: me,
        viewerBindAddress: '0xbind',
      }),
    ).toBe('');
  });
});
