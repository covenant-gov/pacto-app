<script lang="ts">
  import Message from './Message.svelte';
  import MessageInput from './MessageInput.svelte';
  import InviteCard from './InviteCard.svelte';
  import WalletTxRequestCard from '../wallet/WalletTxRequestCard.svelte';
  import WalletTxAnnouncementCard from '../wallet/WalletTxAnnouncementCard.svelte';
  import WalletPeerExchangeCard from '../wallet/WalletPeerExchangeCard.svelte';
  import { getProfileAvatarSrc, getProfileDisplayName } from '../../lib/utils/profile';
  import {
    parseWalletTxRequest,
    parseWalletTxAnnouncement,
    parseWalletPeerInfoRequest,
    parseWalletPeerInfoGrant,
    parseWalletPeerInfoDecline,
    getFulfilledWalletRequestIdsFromMessages,
    type WalletPeerInfoRequestPayload,
  } from '../../lib/wallet/dm-messages';
  import { setDmPeerEvmAddress } from '../../lib/api/wallet-peers';
  import {
    parseChannelInSquadMessage,
    parseChannelInNetworkMessage,
    parseNetworkInviteMessage,
    parseSquadInviteMessage,
  } from '../../lib/api/nostr';
  import type { NostrProfile } from '../../lib/api/nostr';
  import { profiles } from '../../stores/profiles';
  import {
    pinnedDmNpubs,
    dmSendError,
    typingByChat,
    acceptedSquadInviteIds,
    declinedSquadInviteIds,
    acceptedChannelInviteMessageIds,
    declinedChannelInviteMessageIds,
    acceptedNetworkInviteIds,
    declinedNetworkInviteIds,
    acceptedWalletTxRequestMessageIds,
    declinedWalletTxRequestMessageIds,
    acceptedWalletPeerInfoRequestMessageIds,
    declinedWalletPeerInfoRequestMessageIds,
    dmWalletPeerExchangeTick,
    type DmMessage,
    walletSidebarOpen,
    walletSendPrefillFromRequest,
    toggleWalletSidebar,
  } from '../../stores/app';
  import { currentUser } from '../../stores/auth';
  import { showToast } from '../../stores/toast';

  export let npub: string;
  export let messages: DmMessage[] = [];
  export let canLoadOlder = false;
  export let loadingOlder = false;
  export let onLoadOlder: () => void = () => {};
  export let onSend: (content: string) => void = () => {};
  export let onTyping: () => void = () => {};
  export let onAcceptSquadInvite: (msg: DmMessage, groupId: string) => void = () => {};
  export let onAcceptChannelInSquad: (
    msg: DmMessage,
    payload: { channelGroupId: string; announcementsGroupId: string; channelName: string }
  ) => void = () => {};
  export let onAcceptChannelInNetwork: (
    msg: DmMessage,
    payload: { networkId: string; channelGroupId: string; channelName: string }
  ) => void = () => {};
  export let onAcceptNetworkInvite: (
    msg: DmMessage,
    payload: { networkName: string; groupId: string; memberSquads: { id: string; name: string }[] }
  ) => void = () => {};
  export let onDeclineSquad: (msg: DmMessage) => void = () => {};
  export let onDeclineNetwork: (msg: DmMessage) => void = () => {};
  export let onDeclineChannelInSquad: (msg: DmMessage) => void = () => {};
  export let onDeclineChannelInNetwork: (msg: DmMessage) => void = () => {};
  export let acceptingSquadInviteId: string | null = null;
  export let acceptingChannelInSquadId: string | null = null;
  export let acceptingChannelInNetworkId: string | null = null;
  export let acceptingNetworkInviteId: string | null = null;
  export let showOptionsMenu = true;
  export let showPinOption = true;
  export let onSaveNickname: (value: string) => Promise<void> = async () => {};
  export let onDeleteChat: (() => void) | undefined = undefined;
  export let showWalletButton: boolean = false;
  export let onAcceptWalletPeerInfoRequest: ((msg: DmMessage, payload: WalletPeerInfoRequestPayload) => void | Promise<void>) =
    () => {};
  export let onDeclineWalletPeerInfoRequest: ((
    msg: DmMessage,
    payload: WalletPeerInfoRequestPayload
  ) => void | Promise<void>) = () => {};
  export let acceptingWalletPeerInfoRequestId: string | null = null;

  /** Apply inbound grant messages once so the peer payout address is persisted without showing it in the UI. */
  let appliedWalletGrantIds = new Set<string>();
  let appliedWalletGrantsForNpub: string | null = null;

  $: if (npub !== appliedWalletGrantsForNpub) {
    appliedWalletGrantsForNpub = npub;
    appliedWalletGrantIds = new Set();
  }

  $: (() => {
    const uid = $currentUser?.npub;
    if (!uid || !npub) return;
    for (const msg of messages) {
      if (msg.mine) continue;
      const g = parseWalletPeerInfoGrant(msg.content ?? '');
      if (!g || g.grantor_npub !== npub) continue;
      if (appliedWalletGrantIds.has(msg.id)) continue;
      appliedWalletGrantIds.add(msg.id);
      void setDmPeerEvmAddress(npub, g.evm_address).then(
        () => {
          dmWalletPeerExchangeTick.update((t: number) => t + 1);
        },
        () => {
          appliedWalletGrantIds.delete(msg.id);
        }
      );
    }
  })();

  function truncateNpub(n: string): string {
    if (n.length <= 16) return n;
    return n.slice(0, 8) + '…' + n.slice(-4);
  }

  let dmMessagesContainer: HTMLDivElement | null = null;
  let scrollPrevNpub: string | null = null;
  let lastScrolledToBottomNpub: string | null = null;
  $: if (dmMessagesContainer && messages.length) {
    const container = dmMessagesContainer;
    const conversationJustChanged = npub !== scrollPrevNpub;
    const firstTimeWithMessages = npub !== lastScrolledToBottomNpub;
    if (conversationJustChanged) scrollPrevNpub = npub;
    setTimeout(() => {
      if (!container || !document.contains(container)) return;
      const isNearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      if (conversationJustChanged || firstTimeWithMessages || isNearBottom) {
        container.scrollTop = container.scrollHeight;
        lastScrolledToBottomNpub = npub;
      }
    }, 0);
  }
  $: if (npub !== scrollPrevNpub && messages.length === 0) scrollPrevNpub = npub;

  $: contactProfile = npub ? $profiles[npub] : null;
  $: contactAvatarSrc = getProfileAvatarSrc(contactProfile);
  $: contactDisplayName = contactProfile
    ? getProfileDisplayName(contactProfile)
    : npub
      ? truncateNpub(npub)
      : 'Unknown';

  function getInviterDisplay(
    msg: DmMessage,
    activeDmId: string | null,
    profilesMap: Record<string, NostrProfile | undefined>
  ): { inviterName: string; inviterAvatarSrc: string | null } {
    const otherNpub = msg.mine ? activeDmId : msg.npub ?? activeDmId;
    if (!otherNpub) return { inviterName: 'Someone', inviterAvatarSrc: null };
    const profile = profilesMap[otherNpub];
    const inviterName = getProfileDisplayName(profile ?? null) || otherNpub.slice(0, 12) + '…';
    const inviterAvatarSrc = profile ? getProfileAvatarSrc(profile) : null;
    return { inviterName, inviterAvatarSrc };
  }

  function toMessageProps(msg: DmMessage) {
    const currentUserNpub = $currentUser?.npub;
    const currentUserProfile = currentUserNpub ? $profiles[currentUserNpub] : null;
    const base = {
      id: msg.id,
      authorName: '',
      content: msg.content,
      timestamp: new Date(msg.at).toISOString(),
      avatar: '',
      replyToId: msg.replied_to && msg.replied_to.length > 0 ? msg.replied_to : undefined,
      replyAuthorName: undefined as string | undefined,
      replyPreview: undefined as string | undefined,
    };
    if (msg.mine) {
      base.authorName = 'You';
      base.avatar = getProfileAvatarSrc(currentUserProfile) ?? '';
    } else {
      // DM backend omits `message.npub` (see rumor.rs: implicit peer = chat id); use thread `npub`.
      const senderNpub = msg.npub ?? npub;
      const senderProfile = senderNpub ? $profiles[senderNpub] : null;
      base.authorName = getProfileDisplayName(senderProfile);
      base.avatar = getProfileAvatarSrc(senderProfile) ?? '';
    }
    if (base.replyToId) {
      const replyNpub = msg.replied_to_npub ?? undefined;
      base.replyAuthorName =
        replyNpub && currentUserNpub && replyNpub === currentUserNpub
          ? 'You'
          : replyNpub
            ? getProfileDisplayName($profiles[replyNpub] ?? null)
            : 'Unknown';
      base.replyPreview =
        msg.replied_to_has_attachment === true
          ? 'Attachment'
          : msg.replied_to_content != null && msg.replied_to_content.length > 0
            ? msg.replied_to_content.slice(0, 80).trim() + (msg.replied_to_content.length > 80 ? '…' : '')
            : 'Message';
    }
    return base;
  }

  let menuOpen = false;
  let showNicknameEdit = false;
  let nicknameEditValue = '';
  let nicknameSaving = false;
  let nicknameError: string | null = null;

  /** `request_id`s tied by a `wallet_tx_announcement` in this thread (on-chain completion). */
  $: fulfilledWalletRequestIds = getFulfilledWalletRequestIdsFromMessages(messages);

  function openNicknameEdit() {
    menuOpen = false;
    nicknameEditValue = contactProfile?.nickname ?? '';
    nicknameError = null;
    showNicknameEdit = true;
  }

  function pinDm() {
    pinnedDmNpubs.update((s) => {
      if (s.has(npub)) return s;
      const next = new Set(s);
      next.add(npub);
      return next;
    });
    menuOpen = false;
  }

  function unpinDm() {
    pinnedDmNpubs.update((s) => {
      if (!s.has(npub)) return s;
      const next = new Set(s);
      next.delete(npub);
      return next;
    });
    menuOpen = false;
  }

  function cancelNicknameEdit() {
    showNicknameEdit = false;
    nicknameError = null;
  }

  async function saveNickname() {
    if (nicknameSaving) return;
    nicknameError = null;
    nicknameSaving = true;
    try {
      await onSaveNickname(nicknameEditValue.trim());
      showNicknameEdit = false;
    } catch (e: unknown) {
      nicknameError = e instanceof Error ? e.message : 'Failed to set nickname';
    } finally {
      nicknameSaving = false;
    }
  }
</script>

<svelte:window
  on:click={(e) => {
    const t = e.target as HTMLElement | null;
    if (menuOpen && t && !t.closest('.dm-thread-header-actions')) menuOpen = false;
  }}
/>

<div class="dm-thread">
  <div class="dm-thread-header">
    <div class="dm-thread-header-avatar">
      {#if contactAvatarSrc}
        <img src={contactAvatarSrc} alt="" class="dm-thread-header-avatar-img" />
      {:else}
        <span class="dm-thread-header-avatar-placeholder">{contactDisplayName.charAt(0).toUpperCase()}</span>
      {/if}
    </div>
    <div class="dm-thread-header-info">
      {#if showNicknameEdit}
        <div class="dm-thread-nickname-edit">
          <input
            type="text"
            class="dm-thread-nickname-input"
            placeholder="Nickname"
            bind:value={nicknameEditValue}
            on:keydown={(e) => e.key === 'Escape' && cancelNicknameEdit()}
          />
          <button type="button" class="dm-thread-nickname-btn dm-thread-nickname-save" on:click={saveNickname} disabled={nicknameSaving}>
            {nicknameSaving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" class="dm-thread-nickname-btn dm-thread-nickname-cancel" on:click={cancelNicknameEdit} disabled={nicknameSaving}>
            Cancel
          </button>
        </div>
        {#if nicknameError}
          <p class="dm-thread-nickname-error" role="alert">{nicknameError}</p>
        {/if}
      {:else}
        <div class="dm-thread-header-title-row">
          <div class="dm-thread-title-left">
            <h3 class="dm-thread-title">{contactDisplayName}</h3>
            {#if showOptionsMenu}
              <div class="dm-thread-header-actions">
                <button
                  type="button"
                  class="dm-thread-dropdown-trigger"
                  title="Options"
                  on:click={() => (menuOpen = !menuOpen)}
                  aria-haspopup="true"
                  aria-expanded={menuOpen}
                >
                  <span class="dm-thread-chevron" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" focusable="false">
                      <path d="M6 9L12 15L18 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </span>
                </button>
                {#if menuOpen}
                  <div class="dm-thread-dropdown" role="menu">
                    <button type="button" class="dm-thread-dropdown-item" role="menuitem" on:click={openNicknameEdit}>
                      Set Nickname
                    </button>
                    {#if showPinOption}
                      {#if $pinnedDmNpubs.has(npub)}
                        <button type="button" class="dm-thread-dropdown-item" role="menuitem" on:click={unpinDm}>
                          Unpin DM
                        </button>
                      {:else}
                        <button type="button" class="dm-thread-dropdown-item" role="menuitem" on:click={pinDm}>
                          Pin DM
                        </button>
                      {/if}
                    {/if}
                    {#if onDeleteChat}
                      <button
                        type="button"
                        class="dm-thread-dropdown-item dm-thread-dropdown-item-danger"
                        role="menuitem"
                        on:click={() => {
                          menuOpen = false;
                          onDeleteChat();
                        }}
                      >
                        Delete chat
                      </button>
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
          {#if showWalletButton}
            <button
              type="button"
              class="dm-thread-wallet-btn"
              title={$walletSidebarOpen ? 'Close wallet' : 'Open wallet'}
              aria-label={$walletSidebarOpen ? 'Close wallet sidebar' : 'Open wallet sidebar'}
              aria-expanded={$walletSidebarOpen}
              aria-controls="wallet-bar"
              on:click={() => toggleWalletSidebar()}
            >
              <span class="dm-thread-wallet-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  xmlns="http://www.w3.org/2000/svg" focusable="false">
                  <!-- Wallet base -->
                  <rect x="3" y="7" width="18" height="10" rx="3"
                    stroke="currentColor" stroke-width="2" />
                  <!-- Slot -->
                  <path d="M6 10H14" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" />
                  <!-- Coin on top -->
                  <circle cx="10" cy="5" r="2.5"
                    stroke="currentColor" stroke-width="2"
                    fill="currentColor" opacity="0.15" />
                </svg>
              </span>
            </button>
          {/if}
        </div>
        <div class="dm-thread-npub-row">
          <span class="dm-thread-npub">{truncateNpub(npub)}</span>
          <button
            type="button"
            class="dm-thread-copy-btn"
            title="Copy full npub"
            on:click={() => navigator.clipboard?.writeText(npub)}
          >
            <span class="dm-thread-copy-icon" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" focusable="false">
                <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="2"/>
                <rect x="4" y="4" width="11" height="11" rx="2" stroke="currentColor" stroke-width="2" opacity="0.6"/>
              </svg>
            </span>
          </button>
        </div>
      {/if}
    </div>
  </div>
  <div class="dm-thread-messages" bind:this={dmMessagesContainer}>
    {#if canLoadOlder}
      <div class="dm-thread-load-older">
        <button type="button" class="load-older-btn" on:click={onLoadOlder} disabled={loadingOlder}>
          {loadingOlder ? 'Loading…' : 'Load older messages'}
        </button>
      </div>
    {/if}
    {#if messages.length > 0}
      {#each messages as msg (msg.id)}
        {@const channelInSquadPayload = parseChannelInSquadMessage(msg.content ?? '')}
        {@const channelInNetworkPayload = parseChannelInNetworkMessage(msg.content ?? '')}
        {@const networkInvitePayload = parseNetworkInviteMessage(msg.content ?? '')}
        {@const invitePayload = parseSquadInviteMessage(msg.content ?? '')}
        {@const walletPeerInfoRequestPayload = parseWalletPeerInfoRequest(msg.content ?? '')}
        {@const walletPeerInfoGrantPayload = parseWalletPeerInfoGrant(msg.content ?? '')}
        {@const walletPeerInfoDeclinePayload = parseWalletPeerInfoDecline(msg.content ?? '')}
        {@const walletTxRequestPayload = parseWalletTxRequest(msg.content ?? '')}
        {@const walletTxAnnouncementPayload = parseWalletTxAnnouncement(msg.content ?? '')}
        {@const isInvite = !!(channelInSquadPayload || channelInNetworkPayload || networkInvitePayload || invitePayload)}
        {@const inviterDisplay = isInvite ? getInviterDisplay(msg, npub, $profiles) : { inviterName: '', inviterAvatarSrc: null }}
        {#if channelInSquadPayload}
          {@const channelInviteStatus = $acceptedChannelInviteMessageIds.includes(msg.id) ? 'accepted' : $declinedChannelInviteMessageIds.includes(msg.id) ? 'declined' : 'pending'}
          <InviteCard
            variant="channel-in-squad"
            squadName={channelInSquadPayload.squadName}
            channelName={channelInSquadPayload.channelName}
            isMine={msg.mine}
            inviterName={inviterDisplay.inviterName}
            inviterAvatarSrc={inviterDisplay.inviterAvatarSrc}
            status={channelInviteStatus}
            accepting={acceptingChannelInSquadId === msg.id}
            onAccept={() => onAcceptChannelInSquad(msg, { channelGroupId: channelInSquadPayload.channelGroupId, announcementsGroupId: channelInSquadPayload.announcementsGroupId, channelName: channelInSquadPayload.channelName })}
            onDecline={() => onDeclineChannelInSquad(msg)}
          />
        {:else if channelInNetworkPayload}
          {@const channelInviteStatus = $acceptedChannelInviteMessageIds.includes(msg.id) ? 'accepted' : $declinedChannelInviteMessageIds.includes(msg.id) ? 'declined' : 'pending'}
          <InviteCard
            variant="channel-in-network"
            networkName={channelInNetworkPayload.networkName}
            channelName={channelInNetworkPayload.channelName}
            memberSquads={channelInNetworkPayload.memberSquads ?? []}
            isMine={msg.mine}
            inviterName={inviterDisplay.inviterName}
            inviterAvatarSrc={inviterDisplay.inviterAvatarSrc}
            status={channelInviteStatus}
            accepting={acceptingChannelInNetworkId === msg.id}
            onAccept={() => onAcceptChannelInNetwork(msg, { networkId: channelInNetworkPayload.networkId, channelGroupId: channelInNetworkPayload.channelGroupId, channelName: channelInNetworkPayload.channelName })}
            onDecline={() => onDeclineChannelInNetwork(msg)}
          />
        {:else if networkInvitePayload}
          {@const networkInviteStatus = $acceptedNetworkInviteIds.includes(msg.id) ? 'accepted' : $declinedNetworkInviteIds.includes(msg.id) ? 'declined' : 'pending'}
          <InviteCard
            variant="network"
            networkName={networkInvitePayload.networkName}
            memberSquads={networkInvitePayload.memberSquads}
            isMine={msg.mine}
            inviterName={inviterDisplay.inviterName}
            inviterAvatarSrc={inviterDisplay.inviterAvatarSrc}
            status={networkInviteStatus}
            accepting={acceptingNetworkInviteId === msg.id}
            onAccept={() => onAcceptNetworkInvite(msg, networkInvitePayload)}
            onDecline={() => onDeclineNetwork(msg)}
          />
        {:else if invitePayload}
          {@const inviteStatus = $acceptedSquadInviteIds.includes(msg.id) ? 'accepted' : $declinedSquadInviteIds.includes(msg.id) ? 'declined' : 'pending'}
          <InviteCard
            variant="squad"
            squadName={invitePayload.squadName}
            isMine={msg.mine}
            inviterName={inviterDisplay.inviterName}
            inviterAvatarSrc={inviterDisplay.inviterAvatarSrc}
            status={inviteStatus}
            accepting={acceptingSquadInviteId === msg.id}
            onAccept={() => onAcceptSquadInvite(msg, invitePayload.groupId)}
            onDecline={() => onDeclineSquad(msg)}
          />
        {:else if walletPeerInfoRequestPayload}
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
            onAccept={msg.mine
              ? undefined
              : () => onAcceptWalletPeerInfoRequest(msg, walletPeerInfoRequestPayload)}
            onDecline={msg.mine
              ? undefined
              : () => onDeclineWalletPeerInfoRequest(msg, walletPeerInfoRequestPayload)}
          />
        {:else if walletPeerInfoGrantPayload}
          {@const wpeerGrantName = getInviterDisplay(msg, npub, $profiles).inviterName}
          <WalletPeerExchangeCard
            variant={msg.mine ? 'grant-out' : 'grant-in'}
            peerName={wpeerGrantName}
          />
        {:else if walletPeerInfoDeclinePayload}
          {@const wpeerDeclName = getInviterDisplay(msg, npub, $profiles).inviterName}
          <WalletPeerExchangeCard
            variant={msg.mine ? 'decline-out' : 'decline-in'}
            peerName={wpeerDeclName}
          />
        {:else if walletTxRequestPayload}
          {@const walletFulfilled = fulfilledWalletRequestIds.has(walletTxRequestPayload.request_id)}
          {@const walletReqStatus = walletFulfilled
            ? 'fulfilled'
            : $acceptedWalletTxRequestMessageIds.includes(msg.id)
              ? 'accepted'
              : $declinedWalletTxRequestMessageIds.includes(msg.id)
                ? 'declined'
                : 'pending'}
          <WalletTxRequestCard
            payload={walletTxRequestPayload}
            isMine={msg.mine}
            peerDisplayName={getInviterDisplay(msg, npub, $profiles).inviterName}
            status={walletReqStatus}
            accepting={false}
            onAccept={() => {
              acceptedWalletTxRequestMessageIds.update((ids) =>
                ids.includes(msg.id) ? ids : [...ids, msg.id]
              );
              declinedWalletTxRequestMessageIds.update((ids) => ids.filter((id) => id !== msg.id));
              walletSendPrefillFromRequest.set({
                targetNpub: npub,
                network: walletTxRequestPayload.network,
                asset: walletTxRequestPayload.asset,
                amount: walletTxRequestPayload.amount,
                requestId: walletTxRequestPayload.request_id,
                requestMessageId: msg.id,
              });
              walletSidebarOpen.set(true);
            }}
            onDecline={() => {
              declinedWalletTxRequestMessageIds.update((ids) =>
                ids.includes(msg.id) ? ids : [...ids, msg.id]
              );
              acceptedWalletTxRequestMessageIds.update((ids) => ids.filter((id) => id !== msg.id));
              if (!msg.mine) {
                showToast('Payment request declined. The requester was not notified.');
              }
            }}
          />
        {:else if walletTxAnnouncementPayload}
          <WalletTxAnnouncementCard payload={walletTxAnnouncementPayload} />
        {:else}
          <Message {...toMessageProps(msg)} />
        {/if}
      {/each}
    {:else}
      <p class="dm-thread-placeholder">No messages yet</p>
    {/if}
  </div>
  {#if ($typingByChat[npub]?.length ?? 0) > 0}
    <p class="dm-thread-typing" role="status">Typing…</p>
  {/if}
  {#if $dmSendError}
    <p class="dm-thread-error" role="alert">{$dmSendError}</p>
  {/if}
  <MessageInput channelName={truncateNpub(npub)} onSend={onSend} onTyping={onTyping} />
</div>

<style>
  .dm-thread {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background-color: var(--border-subtle);
  }

  .dm-thread-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 24px;
    border-bottom: 1px solid var(--bg-elevated);
  }

  .dm-thread-header-avatar {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    overflow: hidden;
    background-color: var(--bg-hover);
  }

  .dm-thread-header-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .dm-thread-header-avatar-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-weight: 600;
    font-size: 1.125rem;
    background-color: var(--accent);
  }

  .dm-thread-header-info {
    min-width: 0;
    flex: 1;
  }

  .dm-thread-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dm-thread-header-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  .dm-thread-title-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .dm-thread-header-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .dm-thread-header-actions {
    position: relative;
    flex-shrink: 0;
  }

  .dm-thread-wallet-btn {
    padding: 4px 6px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    outline: none;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dm-thread-wallet-btn:hover {
    color: var(--text-primary);
    border-color: var(--accent);
  }

  .dm-thread-wallet-icon {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dm-thread-npub-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .dm-thread-npub {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .dm-thread-copy-btn {
    padding: 2px;
    border: none;
    background: transparent;
    border-radius: 4px;
    color: var(--text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dm-thread-copy-btn:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  .dm-thread-copy-icon {
    display: block;
  }

  .dm-thread-dropdown-trigger {
    padding: 4px 6px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    outline: none;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dm-thread-dropdown-trigger:hover {
    color: var(--text-primary);
    border-color: var(--accent);
  }

  .dm-thread-chevron {
    display: flex;
    align-items: center;
    justify-content: center;
    color: inherit;
  }

  .dm-thread-chevron svg {
    width: 16px;
    height: 16px;
    display: block;
  }

  .dm-thread-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    min-width: 140px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 50;
    padding: 4px 0;
  }

  .dm-thread-dropdown-item {
    display: block;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: none;
    color: var(--text-secondary);
    font-size: 0.875rem;
    text-align: left;
    cursor: pointer;
  }

  .dm-thread-dropdown-item:hover {
    background: var(--bg-hover);
  }

  .dm-thread-dropdown-item-danger {
    color: var(--danger);
  }

  .dm-thread-dropdown-item-danger:hover {
    background: rgba(237, 66, 69, 0.15);
    color: var(--danger);
  }

  .dm-thread-nickname-edit {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .dm-thread-nickname-input {
    flex: 1;
    min-width: 120px;
    padding: 6px 10px;
    font-size: 0.9375rem;
    color: var(--text-primary);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 4px;
    outline: none;
  }

  .dm-thread-nickname-input:focus {
    border-color: var(--accent);
  }

  .dm-thread-nickname-btn {
    padding: 6px 12px;
    font-size: 0.8125rem;
    border-radius: 4px;
    cursor: pointer;
    outline: none;
    border: none;
  }

  .dm-thread-nickname-save {
    background: var(--accent);
    color: #fff;
  }

  .dm-thread-nickname-save:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .dm-thread-nickname-cancel {
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--border);
  }

  .dm-thread-nickname-cancel:hover:not(:disabled) {
    color: var(--text-primary);
  }

  .dm-thread-nickname-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .dm-thread-nickname-error {
    margin: 4px 0 0 0;
    font-size: 0.75rem;
    color: var(--danger);
  }

  .dm-thread-messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 24px;
  }

  .dm-thread-load-older {
    margin-bottom: 16px;
  }

  .load-older-btn {
    padding: 8px 16px;
    font-size: 0.875rem;
    color: var(--text-secondary);
    background: var(--bg-hover);
    border: 1px solid var(--bg-elevated);
    border-radius: 4px;
    cursor: pointer;
    outline: none;
  }

  .load-older-btn:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--border);
  }

  .load-older-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .dm-thread-placeholder {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 0;
  }

  .dm-thread-typing {
    font-size: 0.8125rem;
    color: var(--text-muted);
    margin: 0;
    padding: 4px 24px 8px;
    font-style: italic;
  }

  .dm-thread-error {
    font-size: 0.875rem;
    color: var(--danger);
    margin: 0;
    padding: 8px 24px;
    background-color: rgba(237, 66, 69, 0.1);
    border-top: 1px solid var(--bg-elevated);
  }
</style>
