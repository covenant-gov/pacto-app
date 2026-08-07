<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  const tFn = get(t);
  import RotateSquadKeyModal from './RotateSquadKeyModal.svelte';
  import { copyTextToClipboard } from '../../../lib/wallet/clipboard-copy';
  import { showToast } from '../../../stores/toast';
  import { currentUser } from '../../../stores/auth';
  import { needsSquadRosterKeyChoice } from '../../../lib/squad/squad-roster-key-choice';
  import { requestSquadStateSync } from '../../../lib/squad/squad-state-sync';
  import { onMount } from 'svelte';

  /** Enable when squad key rotation backend is wired. */
  const ROTATE_SQUAD_KEY_ENABLED = false;

  export let announcementsGroupId: string | null = null;
  export let parentId = '';
  export let squadMemberEvmByNpub: Record<string, string> = {};

  let rotateModalOpen = false;
  let rosterKeyNeeded: boolean | null = null;
  let syncRequesting = false;

  $: myNpub = $currentUser?.npub ?? '';
  $: myRosterEvm = myNpub ? squadMemberEvmByNpub[myNpub]?.trim() : '';

  let copiedRosterEvm = false;

  async function copyRosterEvm() {
    if (!myRosterEvm) return;
    const ok = await copyTextToClipboard(myRosterEvm);
    if (ok) {
      copiedRosterEvm = true;
      setTimeout(() => {
        copiedRosterEvm = false;
      }, 2000);
    } else {
      showToast(tFn('governance.myStatus.toastCopyFailed'));
    }
  }

  async function onRequestSync() {
    const gid = announcementsGroupId?.trim();
    if (!gid || syncRequesting) return;
    syncRequesting = true;
    try {
      const ok = await requestSquadStateSync(gid);
      showToast(
        ok
          ? tFn('governance.myStatus.toastSyncRequested')
          : tFn('governance.myStatus.toastSyncFailed'),
      );
    } finally {
      syncRequesting = false;
    }
  }

  onMount(() => {
    if (!parentId) return;
    void needsSquadRosterKeyChoice(parentId, announcementsGroupId).then((needed) => {
      rosterKeyNeeded = needed;
    });
  });
</script>

<section class="dashboard-section" aria-labelledby="my-status-checklist-heading">
  <h3 id="my-status-checklist-heading" class="section-heading">{$t('governance.myStatus.checklist')}</h3>
  <ul class="checklist" role="list">
    <li class="checklist-item">
      {#if rosterKeyNeeded === null}
        <span class="check-pending" aria-hidden="true">…</span>
        <span>{$t('governance.myStatus.rosterKey')}</span>
      {:else if rosterKeyNeeded || !myRosterEvm}
        <span class="check-todo" aria-hidden="true">○</span>
        <span>{$t('governance.myStatus.setRosterKey')}</span>
      {:else}
        <span class="check-done" aria-hidden="true">✓</span>
        <span>{$t('governance.myStatus.rosterKeySet')}</span>
      {/if}
    </li>
  </ul>
</section>

<section class="dashboard-section" aria-labelledby="my-status-evm-heading">
  <h3 id="my-status-evm-heading" class="section-heading">{$t('governance.myStatus.yourEvmAddress')}</h3>
  {#if announcementsGroupId && parentId}
    <div class="user-roster-key-box">
      {#if myRosterEvm}
        <div class="user-roster-addr-row">
          <code class="user-roster-addr-full">{myRosterEvm}</code>
          <button
            type="button"
            class="user-roster-copy-btn"
            aria-label={copiedRosterEvm ? $t('governance.myStatus.copied') : $t('governance.myStatus.copyEvmAddress')}
            title={copiedRosterEvm ? $t('governance.myStatus.copied') : $t('governance.myStatus.copy')}
            on:click={copyRosterEvm}
          >
            <svg
              class="user-roster-copy-icon"
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
        </div>
      {:else}
        <span class="muted">{$t('governance.myStatus.notShared')}</span>
      {/if}
    </div>
    <button
      type="button"
      class="btn-secondary"
      disabled={!ROTATE_SQUAD_KEY_ENABLED}
      on:click={() => (rotateModalOpen = true)}
    >
      {$t('governance.myStatus.rotateEvmKey')}
    </button>
  {:else}
    <p class="muted">{$t('governance.myStatus.noChannel')}</p>
  {/if}
</section>

  <RotateSquadKeyModal open={rotateModalOpen} onClose={() => (rotateModalOpen = false)} />

{#if announcementsGroupId && parentId}
  <section class="dashboard-section sync-section" aria-labelledby="my-status-sync-heading">
    <h3 id="my-status-sync-heading" class="section-heading">{$t('governance.myStatus.squadSync')}</h3>
    <p class="muted sync-hint">{$t('governance.myStatus.syncHint')}</p>
    <button
      type="button"
      class="btn-secondary"
      disabled={syncRequesting || !announcementsGroupId}
      on:click={() => void onRequestSync()}
    >
      {syncRequesting ? $t('governance.myStatus.requestingSync') : $t('governance.myStatus.requestSync')}
    </button>
  </section>
{/if}

<style>
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
    margin: 0 0 12px;
  }
  .checklist {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .checklist-item {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.875rem;
  }
  .check-done {
    color: var(--accent, #2a8);
    font-weight: 700;
  }
  .check-todo,
  .check-pending {
    color: var(--text-muted);
  }
  .user-roster-key-box {
    margin: 0 0 12px;
    padding: 10px 12px;
    background: var(--bg-elevated);
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
  }
  .user-roster-addr-row {
    display: flex;
    gap: 8px;
  }
  .user-roster-addr-full {
    flex: 1;
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    word-break: break-all;
  }
  .user-roster-copy-btn {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .muted {
    color: var(--text-muted);
    font-size: 0.875rem;
  }
  .sync-section {
    margin-top: 8px;
  }
  .sync-hint {
    margin: 0 0 12px;
    line-height: 1.4;
  }
  .btn-secondary {
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 0.875rem;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
    cursor: pointer;
    font-family: inherit;
  }
  .btn-secondary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
