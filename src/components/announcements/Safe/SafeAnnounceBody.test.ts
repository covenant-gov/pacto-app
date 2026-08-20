// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import SafeAnnounceBody from './SafeAnnounceBody.svelte';
import { toastMessage } from '../../../stores/toast';
import { ANNOUNCE_TYPE_SAFE_UPDATED, ANNOUNCE_TYPE_SAFE_PROPOSAL } from '../../../lib/announcements';

afterEach(() => {
  cleanup();
  toastMessage.set(null);
});

describe('SafeAnnounceBody (safe_updated)', () => {
  const address = '0x1111111111111111111111111111111111111111';

  it('renders the deployment fields for a Safe deployed via factory (tx hash present)', () => {
    render(SafeAnnounceBody, {
      props: {
        announce: {
          type: ANNOUNCE_TYPE_SAFE_UPDATED,
          payload: { squad_id: 'squad-1', safe_address: address, chain: 'sepolia', tx_hash: '0xdeadbeef' },
        },
        authorName: 'Alice',
        timestamp: '',
      },
    });
    expect(screen.getByText('Safe deployed')).toBeTruthy();
    expect(screen.getByTitle(address)).toBeTruthy();
    expect(screen.getByTitle('0xdeadbeef')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View transaction' })).toBeTruthy();
  });

  it('renders the updated title (no deploy tx) for a Safe address change', () => {
    render(SafeAnnounceBody, {
      props: {
        announce: { type: ANNOUNCE_TYPE_SAFE_UPDATED, payload: { squad_id: 'squad-1', safe_address: address, chain: 'sepolia' } },
        authorName: 'Alice',
        timestamp: '',
      },
    });
    expect(screen.getByText('Safe address updated')).toBeTruthy();
    expect(screen.queryByText('Copy tx hash')).toBeNull();
  });

  it('re-derives the explorer links when the chain in the announce payload changes', async () => {
    const { rerender } = render(SafeAnnounceBody, {
      props: {
        announce: { type: ANNOUNCE_TYPE_SAFE_UPDATED, payload: { squad_id: 'squad-1', safe_address: address, chain: 'sepolia' } },
        authorName: 'Alice',
        timestamp: '',
      },
    });
    expect(screen.getByRole('link', { name: 'View on explorer' }).getAttribute('href')).toBe(
      `https://sepolia.etherscan.io/address/${address}`,
    );

    await rerender({
      announce: { type: ANNOUNCE_TYPE_SAFE_UPDATED, payload: { squad_id: 'squad-1', safe_address: address, chain: 'mainnet' } },
      authorName: 'Alice',
      timestamp: '',
    });
    expect(screen.getByRole('link', { name: 'View on explorer' }).getAttribute('href')).toBe(
      `https://etherscan.io/address/${address}`,
    );
  });

  it('copies the Safe address to the clipboard and shows a confirmation toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    render(SafeAnnounceBody, {
      props: {
        announce: { type: ANNOUNCE_TYPE_SAFE_UPDATED, payload: { squad_id: 'squad-1', safe_address: address, chain: 'sepolia' } },
        authorName: 'Alice',
        timestamp: '',
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Copy full Safe address' }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(address));
    await vi.waitFor(() => expect(get(toastMessage)?.text).toBe('Safe address copied'));

    vi.unstubAllGlobals();
  });
});

describe('SafeAnnounceBody (safe_proposal)', () => {
  it('renders the transfer detail and disabled sign/execute actions', () => {
    render(SafeAnnounceBody, {
      props: {
        announce: {
          type: ANNOUNCE_TYPE_SAFE_PROPOSAL,
          payload: {
            id: 'p1',
            parent_id: 'squad-1',
            to: '0x2222222222222222222222222222222222222222',
            amount: '2.5',
            token: 'ETH',
            proposer_npub: 'npub1bob',
          },
        },
        authorName: 'Bob',
        timestamp: '',
      },
    });
    expect(screen.getByText('Safe proposal')).toBeTruthy();
    expect(screen.getByText(/Send 2\.5 ETH to/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Sign' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Execute' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
