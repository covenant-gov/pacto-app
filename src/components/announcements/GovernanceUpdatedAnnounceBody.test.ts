// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import GovernanceUpdatedAnnounceBody from './GovernanceUpdatedAnnounceBody.svelte';
import { profiles } from '../../stores/profiles';
import type { GovernanceUpdatedPayload } from '../../lib/announcements';

afterEach(() => {
  cleanup();
  profiles.set({});
});

describe('GovernanceUpdatedAnnounceBody', () => {
  it('renders a provider summary, network, and shortened contract address with an explorer link', () => {
    const payload: GovernanceUpdatedPayload = {
      parent_id: 'squad-1',
      provider: 'squad_admin',
      canonical_ref: '0x1111111111111111111111111111111111111111',
      chain: 'sepolia',
    };
    render(GovernanceUpdatedAnnounceBody, {
      props: { payload, authorName: 'Alice', timestamp: '2026-01-01T00:00:00.000Z' },
    });
    expect(screen.getByText('Alice deployed Squad Admin')).toBeTruthy();
    expect(screen.getByText('Sepolia')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'View on sepolia.etherscan.io' });
    expect(link.getAttribute('href')).toContain('0x1111111111111111111111111111111111111111');
  });

  it('picks up a display name from the profiles store when the store updates after mount, without a prop change', async () => {
    const payload: GovernanceUpdatedPayload = {
      parent_id: 'squad-1',
      provider: 'pacto_gov',
      canonical_ref: '0x2222222222222222222222222222222222222222',
    };
    render(GovernanceUpdatedAnnounceBody, {
      props: { payload, authorName: '', authorNpub: 'npub1alice', timestamp: '' },
    });
    // No cached profile yet: getProfileDisplayName(undefined) resolves to 'Unknown', which wins over authorName/aMember.
    expect(screen.getByText('Unknown deployed Pacto Gov')).toBeTruthy();

    profiles.set({ npub1alice: { id: 'npub1alice', name: 'Alice' } as never });
    expect(await screen.findByText('Alice deployed Pacto Gov')).toBeTruthy();
  });

  it('does not render a transaction link when the provider payload carries no tx hash', () => {
    const payload: GovernanceUpdatedPayload = {
      parent_id: 'squad-1',
      provider: 'sponsor',
      canonical_ref: '0x3333333333333333333333333333333333333333',
    };
    render(GovernanceUpdatedAnnounceBody, { props: { payload, authorName: 'Bob', timestamp: '' } });
    expect(screen.queryByText('View deployment transaction')).toBeNull();
  });

  it('renders a transaction link when the provider payload carries a tx hash', () => {
    const payload: GovernanceUpdatedPayload = {
      parent_id: 'squad-1',
      provider: 'sponsor',
      canonical_ref: '0x4444444444444444444444444444444444444444',
      provider_payload: JSON.stringify({ txHash: '0xdeadbeef' }),
    };
    render(GovernanceUpdatedAnnounceBody, { props: { payload, authorName: 'Bob', timestamp: '' } });
    expect(screen.getByText('View deployment transaction')).toBeTruthy();
  });
});
