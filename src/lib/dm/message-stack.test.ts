import { describe, it, expect } from 'vitest';
import {
  plainMessageStackAuthorKey,
  shouldStackWithPrevious,
  shouldStackChannelWithPrevious,
} from './message-stack';
import type { DmMessage } from '../../stores/dm';

function msg(partial: Partial<DmMessage> & Pick<DmMessage, 'id' | 'content' | 'at' | 'mine'>): DmMessage {
  return { ...partial };
}

describe('message-stack', () => {
  it('keys plain mine / peer messages', () => {
    expect(plainMessageStackAuthorKey(msg({ id: '1', content: 'hi', at: 1, mine: true }))).toBe(
      '__mine__'
    );
    expect(
      plainMessageStackAuthorKey(
        msg({ id: '2', content: 'yo', at: 2, mine: false, npub: 'npub1peer' })
      )
    ).toBe('npub1peer');
  });

  it('returns null for non-plain rows', () => {
    expect(
      plainMessageStackAuthorKey(
        msg({
          id: '3',
          content: '{"version":1,"type":"wallet_peer_info_decline","request_id":"r"}',
          at: 3,
          mine: true,
        })
      )
    ).toBeNull();
  });

  it('stacks consecutive plain messages from the same author', () => {
    const a = msg({ id: '1', content: 'one', at: 1000, mine: true });
    const b = msg({ id: '2', content: 'two', at: 2000, mine: true });
    expect(shouldStackWithPrevious(a, b)).toBe(true);
  });

  it('does not stack across authors', () => {
    const a = msg({ id: '1', content: 'one', at: 1000, mine: true });
    const b = msg({ id: '2', content: 'two', at: 2000, mine: false, npub: 'npub1x' });
    expect(shouldStackWithPrevious(a, b)).toBe(false);
  });

  it('does not stack after a non-plain message', () => {
    const card = msg({
      id: '1',
      content: '{"version":1,"type":"wallet_peer_info_decline","request_id":"r"}',
      at: 1000,
      mine: true,
    });
    const plain = msg({ id: '2', content: 'hi', at: 2000, mine: true });
    expect(shouldStackWithPrevious(card, plain)).toBe(false);
  });

  it('breaks the stack when the time gap is too large', () => {
    const a = msg({ id: '1', content: 'one', at: 1000, mine: true });
    const b = msg({ id: '2', content: 'later', at: 1000 + 6 * 60 * 1000, mine: true });
    expect(shouldStackWithPrevious(a, b)).toBe(false);
  });

  it('channel helper skips non-stackable rows', () => {
    const a = msg({ id: '1', content: 'one', at: 1000, mine: true });
    const b = msg({ id: '2', content: 'two', at: 2000, mine: true });
    expect(shouldStackChannelWithPrevious(a, b, () => false)).toBe(true);
    expect(shouldStackChannelWithPrevious(a, b, (m) => m.id === '1')).toBe(false);
  });
});
