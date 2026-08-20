// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import SignerShareAnnounceBody from './SignerShareAnnounceBody.svelte';
import { currentUser } from '../../stores/auth';
import type { SquadMemberEvmSharePayload } from '../../lib/announcements';

afterEach(() => {
  cleanup();
  currentUser.set(null);
});

describe('SignerShareAnnounceBody', () => {
  it('renders the first-person summary when the announcing author is the current user', () => {
    currentUser.set({ npub: 'npub1alice', pubkey: 'pk' });
    const payload: SquadMemberEvmSharePayload = {
      parent_id: 'squad-1',
      evm_address: '0x1111111111111111111111111111111111111111',
    };
    render(SignerShareAnnounceBody, {
      props: { payload, authorName: 'Alice', authorNpub: 'npub1alice', timestamp: '' },
    });
    expect(screen.getByText('You updated your EVM key for this Squad')).toBeTruthy();
  });

  it('renders the third-person summary with the author name when the announcing author is not the current user', () => {
    currentUser.set({ npub: 'npub1alice', pubkey: 'pk' });
    const payload: SquadMemberEvmSharePayload = {
      parent_id: 'squad-1',
      evm_address: '0x2222222222222222222222222222222222222222',
    };
    render(SignerShareAnnounceBody, {
      props: { payload, authorName: 'Bob', authorNpub: 'npub1bob', timestamp: '' },
    });
    expect(screen.getByText('Bob updated their EVM key for this Squad')).toBeTruthy();
  });

  it('flips the summary from third-person to first-person when the current user store updates after mount, without a prop change', async () => {
    currentUser.set(null);
    const payload: SquadMemberEvmSharePayload = {
      parent_id: 'squad-1',
      evm_address: '0x3333333333333333333333333333333333333333',
    };
    render(SignerShareAnnounceBody, {
      props: { payload, authorName: 'Carol', authorNpub: 'npub1carol', timestamp: '' },
    });
    expect(screen.getByText('Carol updated their EVM key for this Squad')).toBeTruthy();

    currentUser.set({ npub: 'npub1carol', pubkey: 'pk' });
    expect(await screen.findByText('You updated your EVM key for this Squad')).toBeTruthy();
  });
});
