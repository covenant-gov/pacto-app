<script lang="ts">
  import { t } from 'svelte-i18n';
  import DashboardAssetCard from './DashboardAssetCard.svelte';
  import { get } from 'svelte/store';
  const tFn = get(t);
  import { onMount } from 'svelte';
  import { currentUser } from '../../../stores/auth';
  import { profiles } from '../../../stores/profiles';
  import { showToast } from '../../../stores/toast';
  import { getProfileDisplayName } from '../../../lib/utils/profile';
  import { copyTextToClipboard } from '../../../lib/wallet/clipboard-copy';
  import { requestSquadStateSync } from '../../../lib/squad/squad-state-sync';
  import {
    addJoinInboxHolder,
    canAddJoinInboxHolder,
    canManageJoinInboxHolders,
    getJoinInboxState,
    initJoinInbox,
    isJoinInboxHolderActionInFlight,
    reclaimJoinInboxIfSplit,
    removeJoinInboxHolder,
    rotateJoinInboxKey,
    joinInboxHolderActionInFlightRevision,
    type JoinInboxState,
  } from '../../../lib/squad/join-inbox';
  import { refreshMlsGroupMembers } from '../../../stores/mls-group-members';

  interface Props {
    announcementsGroupId?: string | null;
    channelMembers?: string[];
    squadAdminActive?: boolean;
    executorRolesLabel?: string;
  }

  let {
    announcementsGroupId = null,
    channelMembers = [],
    squadAdminActive = false,
    executorRolesLabel = '',
  }: Props = $props();

  let inboxState = $state<JoinInboxState | null>(null);
  let loading = $state(true);
  let addNpub = $state('');
  let error = $state('');
  let copiedInboxNpub = $state(false);

  const squadId = $derived(announcementsGroupId?.trim() || '');
  const acting = $derived.by(() => {
    void $joinInboxHolderActionInFlightRevision;
    return squadId ? isJoinInboxHolderActionInFlight(squadId) : false;
  });
  const myNpub = $derived($currentUser?.npub ?? '');
  const canManage = $derived(
    canManageJoinInboxHolders({
      squadAdminActive,
      executorRolesLabel,
      state: inboxState,
    }),
  );
  const candidates = $derived(
    channelMembers.filter((n) => n && n !== myNpub && !(inboxState?.holders ?? []).includes(n)),
  );

  async function reload() {
    if (!squadId) {
      inboxState = null;
      loading = false;
      return;
    }
    loading = true;
    error = '';
    try {
      inboxState = (await reclaimJoinInboxIfSplit(squadId)) ?? (await getJoinInboxState(squadId));
    } catch (e) {
      error = e instanceof Error ? e.message : tFn('governance.joinInbox.toastLoadFailed');
      inboxState = null;
    } finally {
      loading = false;
    }
  }

  async function onInitialize() {
    if (!squadId || acting) return;
    loading = true;
    error = '';
    try {
      inboxState = await getJoinInboxState(squadId);
      if (inboxState) return;
      await requestSquadStateSync(squadId);
      inboxState = await getJoinInboxState(squadId);
      if (inboxState) return;
      const result = await initJoinInbox(squadId);
      if (!result.ok) {
        error = result.error;
        return;
      }
      inboxState = result.state;
    } catch (e) {
      error = e instanceof Error ? e.message : tFn('governance.joinInbox.toastLoadFailed');
    } finally {
      loading = false;
    }
  }

  let lastLoadedId = $state('');
  $effect(() => {
    if (squadId && squadId !== lastLoadedId) {
      lastLoadedId = squadId;
      void reload();
    }
  });

  onMount(() => {
    if (squadId) void reload();
  });

  function label(npub: string): string {
    return getProfileDisplayName($profiles[npub]) || npub.slice(0, 12) + '…';
  }

  async function copyInboxNpub() {
    if (!inboxState?.inboxNpub) return;
    const ok = await copyTextToClipboard(inboxState.inboxNpub);
    if (ok) {
      copiedInboxNpub = true;
      setTimeout(() => {
        copiedInboxNpub = false;
      }, 2000);
    } else {
      showToast(tFn('governance.joinInbox.toastCopyFailed'));
    }
  }

  async function onAdd() {
    if (!squadId || !addNpub || acting) return;
    const block = canAddJoinInboxHolder(channelMembers, myNpub, addNpub, inboxState?.holders ?? [], {
      squadAdminActive,
      executorRolesLabel,
    });
    if (block) {
      showToast(block);
      return;
    }
    const result = await addJoinInboxHolder(squadId, addNpub);
    if (!result.ok) {
      showToast(result.error);
      return;
    }
    inboxState = result.state;
    addNpub = '';
    showToast(tFn('governance.joinInbox.toastAdded'));
  }

  async function onRemove(npub: string) {
    if (!squadId || acting) return;
    const result = await removeJoinInboxHolder(squadId, npub);
    if (!result.ok) {
      showToast(result.error);
      return;
    }
    inboxState = result.state;
    showToast(tFn('governance.joinInbox.toastRemoved'));
  }

  async function onRotate() {
    if (!squadId || acting) return;
    await refreshMlsGroupMembers(squadId).catch(() => {});
    const result = await rotateJoinInboxKey(squadId);
    if (!result.ok) {
      showToast(result.error);
      return;
    }
    inboxState = result.state;
    showToast(tFn('governance.joinInbox.toastRotated'));
  }
</script>

<DashboardAssetCard
  id="settings-join-inbox-holders"
  headingId="join-inbox-holders-title"
  heading={$t('governance.joinInbox.title')}
  hint={$t('governance.joinInbox.lead')}
>
  {#if loading}
    <p class="muted" role="status">{$t('governance.common.loading')}</p>
  {:else if error}
    <p class="err" role="alert">{error}</p>
  {:else if !inboxState}
    <p class="muted">{$t('governance.joinInbox.notInitialized')}</p>
    <button type="button" class="btn" disabled={acting || !squadId} onclick={() => void onInitialize()}>
      {$t('governance.joinInbox.initialize')}
    </button>
  {:else}
    <dl class="asset-dl">
      <dt>{$t('governance.joinInbox.inboxNpub')}</dt>
      <dd class="asset-dd-inline">
        <code class="inbox-key-value-full">{inboxState.inboxNpub}</code>
        <button
          type="button"
          class="inbox-key-copy-btn"
          aria-label={copiedInboxNpub ? $t('governance.common.copied') : $t('governance.joinInbox.copyInboxNpub')}
          title={copiedInboxNpub ? $t('governance.common.copied') : $t('governance.common.copy')}
          onclick={copyInboxNpub}
        >
          <svg
            class="inbox-key-copy-icon"
            width="18"
            height="18"
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
      </dd>
      <dt>{$t('governance.joinInbox.keyEpoch')}</dt>
      <dd><strong>{inboxState.keyEpoch}</strong></dd>
    </dl>

    <h4 class="subhead">{$t('governance.joinInbox.holders')}</h4>
    <ul class="holder-list">
      {#each inboxState.holders as npub (npub)}
        <li>
          <span>{label(npub)}</span>
          {#if canManage && inboxState.holders.length > 1}
            <button
              type="button"
              class="linkish danger"
              disabled={acting}
              onclick={() => void onRemove(npub)}
            >
              {$t('governance.common.remove')}
            </button>
          {/if}
        </li>
      {/each}
    </ul>

    {#if canManage}
      <div class="add-row">
        <label class="sr-only" for="join-inbox-add-holder">{$t('governance.joinInbox.addHolderLabel')}</label>
        <select id="join-inbox-add-holder" bind:value={addNpub} disabled={acting || candidates.length === 0}>
          <option value="">{$t('governance.joinInbox.addHolder')}</option>
          {#each candidates as npub (npub)}
            <option value={npub}>{label(npub)}</option>
          {/each}
        </select>
        <button type="button" class="btn" disabled={acting || !addNpub} onclick={() => void onAdd()}>
          {$t('governance.common.add')}
        </button>
      </div>

      <div class="rotate-row">
        <button
          type="button"
          class="btn-secondary join-inbox-rotate-btn"
          disabled={acting}
          onclick={() => void onRotate()}
        >
          {$t('governance.joinInbox.rotateKey')}
        </button>
      </div>
    {/if}
  {/if}
</DashboardAssetCard>

<style>
  .muted {
    margin: 0 0 0.75rem;
    font-size: 0.875rem;
    opacity: 0.85;
    line-height: 1.4;
  }
  .err {
    color: var(--danger, #c44);
    font-size: 0.875rem;
  }
  .inbox-key-value-full {
    flex: 1;
    min-width: 0;
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    line-height: 1.45;
    word-break: break-all;
    color: var(--text-primary);
  }
  .inbox-key-copy-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .inbox-key-copy-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }
  .inbox-key-copy-icon {
    display: block;
  }
  .subhead {
    margin: 0 0 0.35rem;
    font-size: 0.9rem;
  }
  .holder-list {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0;
  }
  .holder-list li {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.35rem 0;
    border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  }
  .holder-list li:last-child {
    border-bottom: none;
  }
  .add-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .add-row select {
    flex: 1 1 12rem;
    min-width: 0;
  }
  .rotate-row {
    margin-top: 0.5rem;
  }
  .btn-secondary {
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 0.875rem;
    background: var(--bg-elevated);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
    cursor: pointer;
    font-family: inherit;
  }
  .btn-secondary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .join-inbox-rotate-btn {
    margin-top: 0.25rem;
  }
  .btn:disabled,
  select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn {
    cursor: pointer;
  }
  .linkish {
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
  }
  .linkish.danger {
    color: var(--danger, #c44);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
  }
</style>
