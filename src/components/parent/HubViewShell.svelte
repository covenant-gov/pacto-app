<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';
  import friendsIcon from '../../icons/friends.svg';
  import { showMembersPanel } from '../../stores/navigation';
  import {
    ensureMlsGroupMembers,
    membersByGroupId,
    membersLoadingByGroupId,
  } from '../../stores/mls-group-members';
  import HubChannelHeader from './HubChannelHeader.svelte';
  import HubModeSwitcher from './HubModeSwitcher.svelte';
  import ParentDashboardMembersPanel from './dashboard/ParentDashboardMembersPanel.svelte';

  let {
    channelName,
    modes,
    active,
    ariaLabel,
    labelFor,
    onSelect,
    onIntent,
    announcementsGroupId = null,
    headerLeading,
    banner,
    children,
  }: {
    channelName: string;
    modes: readonly string[];
    active: string;
    ariaLabel: string;
    labelFor: (mode: string) => string;
    onSelect: (mode: string) => void;
    onIntent?: (mode: string) => void;
    announcementsGroupId?: string | null;
    /** Optional control(s) left of the members button (e.g. Live | Wargame). */
    headerLeading?: Snippet;
    banner?: Snippet;
    children: Snippet;
  } = $props();

  const channelMembers = $derived(
    announcementsGroupId ? ($membersByGroupId[announcementsGroupId] ?? []) : [],
  );
  const loadingMembers = $derived(
    announcementsGroupId
      ? ($membersLoadingByGroupId[announcementsGroupId] ?? false) && channelMembers.length === 0
      : false,
  );

  let prevMembersGroupIdForPanel: string | null = $state(null);

  function openMembersPanel() {
    showMembersPanel.set(true);
    prevMembersGroupIdForPanel = announcementsGroupId ?? null;
    if (announcementsGroupId) void ensureMlsGroupMembers(announcementsGroupId);
  }

  function toggleMembersPanel() {
    if ($showMembersPanel) {
      showMembersPanel.set(false);
    } else {
      openMembersPanel();
    }
  }

  $effect(() => {
    if ($showMembersPanel && announcementsGroupId && prevMembersGroupIdForPanel !== announcementsGroupId) {
      prevMembersGroupIdForPanel = announcementsGroupId;
      void ensureMlsGroupMembers(announcementsGroupId);
    }
  });

  $effect(() => {
    if (!$showMembersPanel) prevMembersGroupIdForPanel = null;
  });
</script>

<div class="hub-view-shell">
  <div class="hub-view-shell-main">
    <HubChannelHeader {channelName}>
      {#snippet actions()}
        {#if headerLeading}
          {@render headerLeading()}
        {/if}
        <button
          type="button"
          class="channel-members-btn"
          title={$t('governance.members.title')}
          onclick={toggleMembersPanel}
          aria-label={$showMembersPanel ? $t('governance.members.close') : $t('governance.members.view')}
          aria-expanded={$showMembersPanel}
        >
          <img src={friendsIcon} alt="" class="channel-members-btn-icon" />
        </button>
      {/snippet}
    </HubChannelHeader>
    {#if banner}
      {@render banner()}
    {/if}
    <HubModeSwitcher
      {modes}
      {active}
      {ariaLabel}
      {labelFor}
      {onSelect}
      {onIntent}
    />
    <div class="hub-view-shell-body">
      {@render children()}
    </div>
  </div>
  <ParentDashboardMembersPanel
    open={$showMembersPanel}
    {channelMembers}
    {loadingMembers}
  />
</div>

<style>
  .hub-view-shell {
    flex: 1;
    display: flex;
    flex-direction: row;
    background: var(--bg-panel);
    height: 100%;
    min-width: 0;
    border-left: 1px solid var(--border-subtle);
  }

  .hub-view-shell-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .hub-view-shell-body {
    flex: 1;
    overflow: auto;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
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
</style>
