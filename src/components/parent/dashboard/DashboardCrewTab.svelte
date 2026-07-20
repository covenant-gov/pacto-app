<script lang="ts">
  import SquadJoinRequestsPanel from '../../squad/SquadJoinRequestsPanel.svelte';
  import { getProfileAvatarSrc, getProfileDisplayName } from '../../../lib/utils/profile';
  import { profiles } from '../../../stores/profiles';
  import type { Squad } from '../../../stores/squads';
  import { currentUser } from '../../../stores/auth';
  import { npubByEvmAddressFromSquadRoster } from '../../../lib/governance/hats-tree-annotations';
  import {
    isHatsSponsoredAddress,
    permittedByAddressFromExtStatus,
  } from '../../../lib/governance/squad-sponsor-crew';
  import {
    squadSponsorSetPermittedAddress,
    type SquadSponsorExtStatusDto,
  } from '../../../lib/governance/api';
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { copyTextToClipboard } from '../../../lib/wallet/clipboard-copy';
  import { showToast } from '../../../stores/toast';

  export let squad: Squad;
  export let announcementsGroupId: string | null = null;
  export let channelMembers: string[] = [];
  export let loadingMembers = false;
  export let settingsChainError = '';
  export let settingsChainLoading = false;
  export let settingsChainRefreshing = false;
  export let squadMemberEvmByNpub: Record<string, string> = {};
  export let memberHatByAddress: Record<string, string> = {};
  export let memberRolesByAddress: Record<string, string> = {};
  export let onOpenSquadRolesModal: () => void = () => {};
  export let showManagePrivileges = false;
  export let pactoGovRevision = '';

  /** Sponsor Ext eligibility (null when no Ext sponsor / not loaded). */
  export let sponsorExtStatus: SquadSponsorExtStatusDto | null = null;
  export let sponsorExtLoading = false;
  export let sponsorExtError = '';
  export let sponsorNetwork = '';
  export let parentId = '';
  export let onRefreshSponsorExt: () => void = () => {};
  /** Hats-linked sponsor: eligibility from captain/crew wear. */
  export let sponsorHatsMode = false;
  export let hasSponsor = false;
  export let captainWearers: string[] = [];
  export let crewWearers: string[] = [];

  let sponsoringAddress = '';

  $: myNpub = $currentUser?.npub ?? '';
  $: myRosterEvm = (myNpub ? squadMemberEvmByNpub[myNpub]?.trim() : '') || '';
  $: npubByAddress = npubByEvmAddressFromSquadRoster(squadMemberEvmByNpub);
  $: permittedByAddress = permittedByAddressFromExtStatus(sponsorExtStatus?.memberPermits ?? []);
  $: addressOwner = sponsorExtStatus?.addressOwner?.trim().toLowerCase() ?? '';
  $: ownerNpub = addressOwner ? npubByAddress[addressOwner] : undefined;
  $: iAmSponsorOwner =
    !!addressOwner && !!myRosterEvm && myRosterEvm.toLowerCase() === addressOwner;
  $: hatsWired = sponsorExtStatus?.hatsWired === true;
  $: canManagePermits = iAmSponsorOwner && !hatsWired && !!sponsorNetwork && !!parentId;
  $: showSponsoredCol = hasSponsor && (sponsorHatsMode || !!sponsorExtStatus || sponsorExtLoading || !!sponsorExtError);

  function shortAddress(addr: string): string {
    if (!addr || addr.length < 12) return addr;
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }

  async function copyEvmAddress(address: string) {
    const t = address.trim();
    if (!t) return;
    const ok = await copyTextToClipboard(t);
    showToast(ok ? 'Address copied' : 'Could not copy address');
  }

  function ownerLabel(): string {
    if (!addressOwner) return 'Unknown';
    if (ownerNpub) {
      const name = getProfileDisplayName($profiles[ownerNpub]);
      if (name) return `${name} (${shortAddress(addressOwner)})`;
    }
    return shortAddress(addressOwner);
  }

  async function sponsorMember(memberAddress: string) {
    if (!canManagePermits || sponsoringAddress || !parentId || !sponsorNetwork) return;
    sponsoringAddress = memberAddress.toLowerCase();
    try {
      await squadSponsorSetPermittedAddress({
        network: sponsorNetwork,
        parentId,
        memberAddress,
        permitted: true,
        sponsorAddress: sponsorExtStatus?.sponsorAddress ?? null,
      });
      showToast('Member sponsored.');
      onRefreshSponsorExt();
    } catch (e) {
      showToast(getInvokeErrorMessage(e, 'Sponsor failed.'));
    } finally {
      sponsoringAddress = '';
    }
  }
</script>

{#if sponsorHatsMode && hasSponsor}
  <section class="sponsor-owner-banner" aria-label="Squad sponsor">
    <span class="meta-label">Sponsor</span>
    <span class="sponsor-owner-value">Hats-linked</span>
    <span class="muted sponsor-owner-hint">Captain and crew hat wearers are eligible</span>
  </section>
{:else if sponsorExtStatus || sponsorExtLoading || sponsorExtError}
  <section class="sponsor-owner-banner" aria-label="Squad sponsor owner">
    <span class="meta-label">Sponsor owner</span>
    {#if sponsorExtLoading && !sponsorExtStatus}
      <span class="muted">Loading…</span>
    {:else if sponsorExtError && !sponsorExtStatus}
      <span class="chain-read-error" role="alert">{sponsorExtError}</span>
    {:else if sponsorExtStatus}
      <span class="sponsor-owner-value">{ownerLabel()}</span>
      {#if hatsWired}
        <span class="muted sponsor-owner-hint">Hats wired — address list closed</span>
      {:else if iAmSponsorOwner}
        <span class="muted sponsor-owner-hint">You can permit members</span>
      {/if}
    {/if}
  </section>
{/if}

<section class="dashboard-section" aria-labelledby="crew-roster-heading">
  <h3 id="crew-roster-heading" class="section-heading">Crew</h3>
  <p class="caption muted">Membership from #announcements (MLS). Hats and privileges may be empty.</p>

  {#if settingsChainRefreshing}
    <p class="muted" role="status">Refreshing on-chain member data…</p>
  {/if}
  {#if settingsChainError}
    <p class="chain-read-error" role="alert">{settingsChainError}</p>
  {/if}

  {#if announcementsGroupId}
    {#if loadingMembers && channelMembers.length === 0}
      <p class="muted">Loading members…</p>
    {:else if channelMembers.length > 0}
      <ul class="roles-member-list" role="list">
        {#each channelMembers as memberNpub (memberNpub)}
          {@const npub = memberNpub as string}
          {@const rosterEvm = squadMemberEvmByNpub[npub]}
          {@const rosterKey = rosterEvm?.trim().toLowerCase() ?? ''}
          {@const avatarSrc = getProfileAvatarSrc($profiles[npub])}
          {@const isHatsSponsored =
            sponsorHatsMode && isHatsSponsoredAddress(rosterEvm, captainWearers, crewWearers)}
          {@const isExtSponsored = rosterKey ? permittedByAddress[rosterKey] === true : false}
          {@const isSponsored = sponsorHatsMode ? isHatsSponsored : isExtSponsored}
          {@const showSponsorBtn =
            !sponsorHatsMode && !!sponsorExtStatus && !hatsWired && !!rosterEvm && !isSponsored}
          <li class="roles-member-row">
            {#if avatarSrc}
              <img src={avatarSrc} alt="" class="roles-member-avatar" />
            {:else}
              <div class="roles-member-avatar roles-member-avatar-ph" aria-hidden="true"></div>
            {/if}
            <div class="roles-member-meta">
              <span class="roles-member-name"
                >{getProfileDisplayName($profiles[npub]) ||
                  (npub.length > 20 ? npub.slice(0, 14) + '…' : npub)}</span
              >
              <code class="roles-member-npub"
                >{npub.length > 28 ? npub.slice(0, 14) + '…' + npub.slice(-8) : npub}</code
              >
            </div>
            <div class="roles-member-cols">
              <span class="roles-col-label">EVM</span>
              {#if rosterEvm}
                <span class="roles-col-value roles-col-evm">
                  <code class="roles-evm-addr" title={rosterEvm}>{shortAddress(rosterEvm)}</code>
                  <button
                    type="button"
                    class="roles-evm-copy-btn"
                    aria-label="Copy EVM address"
                    title="Copy address"
                    on:click={() => void copyEvmAddress(rosterEvm)}
                  >
                    <svg
                      class="roles-evm-copy-icon"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.75"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                </span>
              {:else}
                <span class="roles-col-value muted">Not shared</span>
              {/if}
              <span class="roles-col-label">Hats</span>
              <span
                class="roles-col-value"
                class:muted={!rosterEvm || !memberHatByAddress[rosterEvm.toLowerCase()]}
                >{settingsChainLoading && !memberHatByAddress[rosterEvm?.toLowerCase() ?? '']
                  ? 'Loading…'
                  : rosterEvm
                    ? memberHatByAddress[rosterEvm.toLowerCase()] || '—'
                    : 'Not shared'}</span
              >
              <span class="roles-col-label">Privileges</span>
              <span
                class="roles-col-value"
                class:muted={!rosterEvm || !memberRolesByAddress[rosterEvm.toLowerCase()]}
                >{settingsChainLoading && !memberRolesByAddress[rosterEvm?.toLowerCase() ?? '']
                  ? 'Loading…'
                  : rosterEvm
                    ? memberRolesByAddress[rosterEvm.toLowerCase()] || '—'
                    : 'Not shared'}</span
              >
              {#if showSponsoredCol}
                <span class="roles-col-label">Sponsored</span>
                {#if !rosterEvm}
                  <span class="roles-col-value muted">Not shared</span>
                {:else if !sponsorHatsMode && sponsorExtLoading && permittedByAddress[rosterKey] === undefined}
                  <span class="roles-col-value muted">Loading…</span>
                {:else if isSponsored}
                  <span class="roles-col-value">Yes</span>
                {:else if showSponsorBtn}
                  <span class="roles-col-value roles-col-sponsored">
                    <button
                      type="button"
                      class="sponsor-btn"
                      disabled={!canManagePermits || sponsoringAddress === rosterKey}
                      title={!canManagePermits
                        ? hatsWired
                          ? 'Hats wired'
                          : 'Only the sponsor owner can permit addresses'
                        : 'Permit this address for gas sponsorship'}
                      on:click={() => void sponsorMember(rosterEvm)}
                    >
                      {sponsoringAddress === rosterKey ? 'Sponsoring…' : 'Sponsor'}
                    </button>
                  </span>
                {:else}
                  <span class="roles-col-value">No</span>
                {/if}
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">No members loaded yet.</p>
    {/if}
  {:else}
    <p class="muted">No announcements channel for this squad.</p>
  {/if}
</section>

{#if showManagePrivileges || pactoGovRevision}
  <div class="privileges-row">
    <span class="meta-label">Privileges</span>
    {#if pactoGovRevision}
      <code class="rev">{pactoGovRevision}</code>
    {/if}
    {#if showManagePrivileges}
      <button type="button" class="btn-text" on:click={onOpenSquadRolesModal}>Manage</button>
    {/if}
  </div>
{/if}

{#if squad}
  <section class="join-requests-wrap" aria-label="Join requests">
    <SquadJoinRequestsPanel {squad} />
  </section>
{/if}

<style>
  .sponsor-owner-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 8px 0 12px;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 0.875rem;
  }
  .sponsor-owner-value {
    font-weight: 500;
    color: var(--text-primary);
  }
  .sponsor-owner-hint {
    font-size: 0.75rem;
  }
  .dashboard-section {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
  }
  .section-heading {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0 0 8px;
  }
  .caption {
    font-size: 0.8125rem;
    margin: 0 0 12px;
  }
  .muted {
    color: var(--text-muted);
    font-size: 0.875rem;
  }
  .chain-read-error {
    color: var(--danger, #c44);
    font-size: 0.875rem;
  }
  .roles-member-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    overflow: hidden;
  }
  .roles-member-row {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) minmax(0, 1.2fr);
    gap: 12px;
    align-items: center;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 0.8125rem;
  }
  .roles-member-row:last-child {
    border-bottom: none;
  }
  .roles-member-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
  }
  .roles-member-avatar-ph {
    background: var(--border);
  }
  .roles-member-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .roles-member-name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .roles-member-npub {
    font-size: 0.7rem;
    color: var(--text-muted);
    word-break: break-all;
  }
  .roles-member-cols {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 10px;
  }
  .roles-col-label {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }
  .roles-col-value {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }
  .roles-col-evm {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .roles-evm-addr {
    font: inherit;
    color: inherit;
  }
  .roles-evm-copy-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin: 0;
    padding: 2px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .roles-evm-copy-btn:hover {
    color: var(--text-primary);
    background: var(--bg-secondary, var(--bg-elevated));
  }
  .roles-evm-copy-icon {
    display: block;
  }
  .roles-col-sponsored {
    display: flex;
    align-items: center;
  }
  .sponsor-btn {
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .sponsor-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .privileges-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 8px 0 12px;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 0.875rem;
  }
  .meta-label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    min-width: 5.5rem;
  }
  .rev {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .btn-text {
    padding: 4px 8px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .join-requests-wrap {
    margin-top: 8px;
  }
</style>
