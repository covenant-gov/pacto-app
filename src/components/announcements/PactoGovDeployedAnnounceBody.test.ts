// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import PactoGovDeployedAnnounceBody from './PactoGovDeployedAnnounceBody.svelte';
import { profiles } from '../../stores/profiles';
import type { GovernanceUpdatedPayload } from '../../lib/announcements';

afterEach(() => {
  cleanup();
  profiles.set({});
});

describe('PactoGovDeployedAnnounceBody', () => {
  it('picks up a display name from the profiles store when the store updates after mount, without a prop change', async () => {
    const payload: GovernanceUpdatedPayload = {
      parent_id: 'squad-1',
      provider: 'pacto_gov',
      canonical_ref: '0x1111111111111111111111111111111111111111',
    };
    render(PactoGovDeployedAnnounceBody, {
      props: { payload, authorName: '', authorNpub: 'npub1alice', timestamp: '' },
    });
    // No cached profile yet: getProfileDisplayName(undefined) resolves to 'Unknown', which wins over authorName/aMember.
    expect(screen.getByText('Unknown deployed Pacto Gov')).toBeTruthy();

    profiles.set({ npub1alice: { id: 'npub1alice', name: 'Alice' } as never });
    expect(await screen.findByText('Alice deployed Pacto Gov')).toBeTruthy();
  });

  it('renders the network label for a payload with chain set', () => {
    const payload: GovernanceUpdatedPayload = {
      parent_id: 'squad-1',
      provider: 'pacto_gov',
      canonical_ref: '0x2222222222222222222222222222222222222222',
      chain: 'mainnet',
    };
    render(PactoGovDeployedAnnounceBody, { props: { payload, authorName: 'Bob', timestamp: '' } });
    expect(screen.getByText('Ethereum')).toBeTruthy();
  });

  it('defaults the network label to Sepolia when the payload carries no chain', () => {
    const payload: GovernanceUpdatedPayload = {
      parent_id: 'squad-1',
      provider: 'pacto_gov',
      canonical_ref: '0x3333333333333333333333333333333333333333',
    };
    render(PactoGovDeployedAnnounceBody, { props: { payload, authorName: 'Carol', timestamp: '' } });
    expect(screen.getByText('Sepolia')).toBeTruthy();
  });
});
