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
  import { t } from 'svelte-i18n';
  import { onDestroy } from 'svelte';
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
    squadNavOrder,
    composingNewChat,
    dmList,
    pinnedList,
    dmTabHasUnread,
    addParentCreatingAnnouncements,
    removeParentCreatingAnnouncements,
    parentCreateErrorById,
    parentPendingCreateMembers,
    ANNOUNCEMENTS_CHANNEL_NAME,
    type TopNavTab,
    type DmTab,
    type Squad,
  } from '../../stores/app';
  import { currentUser } from '../../stores/auth';
  import { sendSquadInviteDm } from '../../lib/pacto-app-inbox';
  import { createDefaultParentChannels } from '../../lib/parent-navbar';
  import { activateSquadHub } from '../../lib/squad-hub-nav';
  import { pendingReadyToast } from '../../stores/toast';
  import { schedulePublicSquadCreateBroadcast } from '../../lib/commons/squad-create-broadcast';
  import {
    commonsUserHasActiveBroadcast,
    openCommonsBroadcastModal,
    syncCommonsUserActiveBroadcast,
  } from '../../stores/commons-ui';
  import { getInvokeErrorMessage, friendlyMessage } from '../../lib/utils/tauri-errors';
  import { requireBackupVerified } from '../../stores/backup-verification';
  import { persistCreatedSquad } from '../../lib/squad/squad-catalog';
  import { appendSquadNavId, moveSquadNavIdToGapIndex, orderSquads, removeSquadNavId } from '../../lib/squad/squad-nav-order';
  import { initSquadBot } from '../../lib/squad/squad-bot';
  import { DEFAULT_CHAIN_ID, type SupportedChainId } from '../../lib/wallet/chains';
  import {
    listSquadDeployNetworkOptions,
    saveSquadNetworkOverride,
  } from '../../lib/squad/squad-network';
  import { publishSquadNetworkUpdated } from '../../lib/squad/squad-network-share';
  import { initSquadRpcOnCreate } from '../../lib/squad/squad-rpc';
  import { publishSquadRpcUpdated } from '../../lib/squad/squad-rpc-share';
  import { getProfileDisplayName } from '../../lib/utils/profile';
  import { portal } from '../../lib/utils/portal';
  import { profiles } from '../../stores/profiles';
  import { appConfig } from '../../stores/app-config';

  const translate = get(t);
  $: orderedSquads = orderSquads($squads, $squadNavOrder);

  const SQUAD_DRAG_THRESHOLD_PX = 6;
  let squadRailEl: HTMLDivElement | null = null;
  let squadDragFromId: string | null = null;
  /** Visual gap index in `orderedSquads` (0 = before first, length = after last). */
  let squadDropGapIndex: number | null = null;
  let squadDragMoved = false;
  let squadDropApplied = false;
  let squadPointerId: number | null = null;
  let squadPointerStartY = 0;
  let squadPendingDragId: string | null = null;
  let squadGhost: { x: number; y: number; name: string; image: string } | null = null;
  let squadWindowListenersBound = false;

  function selectSquad(squadId: string) {
    if (squadDragMoved) {
      squadDragMoved = false;
      return;
    }
    activateSquadHub(squadId);
  }

  function railGhostX(): number {
    if (!squadRailEl) return 36;
    const rect = squadRailEl.getBoundingClientRect();
    return rect.left + rect.width / 2;
  }

  function clampGhostY(clientY: number): number {
    if (!squadRailEl) return clientY;
    const rect = squadRailEl.getBoundingClientRect();
    const half = 24;
    return Math.min(Math.max(clientY, rect.top + half), Math.max(rect.top + half, rect.bottom - half));
  }

  function updateSquadDropGapFromY(clientY: number) {
    if (!squadRailEl) return;
    const items = Array.from(squadRailEl.querySelectorAll<HTMLElement>('.squad-nav-item'));
    if (items.length === 0) {
      squadDropGapIndex = 0;
      return;
    }
    for (let i = 0; i < items.length; i++) {
      const rect = items[i]!.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        squadDropGapIndex = i;
        return;
      }
    }
    squadDropGapIndex = items.length;
  }

  function beginSquadGhost(squadId: string, clientY: number) {
    const squad = orderedSquads.find((s) => s.id === squadId);
    if (!squad) {
      squadGhost = null;
      return;
    }
    squadGhost = {
      x: railGhostX(),
      y: clampGhostY(clientY),
      name: squad.name,
      image: squad.iconUrl ?? '',
    };
    document.body.classList.add('pacto-squad-nav-dragging');
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      // ignore
    }
  }

  function moveSquadGhost(clientY: number) {
    if (!squadGhost) return;
    squadGhost = { ...squadGhost, x: railGhostX(), y: clampGhostY(clientY) };
  }

  function applySquadDrop(): boolean {
    if (squadDropApplied) return false;
    const fromId = squadDragFromId;
    const gap = squadDropGapIndex;
    if (!fromId || gap == null) return false;
    const ids = orderedSquads.map((s) => s.id);
    if (!ids.includes(fromId)) return false;
    const next = moveSquadNavIdToGapIndex(ids, fromId, gap);
    if (next.length === ids.length && next.every((id, i) => id === ids[i])) return false;
    squadDropApplied = true;
    squadNavOrder.set(next);
    return true;
  }

  function bindSquadWindowListeners() {
    if (squadWindowListenersBound) return;
    squadWindowListenersBound = true;
    window.addEventListener('pointermove', onWindowSquadPointerMove, { passive: false });
    window.addEventListener('pointerup', onWindowSquadPointerUp, true);
    window.addEventListener('pointercancel', onWindowSquadPointerCancel, true);
    window.addEventListener('selectstart', onSquadSelectStart, true);
  }

  function unbindSquadWindowListeners() {
    if (!squadWindowListenersBound) return;
    squadWindowListenersBound = false;
    window.removeEventListener('pointermove', onWindowSquadPointerMove);
    window.removeEventListener('pointerup', onWindowSquadPointerUp, true);
    window.removeEventListener('pointercancel', onWindowSquadPointerCancel, true);
    window.removeEventListener('selectstart', onSquadSelectStart, true);
  }

  function onSquadSelectStart(e: Event) {
    if (squadDragFromId || squadPendingDragId) e.preventDefault();
  }

  function clearSquadPointerDrag(commit: boolean) {
    unbindSquadWindowListeners();
    if (commit && squadDragFromId && squadDragMoved) applySquadDrop();
    squadDragFromId = null;
    squadDropGapIndex = null;
    squadPointerId = null;
    squadPendingDragId = null;
    squadDropApplied = false;
    squadGhost = null;
    document.body.classList.remove('pacto-squad-nav-dragging');
  }

  onDestroy(() => {
    clearSquadPointerDrag(false);
    unbindSquadWindowListeners();
  });

  function onSquadPointerDown(e: PointerEvent, squadId: string) {
    if (e.button !== 0) return;
    squadPendingDragId = squadId;
    squadPointerId = e.pointerId;
    squadPointerStartY = e.clientY;
    squadDragFromId = null;
    squadDropGapIndex = null;
    squadDragMoved = false;
    squadDropApplied = false;
    squadGhost = null;
    bindSquadWindowListeners();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  function onWindowSquadPointerMove(e: PointerEvent) {
    if (squadPointerId !== e.pointerId || !squadPendingDragId) return;
    if (!squadDragFromId) {
      if (Math.abs(e.clientY - squadPointerStartY) < SQUAD_DRAG_THRESHOLD_PX) return;
      squadDragFromId = squadPendingDragId;
      squadDragMoved = true;
      beginSquadGhost(squadDragFromId, e.clientY);
    } else {
      moveSquadGhost(e.clientY);
    }
    e.preventDefault();
    updateSquadDropGapFromY(e.clientY);
  }

  function onWindowSquadPointerUp(e: PointerEvent) {
    if (squadPointerId !== e.pointerId) return;
    const suppressClick = squadDragMoved && !!squadDragFromId;
    updateSquadDropGapFromY(e.clientY);
    clearSquadPointerDrag(true);
    if (suppressClick) {
      squadDragMoved = true;
      setTimeout(() => {
        squadDragMoved = false;
      }, 0);
    }
  }

  function onWindowSquadPointerCancel(e: PointerEvent) {
    if (squadPointerId !== e.pointerId) return;
    clearSquadPointerDrag(false);
    squadDragMoved = false;
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

  const addButtonLabelKeys: Record<TopNavTab, string> = {
    commons: 'nav.navbar.addButton.commons',
    dms: 'nav.navbar.addButton.dms',
    squads: 'nav.navbar.addButton.squads',
  };
  $: addButtonLabel = showAddButton ? $t(addButtonLabelKeys[$activeTopNavTab]) : '';
  $: showAddButton =
    $activeTopNavTab === 'commons' || $activeTopNavTab === 'dms' || $activeTopNavTab === 'squads';
  $: maxSquadNameLength = $appConfig.squadNameMaxLength;

  $: commonsStartBroadcastDisabled =
    $activeTopNavTab === 'commons' && $commonsUserHasActiveBroadcast;
  $: commonsAddButtonLabel = commonsStartBroadcastDisabled
    ? $t('nav.navbar.addButton.broadcastActive')
    : addButtonLabel;

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
  let organizeSquadNetwork: SupportedChainId | '' = DEFAULT_CHAIN_ID;
  let commonsFields: SquadCommonsVisibilityFields;

  const squadNetworkOptions = listSquadDeployNetworkOptions();

  function openOrganizeSquadModal() {
    if (!requireBackupVerified()) return;
    showOrganizeSquadModal = true;
    organizeSquadName = '';
    organizeSquadIconUrl = '';
    organizeSquadMembers = [];
    organizeSquadError = '';
    organizeSquadVisibility = 'private';
    organizeSquadTags = [];
    organizeSquadTagError = '';
    organizeSquadNetwork = DEFAULT_CHAIN_ID;
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
    options: {
      iconUrl?: string;
      visibility?: SquadVisibility;
      commonsTags?: string[];
      network?: SupportedChainId;
    } = {}
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
    squadNavOrder.update((order) => appendSquadNavId(order, squad.id));
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
        void initSquadBot(groupId);
        const creatorNpub = get(currentUser)?.npub;
        if (creatorNpub && options.network) {
          saveSquadNetworkOverride(creatorNpub, groupId, options.network);
          initSquadRpcOnCreate(creatorNpub, groupId, options.network);
          void publishSquadNetworkUpdated(groupId);
          void publishSquadRpcUpdated(groupId);
        }
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
          text: translate('nav.navbar.organizeSquad.squadReady', { values: { squadName: name } }),
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
          [tempId]: friendlyMessage(getInvokeErrorMessage(e, translate('nav.navbar.organizeSquad.createAnnouncementsError'))),
        }));
        squads.update((list) => list.filter((s) => s.id !== tempId));
        squadNavOrder.update((order) => removeSquadNavId(order, tempId));
        if (get(activeSquadId) === tempId) {
          activeSquadId.set(null);
          activeChannelId.set(null);
          activeHubChannelName.set(null);
        }
      }
    })();
  }

  function handleCreateSquad() {
    if (!requireBackupVerified()) return;
    const name = organizeSquadName.trim();
    if (!name) return;
    if (name.length > maxSquadNameLength) {
      organizeSquadError = translate('nav.navbar.organizeSquad.nameTooLong', {
        values: { max: maxSquadNameLength },
      });
      return;
    }
    organizeSquadError = '';
    const myNpub = $currentUser?.npub;
    const memberIds = (organizeSquadMembers || []).filter((n) => n !== myNpub);
    if (memberIds.length === 0) {
      organizeSquadError = translate('nav.navbar.organizeSquad.noMembersError');
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
      organizeSquadTagError = e instanceof Error ? e.message : translate('nav.navbar.organizeSquad.invalidTags');
      return;
    }
    showOrganizeSquadModal = false;
    createSquadWithAnnouncements(name, memberIds, {
      iconUrl: organizeSquadIconUrl.trim() || undefined,
      visibility: commons.visibility,
      commonsTags: commons.commonsTags,
      network: organizeSquadNetwork || undefined,
    });
  }

  function handleAddAction() {
    if ($activeTopNavTab === 'squads') openOrganizeSquadModal();
  }

  $: canCreateSquad =
    organizeSquadName.trim().length > 0 &&
    organizeSquadMembers.length > 0 &&
    (organizeSquadVisibility !== 'public' || organizeSquadTags.length === 3);
  $: organizeMemberList = [...$pinnedList, ...$dmList];

  $: organizeSquadTitle = $t('nav.navbar.organizeSquad.title');
  $: organizeSquadDescription = $t('nav.navbar.organizeSquad.description');
  $: squadNameLabel = $t('nav.navbar.organizeSquad.nameLabel');
  $: squadNamePlaceholder = $t('nav.navbar.organizeSquad.namePlaceholder');
  $: iconUrlLabel = $t('nav.navbar.organizeSquad.iconLabel');
  $: iconUrlPlaceholder = $t('nav.navbar.organizeSquad.iconPlaceholder');
  $: organizeMembersLabel = $t('nav.navbar.organizeSquad.membersLabel');
  $: organizeMembersEmpty = $t('nav.navbar.organizeSquad.membersEmpty');
  $: organizeNetworkLabel = $t('nav.navbar.organizeSquad.networkLabel');
  $: organizeNetworkNone = $t('nav.navbar.organizeSquad.networkNone');
  $: organizeCancel = $t('nav.navbar.organizeSquad.cancel');
  $: organizeCreate = $t('nav.navbar.organizeSquad.create');
  $: organizeCreateAria = $t('nav.navbar.organizeSquad.createAria');

  $: pinnedTabLabel = $t('nav.navbar.dmTabs.pinned');
  $: friendsTabLabel = $t('nav.navbar.dmTabs.friends');
  $: requestsTabLabel = $t('nav.navbar.dmTabs.requests');
  $: pendingTabLabel = $t('nav.navbar.dmTabs.pending');
  $: searchTabLabel = $t('nav.navbar.dmTabs.search');
  $: settingsTabLabel = $t('nav.navbar.settings');

  $: if (showOrganizeSquadModal) {
    setTimeout(() => document.getElementById('squad-name')?.focus(), 0);
  }
</script>

<div class="navbar">
  {#if $activeView !== 'profile' && $activeTopNavTab !== 'commons'}
  <div
    class="tab-list"
    class:squad-rail-dragging={squadDragFromId != null}
  >
    {#if $activeTopNavTab === 'dms'}
      <div
        on:click={() => selectDmTab('pinned')}
        on:keydown={(e) => e.key === 'Enter' && selectDmTab('pinned')}
        role="button"
        tabindex="0"
      >
        <Tab label={pinnedTabLabel} icon={pinIcon} active={$activeView === 'hub' && $activeDmTab === 'pinned'} hasUnreadDot={$dmTabHasUnread.pinned} />
      </div>
      <div
        on:click={() => selectDmTab('friends')}
        on:keydown={(e) => e.key === 'Enter' && selectDmTab('friends')}
        role="button"
        tabindex="0"
      >
        <Tab label={friendsTabLabel} icon={friendsIcon} active={$activeView === 'hub' && $activeDmTab === 'friends'} hasUnreadDot={$dmTabHasUnread.friends} />
      </div>
      <div
        on:click={() => selectDmTab('requests')}
        on:keydown={(e) => e.key === 'Enter' && selectDmTab('requests')}
        role="button"
        tabindex="0"
      >
        <Tab label={requestsTabLabel} icon={requestsIcon} active={$activeView === 'hub' && $activeDmTab === 'requests'} hasUnreadDot={$dmTabHasUnread.requests} />
      </div>
      <div
        on:click={() => selectDmTab('pending')}
        on:keydown={(e) => e.key === 'Enter' && selectDmTab('pending')}
        role="button"
        tabindex="0"
      >
        <Tab label={pendingTabLabel} icon={pendingIcon} active={$activeView === 'hub' && $activeDmTab === 'pending'} hasUnreadDot={$dmTabHasUnread.pending} />
      </div>
      <div
        on:click={() => selectDmTab('search')}
        on:keydown={(e) => e.key === 'Enter' && selectDmTab('search')}
        role="button"
        tabindex="0"
      >
        <Tab label={searchTabLabel} icon={searchIcon} active={$activeView === 'hub' && $activeDmTab === 'search'} />
      </div>
    {:else if $activeTopNavTab === 'squads'}
      <div
        class="squad-rail"
        role="list"
        bind:this={squadRailEl}
      >
        {#each orderedSquads as squad, index (squad.id)}
          <div
            class="squad-nav-item"
            class:is-dragging={squadDragFromId === squad.id}
            class:drop-gap-before={squadDropGapIndex === index && squadDragFromId != null}
            role="listitem"
            on:pointerdown={(e) => onSquadPointerDown(e, squad.id)}
            on:click={() => selectSquad(squad.id)}
            on:keydown={(e) => e.key === 'Enter' && selectSquad(squad.id)}
            tabindex="0"
          >
            <Tab
              label={squad.name}
              image={squad.iconUrl ?? ''}
              active={$activeView === 'hub' && $activeSquadId === squad.id}
            />
          </div>
        {/each}
        {#if squadDragFromId != null && squadDropGapIndex === orderedSquads.length}
          <div class="squad-drop-gap-end" aria-hidden="true"></div>
        {/if}
      </div>
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
      <Tab label={settingsTabLabel} icon={settingsIcon} active={$activeView === 'profile'} />
    </div>
  </div>
</div>

{#if squadGhost}
  <div
    class="squad-drag-ghost"
    style="transform: translate3d({squadGhost.x - 24}px, {squadGhost.y - 24}px, 0);"
    use:portal
    aria-hidden="true"
  >
    {#if squadGhost.image}
      <img src={squadGhost.image} alt="" />
    {:else}
      <span>{squadGhost.name.charAt(0).toUpperCase()}</span>
    {/if}
  </div>
{/if}

{#if showOrganizeSquadModal}
  <Modal titleId="organize-squad-title" descriptionId="organize-squad-description" onClose={closeOrganizeSquadModal}>
    <h2 id="organize-squad-title">{organizeSquadTitle}</h2>
    <p id="organize-squad-description" class="organize-modal-subtitle">
      {organizeSquadDescription}
    </p>
    <form on:submit|preventDefault={handleCreateSquad}>
      <label class="organize-label" for="squad-name">{squadNameLabel}</label>
      <input
        id="squad-name"
        type="text"
        class="organize-input organize-input-with-count"
        placeholder={squadNamePlaceholder}
        bind:value={organizeSquadName}
        maxlength={maxSquadNameLength}
        required
        aria-describedby="squad-name-char-count"
      />
      <p id="squad-name-char-count" class="organize-char-count">
        {$t('nav.navbar.organizeSquad.nameCharCount', {
          values: { count: organizeSquadName.length, max: maxSquadNameLength },
        })}
      </p>
      <label class="organize-label" for="squad-icon">{iconUrlLabel}</label>
      <input
        id="squad-icon"
        type="url"
        class="organize-input"
        placeholder={iconUrlPlaceholder}
        bind:value={organizeSquadIconUrl}
      />
      <span class="organize-label">{organizeMembersLabel}</span>
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
        <p class="organize-members-empty">{organizeMembersEmpty}</p>
      {/if}
      <label class="organize-label" for="squad-network">{organizeNetworkLabel}</label>
      <select id="squad-network" class="organize-input organize-select" bind:value={organizeSquadNetwork}>
        {#each squadNetworkOptions as opt (opt.id)}
          <option value={opt.id}>{opt.label}</option>
        {/each}
        <option value="">{organizeNetworkNone}</option>
      </select>
      <p class="organize-network-hint">
        {#if organizeSquadNetwork}
          {$t('nav.navbar.organizeSquad.networkHint.withNetwork', { values: { network: squadNetworkOptions.find((o) => o.id === organizeSquadNetwork)?.label ?? '' } })}
        {:else}
          {$t('nav.navbar.organizeSquad.networkHint.noNetwork')}
        {/if}
      </p>
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
        <button type="button" class="organize-btn-cancel" on:click={closeOrganizeSquadModal} aria-label={organizeCancel}>
          {organizeCancel}
        </button>
        <button type="submit" class="organize-btn-create" disabled={!canCreateSquad} aria-label={organizeCreateAria}>
          {organizeCreate}
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

  .organize-input-with-count {
    margin-bottom: 6px;
  }

  .organize-char-count {
    color: var(--text-muted);
    font-size: 0.75rem;
    margin: 0 0 16px 0;
    text-align: right;
  }

  .organize-select {
    margin-bottom: 6px;
    cursor: pointer;
  }

  .organize-network-hint {
    color: var(--text-muted);
    font-size: 0.8125rem;
    line-height: 1.4;
    margin: 0 0 16px 0;
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

  .squad-rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    flex: 1;
    min-height: 0;
    user-select: none;
    -webkit-user-select: none;
  }

  .squad-nav-item {
    position: relative;
    cursor: grab;
    width: 100%;
    display: flex;
    justify-content: center;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }

  .squad-nav-item:active {
    cursor: grabbing;
  }

  /* Nested Tab button steals focus/drop in WebKit — route pointer to the wrapper. */
  .squad-nav-item :global(.server-button) {
    pointer-events: none;
  }

  .squad-nav-item.is-dragging {
    opacity: 0.2;
    cursor: grabbing;
  }

  .squad-nav-item.is-dragging :global(.server-button) {
    background: var(--border-subtle);
    box-shadow: none;
  }

  .squad-nav-item.drop-gap-before::before {
    content: '';
    position: absolute;
    left: 10px;
    right: 10px;
    top: -1px;
    height: 3px;
    border-radius: 2px;
    background: var(--accent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
    pointer-events: none;
    z-index: 2;
  }

  .squad-drop-gap-end {
    width: calc(100% - 20px);
    height: 3px;
    margin: 2px 0 6px;
    border-radius: 2px;
    background: var(--accent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
    flex-shrink: 0;
  }

  /* While dragging, don't paint every hovered pill as "active". */
  .tab-list.squad-rail-dragging .squad-nav-item:not(.is-dragging) :global(.server-button:hover) {
    background: var(--border-subtle);
    box-shadow: none;
  }

  .tab-list.squad-rail-dragging .squad-nav-item:not(.is-dragging) :global(.server-button.active) {
    background: var(--accent);
  }

  .squad-drag-ghost {
    position: fixed;
    left: 0;
    top: 0;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--text-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
    font-weight: 600;
    pointer-events: none;
    z-index: 100000;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    overflow: hidden;
    will-change: transform;
  }

  .squad-drag-ghost img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  :global(body.pacto-squad-nav-dragging),
  :global(body.pacto-squad-nav-dragging *) {
    cursor: grabbing !important;
    user-select: none !important;
    -webkit-user-select: none !important;
  }
</style>
