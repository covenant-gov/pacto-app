// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import JoinInboxAnnounceCard from './JoinInboxAnnounceCard.svelte';
import { currentUser } from '../../stores/auth';
import type { JoinInboxAnnounceMessage } from '../../lib/squad/join-inbox-announce';

describe('JoinInboxAnnounceCard', () => {
  afterEach(() => {
    cleanup();
    currentUser.set(null);
  });

  it('renders meta roster for the author', () => {
    currentUser.set({ npub: 'npub1alice' });
    const announce: JoinInboxAnnounceMessage = {
      kind: 'meta',
      payload: {
        squadId: 'squad-1',
        inboxNpub: 'npub1inbox',
        holders: ['npub1alice', 'npub1bob'],
        keyEpoch: 3,
        updatedAt: 0,
      },
    };
    render(JoinInboxAnnounceCard, { props: { announce, authorNpub: 'npub1alice', timestamp: '' } });
    expect(screen.getByText('You updated the Join inbox holders')).toBeTruthy();
  });

  it('renders meta roster for another author', () => {
    currentUser.set({ npub: 'npub1alice' });
    const announce: JoinInboxAnnounceMessage = {
      kind: 'meta',
      payload: {
        squadId: 'squad-1',
        inboxNpub: 'npub1inbox',
        holders: ['npub1bob'],
        keyEpoch: 1,
        updatedAt: 0,
      },
    };
    render(JoinInboxAnnounceCard, {
      props: { announce, authorName: 'Bob', authorNpub: 'npub1bob', timestamp: '' },
    });
    expect(screen.getByText('Bob updated the Join inbox holders')).toBeTruthy();
  });

  it('renders key rotated notice', () => {
    currentUser.set({ npub: 'npub1alice' });
    const announce: JoinInboxAnnounceMessage = {
      kind: 'key_rotated',
      payload: {
        squadId: 'squad-1',
        inboxNpub: 'npub1inbox',
        keyEpoch: 4,
        rotatedByNpub: 'npub1alice',
        updatedAt: 0,
      },
    };
    render(JoinInboxAnnounceCard, { props: { announce, authorNpub: 'npub1alice', timestamp: '' } });
    expect(screen.getByText('You rotated the Join inbox key')).toBeTruthy();
  });
});
