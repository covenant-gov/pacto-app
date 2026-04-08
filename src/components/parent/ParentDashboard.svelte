<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import type { Squad, Network } from '../../stores/app';
  import {
    ANNOUNCEMENTS_CHANNEL_NAME,
    DASHBOARD_CHANNEL_NAME,
    showMembersPanel,
    membershipVersionByGroupId,
  } from '../../stores/app';
  import { getMlsGroupMembers } from '../../lib/api/nostr';
  import type { TreasurySafeEntry } from '../../lib/treasury/treasury-safes';
  import { TREASURY_SAFE_UI_CAP } from '../../lib/treasury/treasury-safes';
  import { explorerAddressUrl, parseSupportedChainId } from '../../lib/wallet/chains';
  import { openExternalUrl } from '../../lib/utils/open-external';
  import { getProfileAvatarSrc, getProfileDisplayName } from '../../lib/utils/profile';
  import { profiles } from '../../stores/profiles';
  import { safeStateByTreasuryId, refreshSafeStateForTreasuryEntry } from '../../stores/safe';
  import friendsIcon from '../../icons/friends.svg';
  import DeploySafeModal from './DeploySafeModal.svelte';
  import { showToast } from '../../stores/toast';
  import { listSquadMemberEvmInvokeArgs } from '../../lib/squad/squad-member-evm-share';

  /** Sub-views under #announcements dashboard; future: driven by configurable widgets per community. */
  type ParentDashboardView = 'treasury' | 'governance' | 'roles';
  const DASHBOARD_VIEWS: { id: ParentDashboardView; label: string }[] = [
    { id: 'treasury', label: 'Treasury' },
    { id: 'governance', label: 'Governance' },
    { id: 'roles', label: 'Roles' },
  ];

  let dashboardView: ParentDashboardView = 'treasury';

  export let parent: Squad | Network;
  export let parentType: 'squad' | 'network' = 'squad';

  /** Linked Safes for this parent (from store + backend). */
  export let treasurySafes: TreasurySafeEntry[] = [];

  /** Persist, announce, and refresh store. */
  export let onConfirmImportSafe:
    | ((params: {
        safeAddress: string;
        chain: string;
        label: string;
        entryId: string;
        txHash?: string;
      }) => Promise<void>)
    | undefined = undefined;

  let showSetSafeModal = false;
  let showDeploySafeModal = false;
  let setSafeInput = '';
  let setSafeChain: 'sepolia' | 'mainnet' | 'optimism' = 'sepolia';
  let setSafeLabel = '';
  let setSafeError = '';
  let setSafeSaving = false;

  $: parentId = parent?.id;
  $: displayedTreasurySafes = [...(treasurySafes ?? [])].slice(0, TREASURY_SAFE_UI_CAP);
  $: treasuryStateKey = displayedTreasurySafes.map((e) => e.id).join('|');
  $: if (dashboardView === 'treasury' && treasuryStateKey) {
    displayedTreasurySafes.forEach((e) => {
      refreshSafeStateForTreasuryEntry(e);
    });
  }

  $: announcementsGroupId =
    parent?.channels?.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.groupId ??
    parent?.channels?.[0]?.groupId ??
    null;

  let channelMembers: string[] = [];
  let loadingMembers = false;
  let prevMembersGroupIdForPanel: string | null = null;

  type SquadMemberEvmRow = { memberNpub: string; evmAddress: string; updatedAtMs: number };
  let squadMemberEvmByNpub: Record<string, string> = {};

  async function loadSquadMemberEvm() {
    const pid = parentId;
    if (!pid && !announcementsGroupId) return;
    try {
      const q = listSquadMemberEvmInvokeArgs(pid ?? '', announcementsGroupId);
      if (!q.parentId) return;
      const rows = await invoke<SquadMemberEvmRow[]>('list_squad_member_evm', q);
      const m: Record<string, string> = {};
      for (const r of rows) m[r.memberNpub] = r.evmAddress;
      squadMemberEvmByNpub = m;
    } catch {
      squadMemberEvmByNpub = {};
    }
  }

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

  function selectDashboardView(id: ParentDashboardView) {
    dashboardView = id;
    if (id === 'roles' && announcementsGroupId) loadDashboardMembers();
  }

  $: if (dashboardView === 'roles' && parentId) {
    loadSquadMemberEvm();
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

  function shortAddress(addr: string): string {
    if (!addr || addr.length < 12) return addr;
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }

  function openSetSafe() {
    showSetSafeModal = true;
    setSafeInput = '';
    setSafeChain = 'sepolia';
    setSafeLabel = '';
    setSafeError = '';
  }

  function openDeploySafe() {
    showDeploySafeModal = true;
  }

  function closeDeploySafeModal() {
    showDeploySafeModal = false;
  }

  function closeSetSafeModal() {
    showSetSafeModal = false;
    setSafeInput = '';
    setSafeLabel = '';
    setSafeError = '';
  }

  function openTreasuryExplorer(entry: TreasurySafeEntry) {
    const url = explorerAddressUrl(parseSupportedChainId(entry.chain), entry.safeAddress);
    if (url) openExternalUrl(url);
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
    if (!onConfirmImportSafe) {
      setSafeError = 'Import Safe is not available';
      return;
    }
    if ((treasurySafes?.length ?? 0) >= TREASURY_SAFE_UI_CAP) {
      setSafeError = `At most ${TREASURY_SAFE_UI_CAP} Safes are shown per ${parentType}. Remove one from another client or use a fresh parent.`;
      return;
    }
    setSafeSaving = true;
    setSafeError = '';
    try {
      const entryId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `te-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await onConfirmImportSafe({
        safeAddress: addr,
        chain: setSafeChain,
        label: setSafeLabel.trim(),
        entryId,
      });
      closeSetSafeModal();
    } catch (e) {
      setSafeError = (e as Error)?.message ?? 'Failed to import Safe';
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
    <div class="dashboard-view-nav" role="tablist" aria-label="Dashboard section">
      <span class="dashboard-view-nav-label" aria-hidden="true">Mode</span>
      <div class="dashboard-mode-switcher" role="group">
        {#each DASHBOARD_VIEWS as v}
          <button
            type="button"
            role="tab"
            class="dashboard-mode-segment"
            class:active={dashboardView === v.id}
            aria-selected={dashboardView === v.id}
            on:click={() => selectDashboardView(v.id)}
          >
            {v.label}
          </button>
        {/each}
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

  {#if dashboardView === 'treasury'}
  <section class="dashboard-section" aria-labelledby="safe-heading">
    <div class="treasury-section-head">
      <h3 id="safe-heading" class="section-heading">Multisig (Safe)</h3>
      {#if (treasurySafes?.length ?? 0) < TREASURY_SAFE_UI_CAP}
        <div class="treasury-action-btns">
          <button type="button" class="btn-primary treasury-deploy-btn" on:click={openDeploySafe}>Deploy Safe</button>
          <button type="button" class="btn-secondary treasury-import-btn" on:click={openSetSafe}>Import Safe</button>
        </div>
      {/if}
    </div>
    {#if (treasurySafes?.length ?? 0) > TREASURY_SAFE_UI_CAP}
      <p class="treasury-cap-note muted">
        Showing {TREASURY_SAFE_UI_CAP} of {treasurySafes.length} linked Safes.
      </p>
    {/if}
    {#if displayedTreasurySafes.length === 0}
      <p class="no-safe">No Safe linked yet.</p>
    {:else}
      <ul class="treasury-safe-card-list" role="list">
        {#each displayedTreasurySafes as entry (entry.id)}
          {@const st = $safeStateByTreasuryId[entry.id]}
          {@const exUrl = explorerAddressUrl(parseSupportedChainId(entry.chain), entry.safeAddress)}
          <li class="treasury-safe-card">
            <div class="treasury-card-top">
              <span class="treasury-pill treasury-pill-chain">{entry.chain}</span>
              {#if entry.label}
                <span class="treasury-pill treasury-pill-label">{entry.label}</span>
              {/if}
            </div>
            <code class="treasury-card-address">{entry.safeAddress}</code>
            {#if exUrl}
              <button type="button" class="btn-link treasury-explorer-link" on:click={() => openTreasuryExplorer(entry)}>
                View on explorer
              </button>
            {/if}
            {#if st?.state}
              <dl class="safe-state-dl treasury-card-dl">
                <dt>Balance</dt>
                <dd>{st.state.balanceFormatted} ETH</dd>
                <dt>Signatures</dt>
                <dd>{st.state.threshold} of {st.state.owners.length}</dd>
                <dt>Nonce</dt>
                <dd>{String(st.state.nonce)}</dd>
                <dt>Owners</dt>
                <dd>
                  <ul class="safe-owners-list">
                    {#each st.state.owners as owner}
                      <li><code class="safe-owner-address">{shortAddress(owner as string)}</code></li>
                    {/each}
                  </ul>
                </dd>
              </dl>
              {#if st.loading}
                <p class="safe-state-meta">Refreshing…</p>
              {:else if st.error}
                <p class="safe-state-error" role="alert">Last refresh failed: {st.error}</p>
              {/if}
            {:else if st?.loading}
              <p class="safe-state-meta">Loading Safe state…</p>
            {:else if st?.error}
              <p class="safe-state-error" role="alert">{st.error}</p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
  {:else if dashboardView === 'governance'}
  <section class="dashboard-section dashboard-placeholder-section" aria-labelledby="gov-heading">
    <h3 id="gov-heading" class="section-heading">Governance</h3>
    <p class="dashboard-placeholder-text">
      Proposal and voting flows for this {parentType} will live here. Treasury and roles data will stay
      available to governance widgets as the stack grows.
    </p>
  </section>
  {:else}
  <section class="dashboard-section dashboard-placeholder-section" aria-labelledby="roles-heading">
    <h3 id="roles-heading" class="section-heading">Roles</h3>
    <p class="dashboard-placeholder-text dashboard-placeholder-lead">
      Official on-chain roles, accountability NFTs, and Hats-style delegations for members will surface
      here. Each member’s EVM address will be listed for squad/network-scoped features once addresses
      are shared with the group automatically on join or creation.
    </p>
    {#if announcementsGroupId}
      {#if loadingMembers && channelMembers.length === 0}
        <p class="roles-loading">Loading members…</p>
      {:else if channelMembers.length > 0}
        <p class="roles-table-caption">Members (#announcements)</p>
        <ul class="roles-member-list" role="list">
          {#each channelMembers as memberNpub (memberNpub)}
            {@const npub = memberNpub as string}
            {@const rosterEvm = squadMemberEvmByNpub[npub]}
            {@const avatarSrc = getProfileAvatarSrc($profiles[npub])}
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
                <code class="roles-member-npub">{npub.length > 28 ? npub.slice(0, 14) + '…' + npub.slice(-8) : npub}</code>
              </div>
              <div class="roles-member-cols">
                <span class="roles-col-label">EVM</span>
                <span class="roles-col-value" class:muted={!rosterEvm}
                  >{rosterEvm ? shortAddress(rosterEvm) : 'Not shared'}</span
                >
                <span class="roles-col-label">Roles</span>
                <span class="roles-col-value muted">—</span>
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="dashboard-placeholder-text muted">No members loaded yet. Open the members panel or switch to this tab again.</p>
      {/if}
    {:else}
      <p class="dashboard-placeholder-text muted">No announcements channel for this {parentType}.</p>
    {/if}
  </section>
  {/if}
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

{#if showDeploySafeModal && parentId}
  <DeploySafeModal
    parentId={parentId}
    announcementsGroupId={announcementsGroupId}
    {parentType}
    treasurySafeCount={treasurySafes?.length ?? 0}
    onClose={closeDeploySafeModal}
    onSuccess={async (params) => {
      if (!onConfirmImportSafe) {
        throw new Error('Treasury save is not available in this context.');
      }
      await onConfirmImportSafe({
        safeAddress: params.safeAddress,
        chain: params.chain,
        label: params.label.trim() || 'Deployed multisig',
        entryId: params.entryId,
        txHash: params.txHash,
      });
      showToast('Safe deployed and added to treasury.');
    }}
  />
{/if}

{#if showSetSafeModal}
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="set-safe-title">
    <div class="modal-content">
      <h3 id="set-safe-title">Import Safe</h3>
      <p class="modal-desc">
        Add a Safe to this {parentType} treasury. Members see it after the announce posts to #announcements.
      </p>
      <label class="modal-field-label" for="import-safe-addr">Contract address</label>
      <input
        id="import-safe-addr"
        type="text"
        class="input-address"
        placeholder="0x..."
        bind:value={setSafeInput}
        aria-invalid={setSafeError ? 'true' : undefined}
        aria-describedby={setSafeError ? 'set-safe-error' : undefined}
      />
      <label class="modal-field-label" for="import-safe-chain">Network</label>
      <select id="import-safe-chain" class="input-select" bind:value={setSafeChain}>
        <option value="sepolia">Sepolia</option>
        <option value="mainnet">Ethereum</option>
        <option value="optimism">Optimism</option>
      </select>
      <label class="modal-field-label" for="import-safe-label">Label (optional)</label>
      <input
        id="import-safe-label"
        type="text"
        class="input-address"
        placeholder="e.g. Operations"
        bind:value={setSafeLabel}
      />
      {#if setSafeError}
        <p id="set-safe-error" class="input-error" role="alert">{setSafeError}</p>
      {/if}
      <div class="modal-actions">
        <button type="button" class="btn-secondary" on:click={closeSetSafeModal} disabled={setSafeSaving}>Cancel</button>
        <button type="button" class="btn-primary" on:click={confirmSetSafe} disabled={setSafeSaving}
          >{setSafeSaving ? 'Saving…' : 'Add to treasury'}</button
        >
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

  .dashboard-view-nav {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 48px;
    min-height: 48px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    flex-shrink: 0;
  }

  .dashboard-view-nav-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .dashboard-mode-switcher {
    display: inline-flex;
    align-items: stretch;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 3px;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.06);
  }

  .dashboard-mode-segment {
    padding: 0 22px;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--text-muted);
    background: transparent;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: color 0.15s, background-color 0.15s;
  }

  .dashboard-mode-segment:hover:not(.active) {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .dashboard-mode-segment:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .dashboard-mode-segment.active {
    color: var(--text-primary);
    background: var(--bg-elevated);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }

  .dashboard-placeholder-section .section-heading {
    margin-bottom: 8px;
  }

  .dashboard-placeholder-text {
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 0 0 12px 0;
  }

  .dashboard-placeholder-lead {
    margin-bottom: 16px;
  }

  .dashboard-placeholder-text.muted,
  .muted {
    color: var(--text-muted);
  }

  .roles-loading {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 0;
  }

  .roles-table-caption {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
    margin: 0 0 8px 0;
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
    color: var(--text-primary);
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
    align-items: baseline;
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
  .treasury-section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .treasury-section-head .section-heading {
    margin: 0;
  }
  .treasury-action-btns {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .treasury-deploy-btn {
    flex-shrink: 0;
  }
  .treasury-import-btn {
    flex-shrink: 0;
  }
  .treasury-cap-note {
    font-size: 0.8125rem;
    margin: 0 0 12px 0;
  }
  .treasury-safe-card-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .treasury-safe-card {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 12px;
    background: var(--bg-elevated);
  }
  .treasury-card-top {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 8px;
  }
  .treasury-pill {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-hover);
    color: var(--text-secondary);
  }
  .treasury-card-address {
    display: block;
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    word-break: break-all;
    margin-bottom: 8px;
    color: var(--text-primary);
  }
  .treasury-explorer-link {
    margin-bottom: 8px;
  }
  .treasury-card-dl {
    margin-top: 8px;
  }
  .btn-link {
    background: none;
    border: none;
    padding: 0;
    font-size: 0.8125rem;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }
  .modal-field-label {
    display: block;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-muted);
    margin: 12px 0 4px 0;
  }
  .input-select {
    width: 100%;
    padding: 10px 12px;
    font-size: 0.875rem;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    margin-bottom: 4px;
    box-sizing: border-box;
  }
  .no-safe {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0;
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
    margin: 0 0 8px 0;
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
