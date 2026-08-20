<script lang="ts">
  import Message from './Message.svelte';
  import InviteCard from './InviteCard.svelte';
  import WalletTxRequestCard from '../wallet/WalletTxRequestCard.svelte';
  import WalletTxAnnouncementCard from '../wallet/WalletTxAnnouncementCard.svelte';
  import WalletPeerExchangeCard from '../wallet/WalletPeerExchangeCard.svelte';
  import type { WalletPeerInfoRequestPayload } from '../../lib/wallet/dm-messages';
  import { profiles } from '../../stores/profiles';
  import { currentUser } from '../../stores/auth';
  import { showToast } from '../../stores/toast';
  import { t } from 'svelte-i18n';
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
  import { pendingSquadAdmissions } from '../../stores/pending-squad-admission';
  import {
    squadInviteResolvedByMembership,
    channelInSquadInviteResolvedByMembership,
  } from '../../lib/invites/accept-invite';
  import {
    resolveDmMessagePresentation,
    inviteInviterNpub,
    getInviterDisplayFromNpub,
    getInviterDisplay,
    isInvitePresentation,
    buildPlainMessageProps,
  } from '../../lib/dm/resolve-dm-message-presentation';
  import { isWalletTxAnnouncementOnChainPending } from '../../lib/wallet/dm-messages';
  import { reactToMessage } from '../../lib/api/nostr';
  import { clearPendingReactions } from '../../lib/messaging/reactions';

  interface Props {
    msg: DmMessage;
    npub: string;
    contactDisplayName: string;
    fulfilledWalletRequestIds: ReadonlySet<string>;
    acceptingSquadInviteId?: string | null;
    acceptingChannelInSquadId?: string | null;
    acceptingWalletPeerInfoRequestId?: string | null;
    onAcceptSquadInvite?: (msg: DmMessage, groupId: string) => void;
    onAcceptChannelInSquad?: (
      msg: DmMessage,
      payload: { channelGroupId: string; announcementsGroupId: string; channelName: string }
    ) => void;
    onDeclineSquad?: (msg: DmMessage) => void;
    onDeclineChannelInSquad?: (msg: DmMessage) => void;
    onAcceptWalletPeerInfoRequest?: (
      msg: DmMessage,
      payload: WalletPeerInfoRequestPayload
    ) => void | Promise<void>;
    onDeclineWalletPeerInfoRequest?: (
      msg: DmMessage,
      payload: WalletPeerInfoRequestPayload
    ) => void | Promise<void>;
    onOpenInviterChat?: (inviterNpub: string) => void;
    onReply?: (messageId: string) => void;
    /** Nest under previous same-author plain message (hide avatar/header). */
    compact?: boolean;
  }

  let {
    msg,
    npub,
    contactDisplayName,
    fulfilledWalletRequestIds,
    acceptingSquadInviteId = null,
    acceptingChannelInSquadId = null,
    acceptingWalletPeerInfoRequestId = null,
    onAcceptSquadInvite = () => {},
    onAcceptChannelInSquad = () => {},
    onDeclineSquad = () => {},
    onDeclineChannelInSquad = () => {},
    onAcceptWalletPeerInfoRequest = () => {},
    onDeclineWalletPeerInfoRequest = () => {},
    onOpenInviterChat,
    onReply = () => {},
    compact = false,
  }: Props = $props();

  let presentation = $derived(resolveDmMessagePresentation(msg));
  let inviterNpubForCard = $derived(isInvitePresentation(presentation) ? inviteInviterNpub(msg, npub) : null);
  let inviterDisplay = $derived(
    isInvitePresentation(presentation)
      ? getInviterDisplayFromNpub(inviterNpubForCard, $profiles)
      : { inviterName: '', inviterAvatarSrc: null }
  );
  let openInviter = $derived(
    !msg.mine && inviterNpubForCard && inviterNpubForCard !== npub && onOpenInviterChat
      ? () => onOpenInviterChat!(inviterNpubForCard!)
      : undefined
  );

  async function onReact(messageId: string, emoji: string) {
    try {
      await reactToMessage(messageId, npub, emoji);
    } catch (e: unknown) {
      clearPendingReactions(messageId);
      showToast(e instanceof Error ? e.message : 'Could not add reaction');
    }
  }

  function onCopy(_messageId: string, text: string) {
    if (!navigator.clipboard) {
      showToast('Copy not available on this device');
      return;
    }
    navigator.clipboard.writeText(text).catch(() => showToast('Could not copy message'));
  }
</script>

{#if presentation.kind === 'local-announcement'}
  <div class="dm-thread-announcement" role="status">{msg.content}</div>
{:else if presentation.kind === 'channel-in-squad'}
  {@const channelInviteStatus = $acceptedChannelInviteMessageIds.includes(msg.id)
    ? 'accepted'
    : $declinedChannelInviteMessageIds.includes(msg.id)
      ? 'declined'
      : channelInSquadInviteResolvedByMembership(
          presentation.payload.announcementsGroupId,
          presentation.payload.channelGroupId
        )
        ? 'accepted'
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
      : squadInviteResolvedByMembership(presentation.payload.groupId)
        ? 'accepted'
        : $pendingSquadAdmissions.some(
              (p) =>
                p.messageId === msg.id ||
                p.groupId.trim().toLowerCase() === presentation.payload.groupId.trim().toLowerCase()
            )
          ? 'joining'
          : 'pending'}
  <InviteCard
    variant={presentation.kind === 'squad-pair-invite' ? 'squad-pair' : 'squad'}
    squadName={presentation.payload.squadName}
    memberSquads={presentation.payload.pairedSquads ?? []}
    isMine={msg.mine}
    inviterName={inviterDisplay.inviterName}
    inviterAvatarSrc={inviterDisplay.inviterAvatarSrc}
    squadIconUrl={presentation.payload.iconUrl}
    squadId={presentation.payload.groupId}
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
{:else if presentation.kind === 'bot-join-response'}
  <div class="dm-thread-announcement" role="status">
    {#if presentation.payload.status === 'accepted'}
      {$t('messaging.dm.thread.joinRequestAccepted', { values: { squadName: presentation.payload.squadName } })}
    {:else}
      {$t('messaging.dm.thread.joinRequestRejected', { values: { squadName: presentation.payload.squadName } })}
    {/if}
  </div>
{:else if presentation.kind === 'bot-join-dm'}
  <div class="dm-thread-announcement" role="status">
    {$t('messaging.dm.thread.joinRequestPending', { values: { squadName: presentation.payload.squadName } })}
  </div>
{:else if presentation.kind === 'structured-notice'}
  <div class="dm-thread-announcement" role="status">{presentation.text}</div>
{:else}
  <Message
    {...buildPlainMessageProps(msg, npub, $profiles, $currentUser?.npub)}
    reactions={msg.reactions}
    attachments={msg.attachments}
    previewMetadata={msg.preview_metadata}
    profiles={$profiles}
    currentUserNpub={$currentUser?.npub}
    chatId={npub}
    {onReact}
    {onCopy}
    {onReply}
    {compact}
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
