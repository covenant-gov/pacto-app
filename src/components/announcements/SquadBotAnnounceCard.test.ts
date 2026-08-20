// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import SquadBotAnnounceCard from './SquadBotAnnounceCard.svelte';
import { currentUser } from '../../stores/auth';
import type { SquadBotAnnounceMessage } from '../../lib/squad/squad-bot-announce';

afterEach(() => {
  cleanup();
  currentUser.set(null);
});

describe('SquadBotAnnounceCard', () => {
  it('renders a first-person roster title and holder count for the current user\'s own meta update', () => {
    currentUser.set({ npub: 'npub1alice', pubkey: 'pk' });
    const announce: SquadBotAnnounceMessage = {
      kind: 'meta',
      payload: { squadId: 'squad-1', botNpub: 'npub1bot', holders: ['npub1alice', 'npub1bob'], keyEpoch: 3, updatedAt: 0 },
    };
    render(SquadBotAnnounceCard, { props: { announce, authorNpub: 'npub1alice', timestamp: '' } });
    expect(screen.getByText('You updated the Join inbox holders')).toBeTruthy();
    expect(screen.getByText('2 holders')).toBeTruthy();
    expect(screen.getByText('Key epoch 3')).toBeTruthy();
  });

  it('renders a third-person roster title for another member\'s meta update', () => {
    currentUser.set({ npub: 'npub1alice', pubkey: 'pk' });
    const announce: SquadBotAnnounceMessage = {
      kind: 'meta',
      payload: { squadId: 'squad-1', botNpub: 'npub1bot', holders: ['npub1bob'], keyEpoch: 1, updatedAt: 0 },
    };
    render(SquadBotAnnounceCard, { props: { announce, authorName: 'Bob', authorNpub: 'npub1bob', timestamp: '' } });
    expect(screen.getByText('Bob updated the Join inbox holders')).toBeTruthy();
  });

  it('renders the key-rotated title for the current user', () => {
    currentUser.set({ npub: 'npub1alice', pubkey: 'pk' });
    const announce: SquadBotAnnounceMessage = {
      kind: 'key_rotated',
      payload: { squadId: 'squad-1', botNpub: 'npub1bot', keyEpoch: 4, rotatedByNpub: 'npub1alice', updatedAt: 0 },
    };
    render(SquadBotAnnounceCard, { props: { announce, authorNpub: 'npub1alice', timestamp: '' } });
    expect(screen.getByText('You rotated the Join inbox key')).toBeTruthy();
    expect(screen.getByText('Key epoch 4')).toBeTruthy();
    // holderCount is null for key_rotated: no holders line rendered.
    expect(screen.queryByText(/holders?$/)).toBeNull();
  });

  it('recomputes every derived field from the new payload on rerender, not the previous render\'s values', async () => {
    currentUser.set({ npub: 'npub1alice', pubkey: 'pk' });
    const { rerender } = render(SquadBotAnnounceCard, {
      props: {
        announce: {
          kind: 'meta',
          payload: { squadId: 'squad-1', botNpub: 'npub1bot', holders: ['npub1bob'], keyEpoch: 1, updatedAt: 0 },
        } satisfies SquadBotAnnounceMessage,
        authorNpub: 'npub1alice',
        timestamp: '',
      },
    });
    expect(screen.getByText('1 holder')).toBeTruthy();

    await rerender({
      announce: {
        kind: 'meta',
        payload: { squadId: 'squad-1', botNpub: 'npub1bot', holders: ['npub1bob', 'npub1carol', 'npub1dave'], keyEpoch: 2, updatedAt: 0 },
      } satisfies SquadBotAnnounceMessage,
      authorNpub: 'npub1alice',
      timestamp: '',
    });
    expect(screen.getByText('3 holders')).toBeTruthy();
    expect(screen.getByText('Key epoch 2')).toBeTruthy();
    expect(screen.queryByText('1 holder')).toBeNull();
  });
});
