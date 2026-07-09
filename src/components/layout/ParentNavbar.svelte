<script lang="ts">
  import ParentSidebar from './ParentSidebar.svelte';
  import CreateChannelModal from '../channel/CreateChannelModal.svelte';
  import InviteToParentModal from '../channel/InviteToParentModal.svelte';
  import ExitParentModal from '../channel/ExitParentModal.svelte';
  import PairWithSquadModal from '../squad/PairWithSquadModal.svelte';
  import {
    squads,
    parentsCreatingAnnouncements,
    parentCreateErrorById,
    parentPendingCreateMembers,
    DASHBOARD_CHANNEL_ID,
    type Squad,
  } from '../../stores/squads';
  import {
    activeSquadId,
    activeChannelId,
    activeHubChannelName,
    activeView,
    activeTopNavTab,
    lastChannelBySquadId,
    lastHubChannelNameBySquadId,
  } from '../../stores/navigation';
  import { dmList, requestsList, pendingList } from '../../stores/dm';
  import { getInvokeErrorMessage, friendlyMessage } from '../../lib/utils/tauri-errors';
  import { showToast } from '../../stores/toast';
  import { getProfileDisplayName } from '../../lib/utils/profile';
  import { profiles } from '../../stores/profiles';
  import { currentUser } from '../../stores/auth';
  import { partnerSquadsForHubParent } from '../../lib/squad-pair';
  import { activateSquadHub } from '../../lib/squad-hub-nav';
  import {
    collectInviteNpubsForSquads,
    pairPartnerExcludeSquadIds,
    resolvePairAnchorFromHub,
    partnerSquadCandidates,
    runSquadPairCreateFlow,
    retryParentAnnouncementsCreate,
  } from '../../lib/squad-pair-create';
  import { resolveSquadCommonsOnCreate, validatePublicSquadTags } from '../../lib/squad/squad-commons-fields';
  import type { SquadVisibility } from '../../stores/squads';
  import { getMlsGroupMembers } from '../../lib/api/nostr';
  import {
    loadCreateChannelMemberList,
    runCreateChannelInParent,
  } from '../../lib/parent/create-channel-flow';
  import {
    loadInviteCandidateNpubs,
    runInviteMembersToParent,
  } from '../../lib/parent/invite-members-flow';
  import { runExitParent } from '../../lib/parent/exit-parent-flow';
  import { buildHubSidebarChannels } from '../../lib/parent-navbar';
  import { deferredSquadRosterKeyParentIds } from '../../lib/squad/squad-roster-key-choice';
  import {
    ensureJoinRequestsHydratedForSquads,
    isJoinRequestsHydrated,
    syncJoinRequestsForSquad,
  } from '../../stores/squad-join-requests';
  import { refreshPersonalAlertForSquad } from '../../stores/squad-hub-alerts';

  $: activeParent = $squads.find((s) => s.id === $activeSquadId) as Squad | undefined;

  $: if ($activeTopNavTab === 'squads' && $squads.length > 0) {
    void ensureJoinRequestsHydratedForSquads($squads);
  }

  $: activeSquadJoinRequestSyncKey =
    $activeTopNavTab === 'squads' && activeParent ? activeParent.id : '';
  $: if (activeSquadJoinRequestSyncKey && isJoinRequestsHydrated(activeSquadJoinRequestSyncKey)) {
    void syncJoinRequestsForSquad(activeSquadJoinRequestSyncKey);
  }

  $: if ($activeTopNavTab === 'squads' && activeParent && $deferredSquadRosterKeyParentIds) {
    void refreshPersonalAlertForSquad(activeParent);
  }

  $: personalAlertRefreshKey =
    $activeTopNavTab === 'squads' && activeParent
      ? `${activeParent.id}:${$activeChannelId ?? ''}:${$activeHubChannelName ?? ''}`
      : '';
  $: if (personalAlertRefreshKey && activeParent) {
    void refreshPersonalAlertForSquad(activeParent);
  }

  $: rawChannels = activeParent
    ? [...activeParent.channels].sort((a, b) => a.order - b.order)
    : [];
  $: channels = activeParent ? buildHubSidebarChannels(rawChannels) : [];

  $: creating =
    activeParent &&
    activeParent.channels.length === 0 &&
    $parentsCreatingAnnouncements.has(activeParent.id);

  $: createError = activeParent ? $parentCreateErrorById[activeParent.id] ?? '' : '';

  $: canRetryCreate =
    activeParent &&
    createError &&
    ($parentPendingCreateMembers[activeParent.id]?.length ?? 0) > 0;

  $: subheading =
    activeParent &&
    activeParent.kind === 'squad-pair' &&
    activeParent.pairedSquads
      ? activeParent.pairedSquads.map((s) => s.name).join(', ')
      : undefined;

  $: showPartnerSquadsSection = !!activeParent && !!$activeSquadId;

  $: partnerSquads =
    showPartnerSquadsSection && $activeSquadId
      ? partnerSquadsForHubParent($squads, $activeSquadId).map((s) => ({ id: s.id, name: s.name }))
      : [];

  $: pairAnchorSquad =
    activeParent && showPartnerSquadsSection ? resolvePairAnchorFromHub(activeParent, $squads) : undefined;

  $: canPairFromHub = !!pairAnchorSquad;

  $: activePartnerSquadId =
    activeParent && activeParent.kind === 'squad-pair' ? activeParent.id : null;

  function selectPartnerSquad(squadPairId: string) {
    activateSquadHub(squadPairId);
  }

  let showPairWithSquadModal = false;
  let pairCreateError = '';
  let pairCreating = false;
  let pairModal: PairWithSquadModal;

  $: pairPartnerCandidates =
    pairAnchorSquad && activeParent
      ? partnerSquadCandidates(
          $squads,
          pairAnchorSquad.id,
          pairPartnerExcludeSquadIds(activeParent, pairAnchorSquad)
        )
      : [];

  function openPairWithSquadModal() {
    if (!canPairFromHub || !showPartnerSquadsSection || !canShowParentMenuActions) return;
    pairCreateError = '';
    showPairWithSquadModal = true;
    pairModal?.resetForm();
  }

  function closePairWithSquadModal() {
    if (pairCreating) return;
    showPairWithSquadModal = false;
    pairCreateError = '';
  }

  async function handleCreateSquadPair(params: {
    name: string;
    partnerSquadId: string;
    iconUrl?: string;
    visibility: SquadVisibility;
    commonsTags?: string[];
  }) {
    const anchor = pairAnchorSquad;
    if (!anchor || pairCreating) return;
    const partner = $squads.find((s) => s.id === params.partnerSquadId);
    if (!partner) {
      pairCreateError = 'Could not find the selected squads.';
      return;
    }
    if (params.visibility === 'public') {
      const tagErr = validatePublicSquadTags(params.commonsTags ?? []);
      if (tagErr) {
        pairCreateError = tagErr;
        return;
      }
    }
    let commons: { visibility: SquadVisibility; commonsTags?: string[] };
    try {
      commons = resolveSquadCommonsOnCreate(params.visibility, params.commonsTags ?? []);
    } catch (e) {
      pairCreateError = e instanceof Error ? e.message : 'Invalid tags.';
      return;
    }
    pairCreating = true;
    pairCreateError = '';
    try {
      const memberNpubs = await collectInviteNpubsForSquads(
        [anchor, partner],
        $currentUser?.npub,
        (gid) => getMlsGroupMembers(gid)
      );
      if (memberNpubs.length === 0) {
        pairCreateError = 'No other members to invite in these squads.';
        return;
      }
      showPairWithSquadModal = false;
      runSquadPairCreateFlow(params.name, memberNpubs, anchor, partner, params.iconUrl, commons);
    } catch (e) {
      pairCreateError = friendlyMessage(getInvokeErrorMessage(e));
    } finally {
      pairCreating = false;
    }
  }

  $: emptyMessage = 'Select a squad';

  $: canShowParentMenuActions =
    !!activeParent && !creating && activeParent.channels.length > 0;

  let retryingCreate = false;
  let inviteErrorBanner = '';
  let createChannelErrorBanner = '';

  $: errorBanners = [
    ...(inviteErrorBanner ? [{ id: 'invite', text: inviteErrorBanner }] : []),
    ...(createChannelErrorBanner ? [{ id: 'createChannel', text: createChannelErrorBanner }] : []),
  ];

  function onDismissBanner(id: string) {
    if (id === 'invite') inviteErrorBanner = '';
    if (id === 'createChannel') createChannelErrorBanner = '';
  }

  function selectChannel(channel: { groupId: string; name: string }) {
    activeChannelId.set(channel.groupId);
    activeHubChannelName.set(channel.groupId === DASHBOARD_CHANNEL_ID ? null : channel.name);
    activeView.set('hub');
    if ($activeSquadId) {
      const sid = $activeSquadId;
      lastChannelBySquadId.update((m) => ({ ...m, [sid]: channel.groupId }));
      lastHubChannelNameBySquadId.update((m) => {
        const next = { ...m };
        if (channel.groupId === DASHBOARD_CHANNEL_ID) delete next[sid];
        else next[sid] = channel.name;
        return next;
      });
    }
  }

  async function handleRetryCreate() {
    const parent = activeParent;
    if (!parent || !createError || retryingCreate) return;
    if (!$parentPendingCreateMembers[parent.id]?.length) return;
    retryingCreate = true;
    try {
      await retryParentAnnouncementsCreate(parent);
    } catch (e) {
      parentCreateErrorById.update((m) => ({
        ...m,
        [parent.id]: friendlyMessage(getInvokeErrorMessage(e)),
      }));
    } finally {
      retryingCreate = false;
    }
  }

  let showCreateChannelModal = false;
  let createChannelName = '';
  let selectedNpubs: string[] = [];
  let createChannelError = '';
  let createChannelMemberList: string[] = [];
  let loadingCreateChannelMembers = false;

  function openCreateChannelModal() {
    showCreateChannelModal = true;
    createChannelName = '';
    selectedNpubs = [];
    createChannelError = '';
    createChannelMemberList = [];
    void loadCreateChannelMembers();
  }

  async function loadCreateChannelMembers() {
    const parent = $squads.find((s) => s.id === $activeSquadId);
    if (!parent) return;
    loadingCreateChannelMembers = true;
    try {
      createChannelMemberList = await loadCreateChannelMemberList(parent, $currentUser?.npub);
    } catch {
      createChannelMemberList = [];
    } finally {
      loadingCreateChannelMembers = false;
    }
  }

  function closeCreateChannelModal() {
    showCreateChannelModal = false;
  }

  function toggleMember(npub: string) {
    selectedNpubs = selectedNpubs.includes(npub)
      ? selectedNpubs.filter((n) => n !== npub)
      : [...selectedNpubs, npub];
  }

  $: canCreateChannel = createChannelName.trim().length > 0 && selectedNpubs.length > 0;

  $: createChannelAllSelected =
    createChannelMemberList.length > 0 &&
    selectedNpubs.length === createChannelMemberList.length &&
    createChannelMemberList.every((n) => selectedNpubs.includes(n));

  function toggleCreateChannelSelectEveryone() {
    selectedNpubs = createChannelAllSelected ? [] : [...createChannelMemberList];
  }

  function handleCreateChannel() {
    const name = createChannelName.trim();
    if (!name) return;
    if (selectedNpubs.length === 0) {
      createChannelError = 'Select at least one member';
      return;
    }
    const parent = activeParent;
    const squadId = $activeSquadId;
    if (!parent || !squadId) {
      createChannelError = 'Squad not found';
      return;
    }
    createChannelError = '';
    createChannelErrorBanner = '';
    closeCreateChannelModal();
    runCreateChannelInParent({
      parent,
      squadId,
      name,
      selectedNpubs,
      onErrorBanner: (message) => {
        createChannelErrorBanner = message;
        setTimeout(() => {
          createChannelErrorBanner = '';
        }, 8000);
      },
    });
  }

  function getMemberDisplayName(npub: string) {
    return getProfileDisplayName($profiles[npub] ?? null) || npub.slice(0, 16) + '…';
  }

  let showInviteModal = false;
  let inviteCandidates: string[] = [];
  let selectedInviteNpubs: string[] = [];
  let inviteByNpub = '';
  let loadingInvite = false;
  let inviteError = '';
  let inviting = false;

  function openInviteModal() {
    showInviteModal = true;
    selectedInviteNpubs = [];
    inviteByNpub = '';
    inviteError = '';
    void loadInviteCandidates();
  }

  function toggleInviteCandidate(npub: string) {
    selectedInviteNpubs = selectedInviteNpubs.includes(npub)
      ? selectedInviteNpubs.filter((n) => n !== npub)
      : [...selectedInviteNpubs, npub];
  }

  async function loadInviteCandidates() {
    const parent = activeParent;
    if (!parent) return;
    loadingInvite = true;
    try {
      const dmNpubs = [...$dmList, ...$requestsList, ...$pendingList].map((e) => e.npub);
      inviteCandidates = await loadInviteCandidateNpubs(parent, dmNpubs, $currentUser?.npub);
    } catch {
      inviteCandidates = [];
    } finally {
      loadingInvite = false;
    }
  }

  function closeInviteModal() {
    if (!inviting) showInviteModal = false;
  }

  function handleInvite() {
    const parent = activeParent;
    if (!parent) return;
    const extraNpub = inviteByNpub.trim();
    const npubsToInvite = [
      ...selectedInviteNpubs,
      ...(extraNpub && extraNpub.startsWith('npub1') ? [extraNpub] : []),
    ];
    if (npubsToInvite.length === 0) {
      inviteError =
        extraNpub
          ? 'Please enter a valid npub (starts with npub1) or pick from the list.'
          : 'Select at least one person or enter an npub.';
      return;
    }
    if (extraNpub && !extraNpub.startsWith('npub1')) {
      inviteError = 'Please enter a valid npub (starts with npub1) or pick from the list.';
      return;
    }
    inviteError = '';
    inviteErrorBanner = '';
    showInviteModal = false;
    inviting = true;
    runInviteMembersToParent({
      parent,
      npubsToInvite,
      onErrorBanner: (message) => {
        inviteErrorBanner = message;
        setTimeout(() => {
          inviteErrorBanner = '';
        }, 8000);
      },
      onComplete: (_invitedNpubs) => {
        inviting = false;
      },
    });
  }

  let showExitModal = false;
  let exitError = '';

  function openExitModal() {
    showExitModal = true;
    exitError = '';
  }

  function closeExitModal() {
    showExitModal = false;
  }

  function handleExitParent() {
    const squad = $squads.find((s) => s.id === $activeSquadId);
    if (!squad) return;
    showExitModal = false;
    exitError = '';
    runExitParent({
      squad,
      wasActive: $activeSquadId === squad.id,
      previousChannelId: $activeChannelId,
      onFailure: (msg) => showToast(`Could not exit squad "${squad.name}": ${msg}`),
    });
  }
</script>

<ParentSidebar
  parentName={activeParent?.name ?? ''}
  subheading={subheading}
  squadId={activeParent?.id ?? null}
  channels={channels}
  activeChannelId={$activeChannelId}
  activeHubChannelName={$activeHubChannelName}
  activeView={$activeView}
  creating={Boolean(creating)}
  createError={createError}
  canRetryCreate={Boolean(canRetryCreate)}
  retryingCreate={retryingCreate}
  emptyMessage={emptyMessage}
  hasParent={!!activeParent}
  errorBanners={errorBanners}
  onDismissBanner={onDismissBanner}
  onSelectChannel={selectChannel}
  onCreateChannel={openCreateChannelModal}
  onRetryCreate={handleRetryCreate}
  onInvite={openInviteModal}
  onExitSquad={openExitModal}
  partnerSquads={partnerSquads}
  activePartnerSquadId={activePartnerSquadId}
  onSelectPartnerSquad={selectPartnerSquad}
  showPairWithSquadAction={canPairFromHub && showPartnerSquadsSection && !!canShowParentMenuActions}
  onPairWithSquad={openPairWithSquadModal}
/>

<CreateChannelModal
  open={showCreateChannelModal}
  parentName={activeParent?.name ?? ''}
  subtitle={"Add a channel to " + (activeParent?.name ?? 'this squad') + ". Choose a name and at least one member."}
  membersLabel="Members (squad announcements only, select at least one)"
  bind:channelName={createChannelName}
  memberList={createChannelMemberList}
  loading={loadingCreateChannelMembers}
  bind:selectedNpubs={selectedNpubs}
  selectAllLabel="Add everyone in squad"
  emptyMessage="Invite people to the squad (announcements) first to add them to new channels."
  error={createChannelError}
  creating={false}
  canCreate={canCreateChannel}
  onClose={closeCreateChannelModal}
  onCreate={handleCreateChannel}
  onToggleMember={toggleMember}
  onToggleSelectAll={toggleCreateChannelSelectEveryone}
  getMemberDisplayName={getMemberDisplayName}
/>

<InviteToParentModal
  open={showInviteModal}
  parentName={activeParent?.name ?? ''}
  title="Invite to Squad"
  subtitle={"Invite friends to " + (activeParent?.name ?? 'this Squad') + "."}
  candidates={inviteCandidates}
  bind:selectedNpubs={selectedInviteNpubs}
  bind:inviteByNpub={inviteByNpub}
  loading={loadingInvite}
  emptyMessage="No one to invite right now. Start a DM with someone first, or they may already be in this Squad."
  error={inviteError}
  inviting={inviting}
  onClose={closeInviteModal}
  onInvite={handleInvite}
  onToggleCandidate={toggleInviteCandidate}
  getCandidateDisplayName={getMemberDisplayName}
/>

<ExitParentModal
  open={showExitModal}
  parentName={activeParent?.name ?? ''}
  error={exitError}
  exiting={false}
  onClose={closeExitModal}
  onConfirm={handleExitParent}
/>

<PairWithSquadModal
  bind:this={pairModal}
  open={showPairWithSquadModal}
  anchorSquadName={activeParent?.name ?? pairAnchorSquad?.name ?? ''}
  candidates={pairPartnerCandidates}
  error={pairCreateError}
  creating={pairCreating}
  onClose={closePairWithSquadModal}
  onCreate={handleCreateSquadPair}
/>
