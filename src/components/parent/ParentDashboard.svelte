<script lang="ts">
  import type { Squad, Network } from '../../stores/app';
  import {
    ANNOUNCEMENTS_CHANNEL_NAME,
    DASHBOARD_CHANNEL_NAME,
    showMembersPanel,
    membershipVersionByGroupId,
  } from '../../stores/app';
  import { getMlsGroupMembers } from '../../lib/api/nostr';
  import { getProfileAvatarSrc, getProfileDisplayName } from '../../lib/utils/profile';
  import { profiles } from '../../stores/profiles';
  import { safeStateByParentId, refreshSafeStateForParent } from '../../stores/safe';
  import friendsIcon from '../../icons/friends.svg';

  export let parent: Squad | Network;
  export let parentType: 'squad' | 'network' = 'squad';

  /** Safe address for this squad/network (from backend or state). Null = not linked yet. */
  export let safeAddress: string | null = null;

  /** When user confirms Set Safe: backend + post announce-card + update store. Called with the new address. */
  export let onConfirmSetSafe: ((safeAddress: string) => Promise<void>) | undefined = undefined;

  let showSetSafeModal = false;
  let setSafeInput = '';
  let setSafeError = '';
  let setSafeSaving = false;

  /** Cached Safe state entry for this parent id (kept across navigation). */
  $: parentId = parent?.id;
  $: safeEntry = parentId ? $safeStateByParentId[parentId] : undefined;

  $: announcementsGroupId =
    parent?.channels?.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.groupId ??
    parent?.channels?.[0]?.groupId ??
    null;

  let channelMembers: string[] = [];
  let loadingMembers = false;
  let prevMembersGroupIdForPanel: string | null = null;

  async function loadDashboardMembers() {
    const groupId = announcementsGroupId;
    if (!groupId) return;
    loadingMembers = true;
    try {
      const result = await getMlsGroupMembers(groupId);
      channelMembers = (result.members ?? []) as string[];
    } catch {
      channelMembers = [];
    } finally {
      loadingMembers = false;
    }
  }

  function openDashboardMembersPanel() {
    showMembersPanel.set(true);
    prevMembersGroupIdForPanel = announcementsGroupId;
    channelMembers = [];
    loadDashboardMembers();
  }

  function toggleMembersPanel() {
    if ($showMembersPanel) {
      showMembersPanel.set(false);
    } else {
      openDashboardMembersPanel();
    }
  }

  $: if ($showMembersPanel && announcementsGroupId && prevMembersGroupIdForPanel !== announcementsGroupId) {
    prevMembersGroupIdForPanel = announcementsGroupId;
    loadDashboardMembers();
  }
  $: if (!$showMembersPanel) prevMembersGroupIdForPanel = null;

  $: if ($showMembersPanel && announcementsGroupId) {
    const gid = announcementsGroupId;
    const version = $membershipVersionByGroupId[gid] ?? 0;
    if (version > 0) {
      loadDashboardMembers();
    }
  }

  // Refresh in background when we have a Safe address. Cached state remains visible for smooth UX.
  $: if (parentId && safeAddress && typeof safeAddress === 'string') {
    refreshSafeStateForParent(parentId, safeAddress);
  }

  function shortAddress(addr: string): string {
    if (!addr || addr.length < 12) return addr;
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }

  function openSetSafe() {
    showSetSafeModal = true;
    setSafeInput = safeAddress ?? '';
    setSafeError = '';
  }

  function closeSetSafeModal() {
    showSetSafeModal = false;
    setSafeInput = '';
    setSafeError = '';
  }

  async function confirmSetSafe() {
    const addr = setSafeInput.trim();
    if (!addr) {
      setSafeError = 'Enter a Safe address';
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      setSafeError = 'Invalid address (expected 0x + 40 hex chars)';
      return;
    }
    if (!onConfirmSetSafe) {
      setSafeError = 'Set Safe is not available';
      return;
    }
    setSafeSaving = true;
    setSafeError = '';
    try {
      await onConfirmSetSafe(addr);
      closeSetSafeModal();
    } catch (e) {
      setSafeError = (e as Error)?.message ?? 'Failed to set Safe address';
    } finally {
      setSafeSaving = false;
    }
  }
</script>

<div class="parent-dashboard-layout">
  <div class="parent-dashboard-main">
    <div class="dashboard-channel-header">
      <div class="dashboard-channel-info">
        <span class="dashboard-channel-icon">#</span>
        <h3 class="dashboard-channel-name">{DASHBOARD_CHANNEL_NAME}</h3>
      </div>
      <div class="dashboard-header-actions">
        <button
          type="button"
          class="channel-members-btn"
          title="Members"
          on:click={toggleMembersPanel}
          aria-label={$showMembersPanel ? 'Close channel members' : 'View channel members'}
          aria-expanded={$showMembersPanel}
        >
          <img src={friendsIcon} alt="" class="channel-members-btn-icon" />
        </button>
      </div>
    </div>
    <div class="parent-dashboard-body">
      <div class="parent-dashboard">
  <div class="dashboard-header">
    <h2 class="dashboard-title">{parent.name}</h2>
    {#if parentType === 'network' && (parent as Network).memberSquads?.length}
      <p class="dashboard-subtitle">
        {(parent as Network).memberSquads.map((s) => s.name).join(', ')}
      </p>
    {/if}
  </div>

  <section class="dashboard-section" aria-labelledby="safe-heading">
    <h3 id="safe-heading" class="section-heading">Multisig (Safe)</h3>
    {#if safeAddress}
      <div class="safe-address-row">
        <span class="safe-address-value">{safeAddress}</span>
        <button type="button" class="btn-secondary" on:click={openSetSafe}>Change</button>
      </div>
      {#if safeEntry?.state}
        <dl class="safe-state-dl">
          <dt>Balance</dt>
          <dd>{safeEntry.state.balanceFormatted} ETH</dd>
          <dt>Signatures</dt>
          <dd>{safeEntry.state.threshold} of {safeEntry.state.owners.length}</dd>
          <dt>Nonce</dt>
          <dd>{String(safeEntry.state.nonce)}</dd>
          <dt>Owners</dt>
          <dd>
            <ul class="safe-owners-list">
              {#each safeEntry.state.owners as owner}
                <li><code class="safe-owner-address">{shortAddress(owner as string)}</code></li>
              {/each}
            </ul>
          </dd>
        </dl>
        {#if safeEntry.loading}
          <p class="safe-state-meta">Refreshing…</p>
        {:else if safeEntry.error}
          <p class="safe-state-error" role="alert">Last refresh failed: {safeEntry.error}</p>
        {/if}
      {:else if safeEntry?.loading}
        <p class="safe-state-meta">Loading Safe state…</p>
      {:else if safeEntry?.error}
        <p class="safe-state-error" role="alert">{safeEntry.error}</p>
      {/if}
    {:else}
      <p class="no-safe">No Safe linked</p>
      <button type="button" class="btn-primary" on:click={openSetSafe}>Set Safe address</button>
    {/if}
  </section>
      </div>
    </div>
  </div>
  {#if $showMembersPanel}
    <aside class="members-panel" aria-label="Channel members">
      <div class="members-panel-header">
        <h3 class="members-panel-title">Members</h3>
      </div>
      <div class="members-panel-list">
        {#if loadingMembers}
          <p class="members-panel-loading">Loading…</p>
        {:else}
          {#each channelMembers as member (member)}
            {@const npub = member as string}
            {@const avatarSrc = getProfileAvatarSrc($profiles[npub])}
            <div class="members-panel-member">
              {#if avatarSrc}
                <img src={avatarSrc} alt="" class="members-panel-avatar" />
              {:else}
                <div class="members-panel-avatar members-panel-avatar-placeholder" aria-hidden="true"></div>
              {/if}
              <span class="members-panel-name">{getProfileDisplayName($profiles[npub]) || npub.slice(0, 16) + '…'}</span>
            </div>
          {/each}
        {/if}
      </div>
    </aside>
  {/if}
</div>

{#if showSetSafeModal}
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="set-safe-title">
    <div class="modal-content">
      <h3 id="set-safe-title">Set Safe address</h3>
      <p class="modal-desc">Enter the Safe contract address for this {parentType}. All members will see it on their dashboard.</p>
      <input
        type="text"
        class="input-address"
        placeholder="0x..."
        bind:value={setSafeInput}
        aria-invalid={setSafeError ? 'true' : undefined}
        aria-describedby={setSafeError ? 'set-safe-error' : undefined}
      />
      {#if setSafeError}
        <p id="set-safe-error" class="input-error" role="alert">{setSafeError}</p>
      {/if}
      <div class="modal-actions">
        <button type="button" class="btn-secondary" on:click={closeSetSafeModal} disabled={setSafeSaving}>Cancel</button>
        <button type="button" class="btn-primary" on:click={confirmSetSafe} disabled={setSafeSaving}>{setSafeSaving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .parent-dashboard-layout {
    flex: 1;
    display: flex;
    flex-direction: row;
    background: var(--bg-panel);
    height: 100%;
    min-width: 0;
    border-left: 1px solid var(--border-subtle);
  }

  .parent-dashboard-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .parent-dashboard-body {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .dashboard-channel-header {
    height: 48px;
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    flex-shrink: 0;
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
  }

  .dashboard-channel-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dashboard-channel-icon {
    color: var(--text-muted);
    font-size: 1.25rem;
    font-weight: 600;
  }

  .dashboard-channel-name {
    color: var(--text-primary);
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
  }

  .dashboard-header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .channel-members-btn {
    padding: 6px 8px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .channel-members-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .channel-members-btn-icon {
    width: 20px;
    height: 20px;
    display: block;
    filter: var(--icon-dropdown-filter);
  }

  .members-panel {
    width: 240px;
    min-width: 240px;
    background: var(--bg-elevated);
    border-left: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .members-panel-header {
    height: 48px;
    padding: 0 12px 0 16px;
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .members-panel-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .members-panel-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .members-panel-loading {
    margin: 0 16px;
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .members-panel-member {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 16px;
    font-size: 0.9375rem;
    color: var(--text-secondary);
  }

  .members-panel-member:hover {
    background: var(--bg-hover);
  }

  .members-panel-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .members-panel-avatar-placeholder {
    background: var(--border);
  }

  .members-panel-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .parent-dashboard {
    padding: 24px;
    max-width: 560px;
  }
  .dashboard-header {
    margin-bottom: 24px;
  }
  .dashboard-title {
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0 0 4px 0;
    color: var(--text-primary);
  }
  .dashboard-subtitle {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 0;
  }
  .dashboard-section {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 16px;
  }
  .section-heading {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0 0 12px 0;
  }
  .safe-address-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .safe-address-value {
    font-family: monospace;
    font-size: 0.875rem;
    word-break: break-all;
    color: var(--text-primary);
  }
  .no-safe {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0 0 12px 0;
  }
  .safe-state-meta {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 12px 0 0 0;
  }
  .safe-state-error {
    font-size: 0.875rem;
    color: var(--danger, #e53e3e);
    margin: 12px 0 0 0;
  }
  .safe-state-dl {
    margin: 12px 0 0 0;
    font-size: 0.875rem;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 16px;
    align-items: baseline;
  }
  .safe-state-dl dt {
    color: var(--text-muted);
    font-weight: 500;
  }
  .safe-state-dl dd {
    margin: 0;
    color: var(--text-primary);
  }
  .safe-owners-list {
    margin: 0;
    padding-left: 1.25rem;
    list-style: disc;
  }
  .safe-owner-address {
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
  }
  .btn-primary,
  .btn-secondary {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 0.875rem;
    cursor: pointer;
  }
  .btn-primary {
    background: var(--accent);
    color: var(--accent-contrast, #fff);
    border: none;
  }
  .btn-secondary {
    background: var(--bg-secondary);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
  }
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .modal-content {
    background: var(--bg-panel);
    border-radius: 12px;
    padding: 24px;
    min-width: 320px;
    max-width: 90vw;
  }
  .modal-content h3 {
    margin: 0 0 8px 0;
    font-size: 1.25rem;
  }
  .modal-desc {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 0 0 16px 0;
  }
  .input-address {
    width: 100%;
    padding: 10px 12px;
    font-family: monospace;
    font-size: 0.875rem;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    margin-bottom: 8px;
    box-sizing: border-box;
  }
  .input-error {
    font-size: 0.8rem;
    color: var(--danger, #e53e3e);
    margin: 0 0 12px 0;
  }
  .modal-actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    margin-top: 16px;
  }
</style>
