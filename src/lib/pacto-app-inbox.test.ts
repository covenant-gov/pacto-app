import { describe, expect, it } from 'vitest';
import { resolveInviteInviterNpub } from './pacto-app-inbox';

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

  it('falls back to the message sender npub when payload has none', () => {
    const npub = resolveInviteInviterNpub(
      { id: 'm', content: '', at: 0, mine: false, npub: 'npubSender' },
      'npubPeer',
      JSON.stringify({ type: 'squad_invite', squadName: 'S', groupId: 'g' })
    );
    expect(npub).toBe('npubSender');
  });

  it('falls back to the peer npub when payload and message have neither', () => {
    const npub = resolveInviteInviterNpub(
      { id: 'm', content: '', at: 0, mine: false },
      'npubPeer',
      'not an invite'
    );
    expect(npub).toBe('npubPeer');
  });
});
