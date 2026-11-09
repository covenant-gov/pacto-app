<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import InviteToParentModal from '../../channel/InviteToParentModal.svelte';
  import ExitParentModal from '../../channel/ExitParentModal.svelte';
  import {
    loadInviteCandidateNpubs,
    runInviteMembersToParent,
  } from '../../../lib/parent/invite-members-flow';
  import { runExitParent } from '../../../lib/parent/exit-parent-flow';
  import { getProfileDisplayName } from '../../../lib/utils/profile';
  import { dmList, requestsList, pendingList } from '../../../stores/dm';
  import { profiles } from '../../../stores/profiles';
  import { currentUser } from '../../../stores/auth-session';
  import { activeChannelId, activeSquadId } from '../../../stores/navigation';
  import { showToast } from '../../../stores/toast';
  import type { Squad } from '../../../stores/squads';

  let { squad }: { squad: Squad } = $props();

  const translate = get(t);

  let showInviteModal = $state(false);
  let inviteCandidates: string[] = $state([]);
  let selectedInviteNpubs: string[] = $state([]);
  let inviteByNpub = $state('');
  let loadingInvite = $state(false);
  let inviteError = $state('');
  let inviting = $state(false);

  let showExitModal = $state(false);
  let exitError = $state('');

  let inviteModalTitle = $derived($t('nav.parentNavbar.invite.title'));
  let inviteModalSubtitle = $derived(
    $t('nav.parentNavbar.invite.subtitle', {
      values: { squadName: squad.name || $t('nav.parentNavbar.thisSquad') },
    }),
  );
  let inviteModalEmptyMessage = $derived($t('nav.parentNavbar.invite.empty'));

  export function openInvite() {
    showInviteModal = true;
    selectedInviteNpubs = [];
    inviteByNpub = '';
    inviteError = '';
    void loadInviteCandidates();
  }

  export function openExit() {
    showExitModal = true;
    exitError = '';
  }

  function toggleInviteCandidate(npub: string) {
    selectedInviteNpubs = selectedInviteNpubs.includes(npub)
      ? selectedInviteNpubs.filter((n) => n !== npub)
      : [...selectedInviteNpubs, npub];
  }

  async function loadInviteCandidates() {
    loadingInvite = true;
    try {
      const dmNpubs = [...$dmList, ...$requestsList, ...$pendingList].map((e) => e.npub);
      inviteCandidates = await loadInviteCandidateNpubs(squad, dmNpubs, $currentUser?.npub);
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
    const extraNpub = inviteByNpub.trim();
    const npubsToInvite = [
      ...selectedInviteNpubs,
      ...(extraNpub && extraNpub.startsWith('npub1') ? [extraNpub] : []),
    ];
    if (npubsToInvite.length === 0) {
      inviteError = extraNpub
        ? translate('nav.parentNavbar.invite.invalidNpub')
        : translate('nav.parentNavbar.invite.noSelection');
      return;
    }
    if (extraNpub && !extraNpub.startsWith('npub1')) {
      inviteError = translate('nav.parentNavbar.invite.invalidNpub');
      return;
    }
    inviteError = '';
    showInviteModal = false;
    inviting = true;
    runInviteMembersToParent({
      parent: squad,
      npubsToInvite,
      onErrorBanner: (message) => {
        showToast(message);
      },
      onComplete: () => {
        inviting = false;
      },
    });
  }

  function closeExitModal() {
    showExitModal = false;
  }

  function handleExitParent() {
    showExitModal = false;
    exitError = '';
    runExitParent({
      squad,
      wasActive: $activeSquadId === squad.id,
      previousChannelId: $activeChannelId,
      onFailure: (msg) =>
        showToast(
          translate('nav.parentNavbar.exit.failure', {
            values: { squadName: squad.name, message: msg },
          }),
        ),
    });
  }

  function getCandidateDisplayName(npub: string) {
    return getProfileDisplayName($profiles[npub] ?? null) || npub.slice(0, 16) + '…';
  }
</script>

<InviteToParentModal
  open={showInviteModal}
  parentName={squad.name ?? ''}
  title={inviteModalTitle}
  subtitle={inviteModalSubtitle}
  candidates={inviteCandidates}
  bind:selectedNpubs={selectedInviteNpubs}
  bind:inviteByNpub={inviteByNpub}
  loading={loadingInvite}
  emptyMessage={inviteModalEmptyMessage}
  error={inviteError}
  inviting={inviting}
  onClose={closeInviteModal}
  onInvite={handleInvite}
  onToggleCandidate={toggleInviteCandidate}
  {getCandidateDisplayName}
/>

<ExitParentModal
  open={showExitModal}
  parentName={squad.name ?? ''}
  error={exitError}
  exiting={false}
  onClose={closeExitModal}
  onConfirm={handleExitParent}
/>
