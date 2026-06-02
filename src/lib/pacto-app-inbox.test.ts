import { describe, expect, it } from 'vitest';
import {
  filterPeerThreadMessages,
  isPactoAppRoutableInviteContent,
  isPactoAppThreadId,
  mergePactoAppInboxEntry,
  resolveInviteInviterNpub,
} from './pacto-app-inbox';

describe('isPactoAppThreadId', () => {
  it('matches synthetic thread id', () => {
    expect(isPactoAppThreadId('__pacto_app__')).toBe(true);
    expect(isPactoAppThreadId('npub1abc')).toBe(false);
  });
});

describe('isPactoAppRoutableInviteContent', () => {
  it('detects squad and squad-pair invites', () => {
    expect(
      isPactoAppRoutableInviteContent(
        JSON.stringify({ type: 'squad_invite', squadName: 'A', groupId: 'g1', kind: 'squad-pair' })
      )
    ).toBe(true);
    expect(isPactoAppRoutableInviteContent('hello')).toBe(false);
  });
});

describe('filterPeerThreadMessages', () => {
  it('removes invite payloads from peer threads', () => {
    const invite = {
      id: '1',
      content: JSON.stringify({ type: 'squad_invite', squadName: 'S', groupId: 'g' }),
      at: 1,
      mine: false,
    };
    const text = { id: '2', content: 'hi', at: 2, mine: false };
    expect(filterPeerThreadMessages([invite, text])).toEqual([text]);
  });
});

describe('resolveInviteInviterNpub', () => {
  it('prefers invitedByNpub on payload', () => {
    const npub = resolveInviteInviterNpub(
      { id: 'm', content: '', at: 0, mine: false },
      'npubPeer',
      JSON.stringify({
        type: 'squad_invite',
        squadName: 'S',
        groupId: 'g',
        invitedByNpub: 'npubInviter',
      })
    );
    expect(npub).toBe('npubInviter');
  });
});

describe('mergePactoAppInboxEntry', () => {
  it('dedupes by message id', () => {
    const entry = { id: 'a', content: 'x', at: 1, mine: false, inviterNpub: 'n' };
    expect(mergePactoAppInboxEntry([entry], entry)).toHaveLength(1);
    expect(mergePactoAppInboxEntry([], entry)).toEqual([entry]);
  });
});
