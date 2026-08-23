<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  const tFn = get(t);
  import { getProfileAvatarSrc, getProfileDisplayName } from '../../../lib/utils/profile';
  import { profiles } from '../../../stores/profiles';
  import { currentUser } from '../../../stores/auth';
  import {
    needsSquadRosterKeyChoice,
    squadMemberEvmForDisplay,
  } from '../../../lib/squad/squad-roster-key-choice';
  import { npubByEvmAddressFromSquadRoster, shortEvmAddress as shortAddress } from '../../../lib/governance/hats-tree-annotations';
  import {
    crewRosterEligibilityColumns,
    permittedByAddressFromExtStatus,
  } from '../../../lib/governance/squad-sponsor-crew';
  import {
    squadSponsorSetPermittedAddress,
    type SquadSponsorExtStatusDto,
  } from '../../../lib/governance/api';
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { copyTextToClipboard } from '../../../lib/wallet/clipboard-copy';
  import { showToast } from '../../../stores/toast';
  import { onMount } from 'svelte';
  import RpcReadErrorCard from './RpcReadErrorCard.svelte';
  import { rpcReadErrorKind } from '../../../lib/squad/rpc-read-error';

  let {
    announcementsGroupId = null,
    channelMembers = [],
    loadingMembers = false,
    settingsChainError = '',
    settingsChainLoading = false,
    settingsChainRefreshing = false,
    squadMemberEvmByNpub = {},
    memberHatByAddress = {},
    memberRolesByAddress = {},
    sponsorExtStatus = null,
    sponsorExtLoading = false,
    sponsorExtError = '',
    sponsorNetwork = '',
    parentId = '',
    onRefreshSponsorExt = () => {},
    sponsorHatsMode = false,
    hasSponsor = false,
  }: {
    announcementsGroupId?: string | null;
    channelMembers?: string[];
    loadingMembers?: boolean;
    settingsChainError?: string;
    settingsChainLoading?: boolean;
    settingsChainRefreshing?: boolean;
    squadMemberEvmByNpub?: Record<string, string>;
    memberHatByAddress?: Record<string, string>;
    memberRolesByAddress?: Record<string, string>;
    /** Sponsor Ext eligibility (null when no Ext sponsor / not loaded). */
    sponsorExtStatus?: SquadSponsorExtStatusDto | null;
    sponsorExtLoading?: boolean;
    sponsorExtError?: string;
    sponsorNetwork?: string;
    parentId?: string;
    onRefreshSponsorExt?: () => void;
    /** Hats-linked sponsor: eligibility from captain/crew wear. */
    sponsorHatsMode?: boolean;
    hasSponsor?: boolean;
  } = $props();

  let sponsoringAddress = $state('');
  let rosterKeyNeeded = $state(false);

  const myNpub = $derived($currentUser?.npub ?? '');
  const displayEvmByNpub = $derived(squadMemberEvmForDisplay(squadMemberEvmByNpub, myNpub, rosterKeyNeeded));
  const myRosterEvm = $derived((myNpub ? displayEvmByNpub[myNpub]?.trim() : '') || '');
  const npubByAddress = $derived(npubByEvmAddressFromSquadRoster(displayEvmByNpub));
  const permittedByAddress = $derived(permittedByAddressFromExtStatus(sponsorExtStatus?.memberPermits ?? []));
  const addressOwner = $derived(sponsorExtStatus?.addressOwner?.trim().toLowerCase() ?? '');
  const ownerNpub = $derived(addressOwner ? npubByAddress[addressOwner] : undefined);
  const iAmSponsorOwner = $derived(
    !!addressOwner && !!myRosterEvm && myRosterEvm.toLowerCase() === addressOwner,
  );
  const hatsWired = $derived(sponsorExtStatus?.hatsWired === true);
  const canManagePermits = $derived(iAmSponsorOwner && !hatsWired && !!sponsorNetwork && !!parentId);
  const eligibilityCols = $derived(
    crewRosterEligibilityColumns({ hasSponsor, sponsorHatsMode, hatsWired }),
  );
  const showHatsCol = $derived(eligibilityCols.showHatsCol);
  const showSponsoredCol = $derived(eligibilityCols.showSponsoredCol);
  const sponsorExtRpcKind = $derived(rpcReadErrorKind(sponsorExtError));
  const settingsChainRpcKind = $derived(rpcReadErrorKind(settingsChainError));

  onMount(() => {
    if (!parentId) return;
    void needsSquadRosterKeyChoice(parentId, announcementsGroupId).then((needed) => {
      rosterKeyNeeded = needed;
    });
  });

  async function copyEvmAddress(address: string) {
    const t = address.trim();
    if (!t) return;
    const ok = await copyTextToClipboard(t);
    showToast(ok ? tFn('governance.crew.toastAddressCopied') : tFn('governance.crew.toastCopyFailed'));
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
      showToast(tFn('governance.crew.toastMemberSponsored'));
      onRefreshSponsorExt();
    } catch (e) {
      showToast(getInvokeErrorMessage(e, tFn('governance.crew.toastSponsorFailed')));
    } finally {
      sponsoringAddress = '';
    }
  }
</script>

{#if sponsorExtStatus || sponsorExtLoading || sponsorExtError}
  <section class="sponsor-owner-banner" aria-label={$t('governance.crew.sponsorOwnerAriaLabel')}>
    <span class="meta-label">{$t('governance.crew.sponsorOwnerLabel')}</span>
    {#if sponsorExtLoading && !sponsorExtStatus}
      <span class="muted">{$t('governance.crew.loading')}</span>
    {:else if sponsorExtError && !sponsorExtStatus}
      {#if sponsorExtRpcKind}
        <RpcReadErrorCard kind={sponsorExtRpcKind} />
      {:else}
        <span class="chain-read-error" role="alert">{sponsorExtError}</span>
      {/if}
    {:else if sponsorExtStatus}
      {#if addressOwner}
      <span class="sponsor-owner-value">{ownerLabel()}</span>
    {:else}
      <span class="sponsor-owner-value">{$t('governance.crew.unknown')}</span>
    {/if}
      {#if hatsWired}
        <span class="muted sponsor-owner-hint">{$t('governance.crew.hatsWired')}</span>
      {:else if iAmSponsorOwner}
        <span class="muted sponsor-owner-hint">{$t('governance.crew.canPermit')}</span>
      {/if}
    {/if}
  </section>
{/if}

<section class="dashboard-section" aria-labelledby="crew-roster-heading">
  <h3 id="crew-roster-heading" class="section-heading">{$t('governance.crew.sectionCrew')}</h3>

  {#if settingsChainRefreshing}
    <p class="muted" role="status">{$t('governance.crew.refreshing')}</p>
  {/if}
  {#if settingsChainError}
    {#if settingsChainRpcKind}
      <RpcReadErrorCard kind={settingsChainRpcKind} />
    {:else}
      <p class="chain-read-error" role="alert">{settingsChainError}</p>
    {/if}
  {/if}

  {#if announcementsGroupId}
    {#if loadingMembers && channelMembers.length === 0}
      <p class="muted">{$t('governance.crew.loadingMembers')}</p>
    {:else if channelMembers.length > 0}
      <ul class="roles-member-list" role="list">
        {#each channelMembers as memberNpub (memberNpub)}
          {@const npub = memberNpub as string}
          {@const rosterEvm = displayEvmByNpub[npub]}
          {@const rosterKey = rosterEvm?.trim().toLowerCase() ?? ''}
          {@const avatarSrc = getProfileAvatarSrc($profiles[npub])}
          {@const isExtSponsored = rosterKey ? permittedByAddress[rosterKey] === true : false}
          {@const showSponsorBtn =
            showSponsoredCol && !!sponsorExtStatus && !hatsWired && !!rosterEvm && !isExtSponsored}
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
              <span class="roles-col-label">{$t('governance.crew.colEvm')}</span>
              {#if rosterEvm}
                <span class="roles-col-value roles-col-evm">
                  <code class="roles-evm-addr" title={rosterEvm}>{shortAddress(rosterEvm)}</code>
                  <button
                    type="button"
                    class="roles-evm-copy-btn"
                    aria-label={$t('governance.crew.copyEvmAddress')}
                    title={$t('governance.crew.copyAddress')}
                    onclick={() => void copyEvmAddress(rosterEvm)}
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
                <span class="roles-col-value muted">{$t('governance.crew.notShared')}</span>
              {/if}
              {#if showHatsCol}
                <span class="roles-col-label">{$t('governance.crew.colHats')}</span>
                <span
                  class="roles-col-value"
                  class:muted={!rosterEvm || !memberHatByAddress[rosterEvm.toLowerCase()]}
                  >{settingsChainLoading && !memberHatByAddress[rosterEvm?.toLowerCase() ?? '']
                    ? $t('governance.crew.loadingShort')
                    : rosterEvm
                      ? memberHatByAddress[rosterEvm.toLowerCase()] || $t('governance.crew.dash')
                      : $t('governance.crew.notShared')}
                </span>
              {/if}
              <span class="roles-col-label">{$t('governance.crew.colPrivileges')}</span>
              <span
                class="roles-col-value"
                class:muted={!rosterEvm || !memberRolesByAddress[rosterEvm.toLowerCase()]}
                >{settingsChainLoading && !memberRolesByAddress[rosterEvm?.toLowerCase() ?? '']
                  ? $t('governance.crew.loadingShort')
                  : rosterEvm
                    ? memberRolesByAddress[rosterEvm.toLowerCase()] || $t('governance.crew.dash')
                    : $t('governance.crew.notShared')}
                </span
              >
              {#if showSponsoredCol}
                <span class="roles-col-label">{$t('governance.crew.colSponsored')}</span>
                {#if !rosterEvm}
                  <span class="roles-col-value muted">{$t('governance.crew.notShared')}</span>
                {:else if !sponsorHatsMode && sponsorExtLoading && permittedByAddress[rosterKey] === undefined}
                  <span class="roles-col-value muted">{$t('governance.crew.loading')}</span>
                {:else if isExtSponsored}
                  <span class="roles-col-value">{$t('governance.crew.sponsoredYes')}</span>
                {:else if showSponsorBtn}
                  <span class="roles-col-value roles-col-sponsored">
                    <button
                      type="button"
                      class="sponsor-btn"
                      disabled={!canManagePermits || sponsoringAddress === rosterKey}
                      title={!canManagePermits
                        ? hatsWired
                          ? $t('governance.crew.titleHatsWired')
                          : $t('governance.crew.titleOnlyOwner')
                        : $t('governance.crew.titlePermit')}
                      onclick={() => void sponsorMember(rosterEvm)}
                    >
                      {sponsoringAddress === rosterKey ? $t('governance.crew.sponsoring') : $t('governance.crew.sponsorBtn')}
                    </button>
                  </span>
                {:else}
                  <span class="roles-col-value">{$t('governance.crew.sponsoredNo')}</span>
                {/if}
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">{$t('governance.crew.noMembers')}</p>
    {/if}
  {:else}
    <p class="muted">{$t('governance.crew.noChannel')}</p>
  {/if}
</section>

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
    background: var(--bg-hover);
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
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .sponsor-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .meta-label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    min-width: 5.5rem;
  }
</style>
