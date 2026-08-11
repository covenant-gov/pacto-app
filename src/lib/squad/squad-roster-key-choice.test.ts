import { describe, expect, it } from 'vitest';
import { squadMemberEvmForDisplay } from './squad-roster-key-choice';

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
