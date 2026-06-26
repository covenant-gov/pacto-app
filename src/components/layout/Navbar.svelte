<script lang="ts">
  import Tab from '../ui/Tab.svelte';
  import Modal from '../ui/Modal.svelte';
  import SquadCommonsVisibilityFields from '../squad/SquadCommonsVisibilityFields.svelte';
  import { resolveSquadCommonsOnCreate, validatePublicSquadTags } from '../../lib/squad/squad-commons-fields';
  import type { SquadVisibility } from '../../stores/squads';
  import settingsIcon from '../../icons/settings.svg';
  import plusCircleIcon from '../../icons/plus-circle.svg';
  import friendsIcon from '../../icons/friends.svg';
  import requestsIcon from '../../icons/requests.svg';
  import pendingIcon from '../../icons/pending.svg';
  import pinIcon from '../../icons/pin.svg';
  import searchIcon from '../../icons/search.svg';
  import { get } from 'svelte/store';
  import {
    squads,
    activeSquadId,
    activeChannelId,
    activeHubChannelName,
    activeView,
    activeTopNavTab,
    activeDmTab,
    activeDmId,
    lastOpenedSquadId,
    lastOpenedChannelId,
    lastChannelBySquadId,
    lastHubChannelNameBySquadId,
    composingNewChat,
    dmList,
    pinnedList,
    addParentCreatingAnnouncements,
    removeParentCreatingAnnouncements,
    parentCreateErrorById,
    parentPendingCreateMembers,
    ANNOUNCEMENTS_CHANNEL_NAME,
    DASHBOARD_CHANNEL_ID,
    type TopNavTab,
    type DmTab,
    type Squad,
  } from '../../stores/app';
  import { currentUser } from '../../stores/auth';
  import { sendSquadInviteDm } from '../../lib/pacto-app-inbox';
  import { createDefaultParentChannels } from '../../lib/parent-navbar';
  import { resolveHubChannelNameForGroupSelection } from '../../lib/mls/virtual-channel-bucket';
  import { pendingReadyToast } from '../../stores/toast';
  import { schedulePublicSquadCreateBroadcast } from '../../lib/commons/squad-create-broadcast';
  import {
    commonsUserHasActiveBroadcast,
    openCommonsBroadcastModal,
    syncCommonsUserActiveBroadcast,
  } from '../../stores/commons-ui';
  import { getInvokeErrorMessage, friendlyMessage } from '../../lib/utils/tauri-errors';
  import { persistCreatedSquad } from '../../lib/squad/squad-catalog';
  import { getProfileDisplayName } from '../../lib/utils/profile';
  import { profiles } from '../../stores/profiles';

  function selectSquad(squadId: string) {
    const squad = $squads.find((s) => s.id === squadId);
    if (!squad) return;
    const sortedChannels = [...squad.channels].sort((a, b) => a.order - b.order);
    const firstChannel = sortedChannels[0];
    const lastChannelId = $lastChannelBySquadId[squadId];
    let nextChannelGroupId: string | null = null;
    if (lastChannelId === DASHBOARD_CHANNEL_ID) {
      nextChannelGroupId = DASHBOARD_CHANNEL_ID;
    } else if (lastChannelId && sortedChannels.some((c) => c.groupId === lastChannelId)) {
      nextChannelGroupId = lastChannelId;
    } else {
      nextChannelGroupId = firstChannel?.groupId ?? null;
    }
    $activeSquadId = squadId;
    $activeChannelId = nextChannelGroupId;
    if (nextChannelGroupId === DASHBOARD_CHANNEL_ID || nextChannelGroupId === null) {
      activeHubChannelName.set(null);
    } else {
      activeHubChannelName.set(
        resolveHubChannelNameForGroupSelection(
          sortedChannels,
          nextChannelGroupId,
          get(lastHubChannelNameBySquadId)[squadId] || null
        )
      );
    }
    $activeView = 'hub';
  }

  function selectDmTab(tab: DmTab) {
    $activeDmTab = tab;
    $activeView = 'hub';
    $composingNewChat = false;
  }

  function startNewChat() {
    $composingNewChat = true;
    $activeView = 'hub';
    $activeDmTab = 'pending';
    $activeDmId = null;
  }

  function openProfile() {
    $activeView = 'profile';
    $activeChannelId = null;
    activeHubChannelName.set(null);
  }

  const addButtonLabels: Partial<Record<TopNavTab, string>> = {
    commons: 'Start Broadcast',
    dms: 'Start DM',
    squads: 'Organize Squad',
  };
  $: addButtonLabel = addButtonLabels[$activeTopNavTab];
  $: showAddButton =
    $activeTopNavTab === 'commons' || $activeTopNavTab === 'dms' || $activeTopNavTab === 'squads';

  $: commonsStartBroadcastDisabled =
    $activeTopNavTab === 'commons' && $commonsUserHasActiveBroadcast;
  $: commonsAddButtonLabel = commonsStartBroadcastDisabled
    ? 'Broadcast active'
    : (addButtonLabel ?? '');

  let commonsActiveBroadcastSyncKey = '';
  $: {
    const npub = $activeTopNavTab === 'commons' ? ($currentUser?.npub ?? '') : '';
    if (npub && npub !== commonsActiveBroadcastSyncKey) {
      commonsActiveBroadcastSyncKey = npub;
      void syncCommonsUserActiveBroadcast(npub);
    }
    if (!npub) commonsActiveBroadcastSyncKey = '';
  }

  let showOrganizeSquadModal = false;
  let organizeSquadName = '';
  let organizeSquadIconUrl = '';
  let organizeSquadMembers: string[] = [];
  let organizeSquadError = '';
  let organizeSquadVisibility: SquadVisibility = 'private';
  let organizeSquadTags: string[] = [];
  let organizeSquadTagError = '';
  let commonsFields: SquadCommonsVisibilityFields;

  function openOrganizeSquadModal() {
    showOrganizeSquadModal = true;
    organizeSquadName = '';
    organizeSquadIconUrl = '';
    organizeSquadMembers = [];
    organizeSquadError = '';
    organizeSquadVisibility = 'private';
    organizeSquadTags = [];
    organizeSquadTagError = '';
    commonsFields?.resetCommonsFields();
  }

  function closeOrganizeSquadModal() {
    showOrganizeSquadModal = false;
  }

  function handleBottomAddClick() {
    if ($activeTopNavTab === 'dms') startNewChat();
    else if ($activeTopNavTab === 'commons') {
      if ($commonsUserHasActiveBroadcast) return;
      $activeView = 'hub';
      openCommonsBroadcastModal();
    } else handleAddAction();
  }

  function toggleOrganizeMember(npub: string) {
    if (organizeSquadMembers.includes(npub)) {
      organizeSquadMembers = organizeSquadMembers.filter((n) => n !== npub);
    } else {
      organizeSquadMembers = [...organizeSquadMembers, npub];
    }
  }

  function organizeMemberDisplayName(npub: string, fallbackName?: string) {
    return fallbackName?.trim() || getProfileDisplayName($profiles[npub] ?? null) || npub.slice(0, 16) + '…';
  }

  function createSquadWithAnnouncements(
    name: string,
    memberNpubs: string[],
    options: { iconUrl?: string; visibility?: SquadVisibility; commonsTags?: string[] } = {}
  ) {
    const now = Date.now();
    const tempId = 'creating-squad-' + now;
    const visibility = options.visibility === 'public' ? 'public' : 'private';
    const squad: Squad = {
      id: tempId,
      name,
      iconUrl: options.iconUrl,
      channels: [],
      kind: 'squad',
      visibility,
      commonsTags: visibility === 'public' ? options.commonsTags : undefined,
      createdAt: now,
      updatedAt: now,
    };
    addParentCreatingAnnouncements(squad.id);
    parentPendingCreateMembers.update((m) => ({ ...m, [squad.id]: memberNpubs }));
    squads.update((list) => [...list, squad]);
    activeSquadId.set(squad.id);
    activeChannelId.set(null);
    activeHubChannelName.set(null);
    activeView.set('hub');

    (async () => {
      try {
        const { parentId, channels } = await createDefaultParentChannels(memberNpubs);
        const groupId = parentId;
        const finalized: Squad = {
          id: groupId,
          name,
          iconUrl: options.iconUrl,
          channels,
          kind: 'squad',
          visibility,
          commonsTags: visibility === 'public' ? options.commonsTags : undefined,
          createdAt: squad.createdAt,
          updatedAt: Date.now(),
        };
        await persistCreatedSquad(tempId, finalized);
        removeParentCreatingAnnouncements(tempId);
        parentCreateErrorById.update((m) => {
          const next = { ...m };
          delete next[tempId];
          return next;
        });
        parentPendingCreateMembers.update((m) => {
          const next = { ...m };
          delete next[tempId];
          return next;
        });
        if (get(activeSquadId) === tempId) {
          activeSquadId.set(groupId);
          activeChannelId.set(groupId);
          const hub =
            channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.name ?? channels[0]?.name ?? null;
          activeHubChannelName.set(hub);
        }
        lastOpenedSquadId.set(groupId);
        lastOpenedChannelId.set(groupId);
        lastChannelBySquadId.update((m) => ({ ...m, [groupId]: groupId }));
        const hubName =
          channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.name ?? channels[0]?.name ?? '';
        if (hubName) lastHubChannelNameBySquadId.update((m) => ({ ...m, [groupId]: hubName }));

        pendingReadyToast.set({
          text: `${name} is ready!`,
          goTo: {
            type: 'squad',
            name,
            id: groupId,
            channelId: groupId,
            hubChannelName:
              channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.name ?? channels[0]?.name,
          },
        });
        const myNpub = get(currentUser)?.npub;
        for (const npub of memberNpubs) {
          try {
            await sendSquadInviteDm(npub, { squadName: name, groupId }, myNpub);
          } catch (e) {
            console.warn('[Navbar] send squad invite DM failed for', npub.slice(0, 20) + '…', e);
          }
        }
        schedulePublicSquadCreateBroadcast(groupId, () => {
          const s = get(squads).find((x) => x.id === groupId);
          if (!s) return undefined;
          return {
            id: s.id,
            name: s.name,
            kind: s.kind,
            iconUrl: s.iconUrl,
            visibility: s.visibility,
            commonsTags: s.commonsTags,
          };
        });
      } catch (e) {
        console.error('[Navbar] createSquadWithAnnouncements failed', { tempId, name }, e);
        removeParentCreatingAnnouncements(tempId);
        parentCreateErrorById.update((m) => ({
          ...m,
          [tempId]: friendlyMessage(getInvokeErrorMessage(e, 'Failed to create squad announcements channel')),
        }));
        squads.update((list) => list.filter((s) => s.id !== tempId));
        if (get(activeSquadId) === tempId) {
          activeSquadId.set(null);
          activeChannelId.set(null);
          activeHubChannelName.set(null);
        }
      }
    })();
  }

  function handleCreateSquad() {
    const name = organizeSquadName.trim();
    if (!name) return;
    organizeSquadError = '';
    const myNpub = $currentUser?.npub;
    const memberIds = (organizeSquadMembers || []).filter((n) => n !== myNpub);
    if (memberIds.length === 0) {
      organizeSquadError = 'Select at least one other member to create a squad.';
      return;
    }
    if (organizeSquadVisibility === 'public') {
      const tagErr = validatePublicSquadTags(organizeSquadTags);
      if (tagErr) {
        organizeSquadTagError = tagErr;
        return;
      }
    }
    let commons: { visibility: SquadVisibility; commonsTags?: string[] };
    try {
      commons = resolveSquadCommonsOnCreate(organizeSquadVisibility, organizeSquadTags);
    } catch (e) {
      organizeSquadTagError = e instanceof Error ? e.message : 'Invalid tags.';
      return;
    }
    showOrganizeSquadModal = false;
    createSquadWithAnnouncements(name, memberIds, {
      iconUrl: organizeSquadIconUrl.trim() || undefined,
      visibility: commons.visibility,
      commonsTags: commons.commonsTags,
    });
  }

  function handleAddAction() {
    if ($activeTopNavTab === 'squads') openOrganizeSquadModal();
  }

  $: canCreateSquad =
    organizeSquadName.trim().length > 0 &&
    organizeSquadMembers.length > 0 &&
    (organizeSquadVisibility !== 'public' || organizeSquadTags.length > 0);
  $: organizeMemberList = [...$pinnedList, ...$dmList];

  $: if (showOrganizeSquadModal) {
    setTimeout(() => document.getElementById('squad-name')?.focus(), 0);
  }
</script>

<div class="navbar">
  {#if $activeView !== 'profile' && $activeTopNavTab !== 'commons'}
  <div class="tab-list">
    {#if $activeTopNavTab === 'dms'}
      <div
        on:click={() => selectDmTab('pinned')}
        on:keydown={(e) => e.key === 'Enter' && selectDmTab('pinned')}
        role="button"
        tabindex="0"
      >
        <Tab label="Pinned" icon={pinIcon} active={$activeView === 'hub' && $activeDmTab === 'pinned'} />
      </div>
      <div
        on:click={() => selectDmTab('friends')}
        on:keydown={(e) => e.key === 'Enter' && selectDmTab('friends')}
        role="button"
        tabindex="0"
      >
        <Tab label="Friends" icon={friendsIcon} active={$activeView === 'hub' && $activeDmTab === 'friends'} />
      </div>
      <div
        on:click={() => selectDmTab('requests')}
        on:keydown={(e) => e.key === 'Enter' && selectDmTab('requests')}
        role="button"
        tabindex="0"
      >
        <Tab label="Requests" icon={requestsIcon} active={$activeView === 'hub' && $activeDmTab === 'requests'} />
      </div>
      <div
        on:click={() => selectDmTab('pending')}
        on:keydown={(e) => e.key === 'Enter' && selectDmTab('pending')}
        role="button"
        tabindex="0"
      >
        <Tab label="Pending" icon={pendingIcon} active={$activeView === 'hub' && $activeDmTab === 'pending'} />
      </div>
      <div
        on:click={() => selectDmTab('search')}
        on:keydown={(e) => e.key === 'Enter' && selectDmTab('search')}
        role="button"
        tabindex="0"
      >
        <Tab label="Search" icon={searchIcon} active={$activeView === 'hub' && $activeDmTab === 'search'} />
      </div>
    {:else if $activeTopNavTab === 'squads'}
      {#each $squads as squad (squad.id)}
        <div
          on:click={() => selectSquad(squad.id)}
          on:keydown={(e) => e.key === 'Enter' && selectSquad(squad.id)}
          role="button"
          tabindex="0"
        >
          <Tab
            label={squad.name}
            image={squad.iconUrl ?? ''}
            active={$activeView === 'hub' && $activeSquadId === squad.id}
          />
        </div>
      {/each}
    {/if}
  </div>
  {/if}
  {#if $activeView === 'profile' || $activeTopNavTab === 'commons'}
  <div class="navbar-spacer" aria-hidden="true"></div>
  {/if}
  <div class="tab-list bottom">
    {#if showAddButton && addButtonLabel}
      <div
        class="navbar-add-wrap"
        class:is-disabled={commonsStartBroadcastDisabled}
        on:click={handleBottomAddClick}
        on:keydown={(e) =>
          !commonsStartBroadcastDisabled && e.key === 'Enter' && handleBottomAddClick()}
        role="button"
        tabindex={commonsStartBroadcastDisabled ? -1 : 0}
        aria-disabled={commonsStartBroadcastDisabled}
      >
        <Tab label={commonsAddButtonLabel} icon={plusCircleIcon} active={false} />
      </div>
    {/if}
    <div
      on:click={openProfile}
      on:keydown={(e) => e.key === 'Enter' && openProfile()}
      role="button"
      tabindex="0"
    >
      <Tab label="Settings" icon={settingsIcon} active={$activeView === 'profile'} />
    </div>
  </div>
</div>

{#if showOrganizeSquadModal}
  <Modal titleId="organize-squad-title" descriptionId="organize-squad-description" onClose={closeOrganizeSquadModal}>
    <h2 id="organize-squad-title">Organize Squad</h2>
    <p id="organize-squad-description" class="organize-modal-subtitle">
      Create a squad with an announcements channel. Select at least one member.
    </p>
    <form on:submit|preventDefault={handleCreateSquad}>
      <label class="organize-label" for="squad-name">Squad name</label>
      <input
        id="squad-name"
        type="text"
        class="organize-input"
        placeholder="e.g. Team Alpha"
        bind:value={organizeSquadName}
        required
      />
      <label class="organize-label" for="squad-icon">Icon URL (optional)</label>
      <input
        id="squad-icon"
        type="url"
        class="organize-input"
        placeholder="https://…"
        bind:value={organizeSquadIconUrl}
      />
      <span class="organize-label">Members for announcements (select at least one)</span>
      <div class="organize-members">
        {#each organizeMemberList as entry (entry.npub)}
          <label class="organize-member-row">
            <input
              type="checkbox"
              checked={organizeSquadMembers.includes(entry.npub)}
              on:change={() => toggleOrganizeMember(entry.npub)}
            />
            <span class="organize-member-name">{organizeMemberDisplayName(entry.npub, entry.name)}</span>
          </label>
        {/each}
      </div>
      {#if organizeMemberList.length === 0}
        <p class="organize-members-empty">Add friends in DMs first to create a squad with them.</p>
      {/if}
      <SquadCommonsVisibilityFields
        bind:this={commonsFields}
        bind:visibility={organizeSquadVisibility}
        bind:tags={organizeSquadTags}
        bind:tagError={organizeSquadTagError}
        fieldsetName="organize-squad-visibility"
      />
      {#if organizeSquadError}
        <p class="organize-error" role="alert">{organizeSquadError}</p>
      {/if}
      <div class="organize-actions">
        <button type="button" class="organize-btn-cancel" on:click={closeOrganizeSquadModal} aria-label="Cancel">
          Cancel
        </button>
        <button type="submit" class="organize-btn-create" disabled={!canCreateSquad} aria-label="Create squad">
          Create
        </button>
      </div>
    </form>
  </Modal>
{/if}

<style>
  .navbar {
    width: 64px;
    height: 100%;
    background-color: var(--bg-panel);
    display: flex;
    flex-direction: column;
    padding-top: 12px;
    padding-bottom: 12px;
    box-sizing: border-box;
    min-height: 0;
  }

  .tab-list {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .tab-list.bottom {
    flex: 0 0 auto;
    padding-bottom: 8px;
  }

  .navbar-add-wrap.is-disabled {
    opacity: 0.45;
    cursor: not-allowed;
    pointer-events: none;
  }

  .navbar-spacer {
    flex: 1;
    min-height: 0;
  }

  .organize-modal-subtitle {
    color: var(--text-muted);
    font-size: 0.9375rem;
    margin: 0 0 24px 0;
  }

  .organize-label {
    display: block;
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin-bottom: 6px;
  }

  .organize-input {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    margin-bottom: 16px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 0.9375rem;
  }

  .organize-input::placeholder {
    color: var(--text-muted);
  }

  .organize-members {
    max-height: 180px;
    overflow-y: auto;
    margin-bottom: 16px;
    padding: 8px 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-elevated);
  }

  .organize-member-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    cursor: pointer;
    color: var(--text-primary);
    font-size: 0.9375rem;
  }

  .organize-member-row:hover {
    background: var(--bg-hover);
  }

  .organize-member-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .organize-members-empty {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0 0 16px 0;
  }

  .organize-error {
    color: var(--danger, #c0392b);
    font-size: 0.875rem;
    margin: 0 0 12px 0;
  }

  .organize-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 24px;
  }

  .organize-btn-cancel {
    padding: 8px 16px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-secondary);
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .organize-btn-cancel:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .organize-btn-create {
    padding: 8px 16px;
    background: var(--accent);
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .organize-btn-create:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .organize-btn-create:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
