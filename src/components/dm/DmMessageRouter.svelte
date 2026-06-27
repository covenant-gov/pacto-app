<script lang="ts">
  import Message from './Message.svelte';
  import InviteCard from './InviteCard.svelte';
  import WalletTxRequestCard from '../wallet/WalletTxRequestCard.svelte';
  import WalletTxAnnouncementCard from '../wallet/WalletTxAnnouncementCard.svelte';
  import WalletPeerExchangeCard from '../wallet/WalletPeerExchangeCard.svelte';
  import CommonsJoinRequestCard from './CommonsJoinRequestCard.svelte';
  import type { WalletPeerInfoRequestPayload } from '../../lib/wallet/dm-messages';
  import { profiles } from '../../stores/profiles';
  import { currentUser } from '../../stores/auth';
  import { showToast } from '../../stores/toast';
  import {
    acceptedSquadInviteIds,
    declinedSquadInviteIds,
    acceptedChannelInviteMessageIds,
    declinedChannelInviteMessageIds,
    declinedWalletTxRequestMessageIds,
    acceptedWalletPeerInfoRequestMessageIds,
    declinedWalletPeerInfoRequestMessageIds,
    walletSidebarOpen,
    walletSendPrefillFromRequest,
    type DmMessage,
  } from '../../stores/app';
  import {
    resolveDmMessagePresentation,
    inviteInviterNpub,
    getInviterDisplayFromNpub,
    getInviterDisplay,
    isInvitePresentation,
    buildPlainMessageProps,
  } from '../../lib/dm/resolve-dm-message-presentation';
  import { isWalletTxAnnouncementOnChainPending } from '../../lib/wallet/dm-messages';

  export let msg: DmMessage;
  export let npub: string;
  export let isPactoAppThread: boolean;
  export let contactDisplayName: string;
  export let fulfilledWalletRequestIds: Set<string>;
  export let acceptingSquadInviteId: string | null = null;
  export let acceptingChannelInSquadId: string | null = null;
  export let acceptingWalletPeerInfoRequestId: string | null = null;
  export let onAcceptSquadInvite: (msg: DmMessage, groupId: string) => void = () => {};
  export let onAcceptChannelInSquad: (
    msg: DmMessage,
    payload: { channelGroupId: string; announcementsGroupId: string; channelName: string }
  ) => void = () => {};
  export let onDeclineSquad: (msg: DmMessage) => void = () => {};
  export let onDeclineChannelInSquad: (msg: DmMessage) => void = () => {};
  export let onAcceptWalletPeerInfoRequest: (
    msg: DmMessage,
    payload: WalletPeerInfoRequestPayload
  ) => void | Promise<void> = () => {};
  export let onDeclineWalletPeerInfoRequest: (
    msg: DmMessage,
    payload: WalletPeerInfoRequestPayload
  ) => void | Promise<void> = () => {};
  export let onOpenInviterChat: ((inviterNpub: string) => void) | undefined = undefined;

  $: presentation = resolveDmMessagePresentation(msg);
  $: inviterNpubForCard = isInvitePresentation(presentation) ? inviteInviterNpub(msg, npub) : null;
  $: inviterDisplay = isInvitePresentation(presentation)
    ? getInviterDisplayFromNpub(inviterNpubForCard, $profiles)
    : { inviterName: '', inviterAvatarSrc: null };
  $: openInviter =
    isPactoAppThread && !msg.mine && inviterNpubForCard && onOpenInviterChat
      ? () => onOpenInviterChat!(inviterNpubForCard!)
      : undefined;
</script>

{#if presentation.kind === 'local-announcement'}
  <div class="dm-thread-announcement" role="status">{msg.content}</div>
{:else if presentation.kind === 'channel-in-squad'}
  {@const channelInviteStatus = $acceptedChannelInviteMessageIds.includes(msg.id)
    ? 'accepted'
    : $declinedChannelInviteMessageIds.includes(msg.id)
      ? 'declined'
      : 'pending'}
  <InviteCard
    variant="channel-in-squad"
    squadName={presentation.payload.squadName}
    channelName={presentation.payload.channelName}
    isMine={msg.mine}
    inviterName={inviterDisplay.inviterName}
    inviterAvatarSrc={inviterDisplay.inviterAvatarSrc}
    status={channelInviteStatus}
    accepting={acceptingChannelInSquadId === msg.id}
    onAccept={() =>
      onAcceptChannelInSquad(msg, {
        channelGroupId: presentation.payload.channelGroupId,
        announcementsGroupId: presentation.payload.announcementsGroupId,
        channelName: presentation.payload.channelName,
      })}
    onDecline={() => onDeclineChannelInSquad(msg)}
  />
{:else if presentation.kind === 'squad-invite' || presentation.kind === 'squad-pair-invite'}
  {@const inviteStatus = $acceptedSquadInviteIds.includes(msg.id)
    ? 'accepted'
    : $declinedSquadInviteIds.includes(msg.id)
      ? 'declined'
      : 'pending'}
  <InviteCard
    variant={presentation.kind === 'squad-pair-invite' ? 'squad-pair' : 'squad'}
    squadName={presentation.payload.squadName}
    memberSquads={presentation.payload.pairedSquads ?? []}
    isMine={msg.mine}
    inviterName={inviterDisplay.inviterName}
    inviterAvatarSrc={inviterDisplay.inviterAvatarSrc}
    status={inviteStatus}
    accepting={acceptingSquadInviteId === msg.id}
    onAccept={() => onAcceptSquadInvite(msg, presentation.payload.groupId)}
    onDecline={() => onDeclineSquad(msg)}
    onMessageInviter={openInviter}
  />
{:else if presentation.kind === 'wallet-peer-info-request'}
  {@const wpeerReqStatus = $acceptedWalletPeerInfoRequestMessageIds.includes(msg.id)
    ? 'accepted'
    : $declinedWalletPeerInfoRequestMessageIds.includes(msg.id)
      ? 'declined'
      : 'pending'}
  {@const wpeerName = getInviterDisplay(msg, npub, $profiles).inviterName}
  <WalletPeerExchangeCard
    variant={msg.mine ? 'request-out' : 'request-in'}
    peerName={wpeerName}
    status={wpeerReqStatus}
    accepting={acceptingWalletPeerInfoRequestId === msg.id}
    onAccept={msg.mine ? undefined : () => onAcceptWalletPeerInfoRequest(msg, presentation.payload)}
    onDecline={msg.mine ? undefined : () => onDeclineWalletPeerInfoRequest(msg, presentation.payload)}
  />
{:else if presentation.kind === 'wallet-peer-info-grant'}
  {@const wpeerGrantName = getInviterDisplay(msg, npub, $profiles).inviterName}
  <WalletPeerExchangeCard
    variant={msg.mine ? 'grant-out' : 'grant-in'}
    peerName={wpeerGrantName}
  />
{:else if presentation.kind === 'wallet-peer-info-decline'}
  {@const wpeerDeclName = getInviterDisplay(msg, npub, $profiles).inviterName}
  <WalletPeerExchangeCard
    variant={msg.mine ? 'decline-out' : 'decline-in'}
    peerName={wpeerDeclName}
  />
{:else if presentation.kind === 'wallet-tx-request'}
  {@const walletFulfilled = fulfilledWalletRequestIds.has(presentation.payload.request_id)}
  {@const walletReqStatus = msg.pending && msg.mine
    ? 'sending'
    : walletFulfilled
      ? 'fulfilled'
      : $declinedWalletTxRequestMessageIds.includes(msg.id)
        ? 'declined'
        : 'pending'}
  <WalletTxRequestCard
    payload={presentation.payload}
    isMine={msg.mine}
    peerDisplayName={getInviterDisplay(msg, npub, $profiles).inviterName}
    status={walletReqStatus}
    accepting={false}
    onAccept={() => {
      declinedWalletTxRequestMessageIds.update((ids) => ids.filter((id) => id !== msg.id));
      walletSendPrefillFromRequest.set({
        targetNpub: npub,
        network: presentation.payload.network,
        asset: presentation.payload.asset,
        amount: presentation.payload.amount,
        requestId: presentation.payload.request_id,
        requestMessageId: msg.id,
      });
      walletSidebarOpen.set(true);
    }}
    onDecline={() => {
      declinedWalletTxRequestMessageIds.update((ids) =>
        ids.includes(msg.id) ? ids : [...ids, msg.id]
      );
      if (!msg.mine) {
        showToast('Payment request declined. The requester was not notified.');
      }
    }}
  />
{:else if presentation.kind === 'wallet-tx-announcement'}
  <WalletTxAnnouncementCard
    payload={presentation.payload}
    peerDisplayName={contactDisplayName}
    viewerIsSender={$currentUser?.npub === presentation.payload.from_npub}
    pending={isWalletTxAnnouncementOnChainPending(presentation.payload, msg)}
    failed={!!msg.failed}
  />
{:else if presentation.kind === 'commons-join-request'}
  {@const requesterName = getInviterDisplay(msg, npub, $profiles).inviterName}
  <CommonsJoinRequestCard payload={presentation.payload} isMine={msg.mine} {requesterName} />
{:else}
  <Message
    {...buildPlainMessageProps(msg, npub, $profiles, $currentUser?.npub)}
  />
{/if}

<style>
  .dm-thread-announcement {
    max-width: 36rem;
    margin: 12px auto;
    padding: 8px 14px;
    font-size: 0.8125rem;
    line-height: 1.35;
    text-align: center;
    color: var(--text-secondary);
    background: var(--bg-hover);
    border-radius: 8px;
    border: 1px solid var(--bg-elevated);
  }
</style>
