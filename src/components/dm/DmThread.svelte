<script lang="ts">
  import MessageInput from './MessageInput.svelte';
  import DmMessageRouter from './DmMessageRouter.svelte';
  import { getProfileAvatarSrc, getProfileDisplayName } from '../../lib/utils/profile';
  import {
    parseWalletPeerInfoGrant,
    getFulfilledWalletRequestIdsFromMessages,
    type WalletPeerInfoRequestPayload,
  } from '../../lib/wallet/dm-messages';
  import {
    formatReciprocalWalletPeerGrant,
    shouldPersistInboundWalletPeerGrant,
    shouldSendReciprocalWalletPeerGrant,
  } from '../../lib/wallet/wallet-peer-exchange';
  import { setDmPeerEvmAddress } from '../../lib/api/wallet-peers';
  import { getEvmAddress } from '../../lib/api/auth';
  import { getActiveEvmSignerAddress } from '../../lib/wallet/evm-accounts';
  import { notifyUserAction } from '../../lib/utils/desktop-notify';
  import { isPactoAppThreadId, PACTO_APP_DISPLAY_NAME } from '../../lib/pacto-app-inbox';
  import { isScrollAtBottom } from '../../lib/dm/dm-unread';
  import { shouldStackWithPrevious } from '../../lib/dm/message-stack';
  import { dmThreadScrolledToBottom } from '../../stores/app';
  import { toggleDmBlock } from '../../lib/api/nostr';
  import { profiles } from '../../stores/profiles';
  import {
    activeDmTab,
    lastOpenedDmByTab,
    pinnedDmNpubs,
    dmSendError,
    typingByChat,
    dmWalletPeerExchangeTick,
    type DmMessage,
    dmWalletSidebarVisible,
    toggleWalletSidebar,
    type DmTab,
    appendDmThreadAnnouncement,
    reciprocatedWalletPeerInfoRequestIds,
  } from '../../stores/app';
  import { currentUser } from '../../stores/auth';
  import { showToast } from '../../stores/toast';
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';

  const tFn = get(t);

  export let npub: string;
  export let messages: DmMessage[] = [];
  export let canLoadOlder = false;
  export let loadingOlder = false;
  export let onLoadOlder: () => void = () => {};
  export let onSend: (content: string) => void | boolean | Promise<boolean> = () => {};
  export let onTyping: () => void = () => {};
  export let onAcceptSquadInvite: (msg: DmMessage, groupId: string) => void = () => {};
  export let onAcceptChannelInSquad: (
    msg: DmMessage,
    payload: { channelGroupId: string; announcementsGroupId: string; channelName: string }
  ) => void = () => {};
  export let onDeclineSquad: (msg: DmMessage) => void = () => {};
  export let onDeclineChannelInSquad: (msg: DmMessage) => void = () => {};
  export let acceptingSquadInviteId: string | null = null;
  export let acceptingChannelInSquadId: string | null = null;
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
  export let onOpenInviterChat: ((inviterNpub: string) => void) | undefined = undefined;
  /** Called when the user scrolls to the bottom — marks messages read up to `messageId`. */
  export let onMarkReadUpTo: (messageId: string) => void = () => {};

  function lastReadableMessageId(): string | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.is_local_announcement) continue;
      return m.id;
    }
    return null;
  }

  let dmMessagesContainer: HTMLDivElement | null = null;
  let scrollPrevNpub: string | null = null;
  let lastScrolledToBottomNpub: string | null = null;
  let lastReportedReadId = '';

  $: if (npub !== scrollPrevNpub) {
    lastReportedReadId = '';
  }

  function notifyIfAtBottom() {
    if (!dmMessagesContainer) {
      dmThreadScrolledToBottom.set(false);
      return;
    }
    const atBottom = isScrollAtBottom(dmMessagesContainer);
    dmThreadScrolledToBottom.set(atBottom);
    if (!atBottom) return;
    const lastId = lastReadableMessageId();
    if (lastId && lastId !== lastReportedReadId) {
      lastReportedReadId = lastId;
      onMarkReadUpTo(lastId);
    }
  }
  function handleMessagesScroll() {
    notifyIfAtBottom();
  }

  $: isPactoAppThread = isPactoAppThreadId(npub);
  let appliedWalletGrantIds = new Set<string>();
  let appliedWalletGrantsForNpub: string | null = null;
  let reciprocalGrantInFlight = new Set<string>();

  $: if (npub !== appliedWalletGrantsForNpub) {
    appliedWalletGrantsForNpub = npub;
    appliedWalletGrantIds = new Set();
    reciprocalGrantInFlight = new Set();
  }

  $: (() => {
    const uid = $currentUser?.npub;
    const peerNpub = npub;
    if (!uid || !peerNpub) return;
    for (const msg of messages) {
      if (msg.mine) continue;
      const g = parseWalletPeerInfoGrant(msg.content ?? '');
      if (!g || g.grantor_npub !== peerNpub) continue;

      if (
        !appliedWalletGrantIds.has(msg.id) &&
        shouldPersistInboundWalletPeerGrant({
          grant: g,
          peerNpub,
          myNpub: uid,
          messages,
        })
      ) {
        appliedWalletGrantIds.add(msg.id);
        const forPeer = peerNpub;
        void setDmPeerEvmAddress(forPeer, g.evm_address).then(
          () => {
            if (npub !== forPeer) return;
            dmWalletPeerExchangeTick.update((t: number) => t + 1);
          },
          () => {
            appliedWalletGrantIds.delete(msg.id);
          }
        );
      }

      if (reciprocalGrantInFlight.has(g.request_id)) continue;
      if (
        !shouldSendReciprocalWalletPeerGrant({
          grant: g,
          peerNpub,
          myNpub: uid,
          messages,
          alreadyReciprocatedRequestIds: get(reciprocatedWalletPeerInfoRequestIds),
        })
      ) {
        continue;
      }
      reciprocalGrantInFlight.add(g.request_id);
      void (async () => {
        try {
          const myAddr =
            (await getActiveEvmSignerAddress())?.trim() || (await getEvmAddress())?.trim() || '';
          if (npub !== peerNpub || get(currentUser)?.npub !== uid) {
            reciprocalGrantInFlight.delete(g.request_id);
            return;
          }
          if (!myAddr) {
            reciprocalGrantInFlight.delete(g.request_id);
            showToast(tFn('messaging.dm.wallet.addWalletForPayout'));
            return;
          }
          if (
            !shouldSendReciprocalWalletPeerGrant({
              grant: g,
              peerNpub,
              myNpub: uid,
              messages,
              alreadyReciprocatedRequestIds: get(reciprocatedWalletPeerInfoRequestIds),
            })
          ) {
            reciprocalGrantInFlight.delete(g.request_id);
            return;
          }
          const grantJson = formatReciprocalWalletPeerGrant({
            requestId: g.request_id,
            myNpub: uid,
            myEvmAddress: myAddr,
          });
          const sendResult = await Promise.resolve(onSend(grantJson));
          if (npub !== peerNpub || get(currentUser)?.npub !== uid) {
            reciprocalGrantInFlight.delete(g.request_id);
            return;
          }
          if (sendResult === false) {
            reciprocalGrantInFlight.delete(g.request_id);
            showToast(tFn('messaging.dm.wallet.shareAddressError'));
            return;
          }
          reciprocatedWalletPeerInfoRequestIds.update((ids) =>
            ids.includes(g.request_id) ? ids : [...ids, g.request_id]
          );
          dmWalletPeerExchangeTick.update((t: number) => t + 1);
          showToast(tFn('messaging.dm.wallet.addressExchanged'));
        } catch {
          reciprocalGrantInFlight.delete(g.request_id);
        }
      })();
    }
  })();

  function truncateNpub(n: string): string {
    if (n.length <= 16) return n;
    return n.slice(0, 8) + '…' + n.slice(-4);
  }

  $: if (dmMessagesContainer && messages.length) {
    const container = dmMessagesContainer;
    const conversationJustChanged = npub !== scrollPrevNpub;
    const firstTimeWithMessages = npub !== lastScrolledToBottomNpub;
    if (conversationJustChanged) {
      scrollPrevNpub = npub;
      dmThreadScrolledToBottom.set(false);
    }
    setTimeout(() => {
      if (!container || !document.contains(container)) return;
      const isNearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      if (conversationJustChanged || firstTimeWithMessages || isNearBottom) {
        container.scrollTop = container.scrollHeight;
        lastScrolledToBottomNpub = npub;
        notifyIfAtBottom();
      }
    }, 0);
  }
  $: if (npub !== scrollPrevNpub && messages.length === 0) {
    scrollPrevNpub = npub;
    dmThreadScrolledToBottom.set(false);
  }

  $: contactProfile = isPactoAppThread ? null : npub ? $profiles[npub] : null;
  $: peerBlockedByMe = contactProfile?.blocked === true;
  $: contactAvatarSrc = isPactoAppThread ? null : getProfileAvatarSrc(contactProfile);
  $: contactDisplayName = isPactoAppThread
    ? PACTO_APP_DISPLAY_NAME
    : contactProfile
      ? getProfileDisplayName(contactProfile)
      : npub
        ? truncateNpub(npub)
        : $t('messaging.message.replyUnknown');

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
    lastOpenedDmByTab.update((byTab: Record<DmTab, string | null>) => ({ ...byTab, pinned: npub }));
    activeDmTab.set('pinned');
    menuOpen = false;
  }

  async function toggleBlockUser() {
    menuOpen = false;
    const peerLabel = contactDisplayName;
    try {
      const nowBlocked = await toggleDmBlock(npub);
      if (nowBlocked) {
        appendDmThreadAnnouncement(
          npub,
          tFn('messaging.dm.thread.blockedAnnouncement', { values: { peerLabel } })
        );
        showToast(tFn('messaging.dm.thread.blockToast'));
        notifyUserAction(tFn('messaging.dm.thread.blockedNotifyTitle'), tFn('messaging.dm.thread.blockedNotifyBody', { values: { peerLabel } }));
      } else {
        appendDmThreadAnnouncement(npub, tFn('messaging.dm.thread.unblockedAnnouncement', { values: { peerLabel } }));
        showToast(tFn('messaging.dm.thread.unblockToast'));
        notifyUserAction(tFn('messaging.dm.thread.unblockedNotifyTitle'), tFn('messaging.dm.thread.unblockedNotifyBody', { values: { peerLabel } }));
      }
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : tFn('messaging.dm.thread.blockError'));
    }
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
      nicknameError = e instanceof Error ? e.message : tFn('messaging.dm.thread.nicknameError');
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
    <div class="dm-thread-header-avatar" class:pacto-app-avatar={isPactoAppThread}>
      {#if contactAvatarSrc}
        <img src={contactAvatarSrc} alt="" class="dm-thread-header-avatar-img" />
      {:else}
        <span class="dm-thread-header-avatar-placeholder">{isPactoAppThread ? 'I' : contactDisplayName.charAt(0).toUpperCase()}</span>
      {/if}
    </div>
    <div class="dm-thread-header-info">
      {#if showNicknameEdit}
        <div class="dm-thread-nickname-edit">
          <input
            type="text"
            class="dm-thread-nickname-input"
            placeholder={$t('messaging.dm.thread.nicknamePlaceholder')}
            bind:value={nicknameEditValue}
            on:keydown={(e) => e.key === 'Escape' && cancelNicknameEdit()}
          />
          <button type="button" class="dm-thread-nickname-btn dm-thread-nickname-save" on:click={saveNickname} disabled={nicknameSaving}>
            {nicknameSaving ? $t('messaging.dm.thread.savingNickname') : $t('messaging.dm.thread.saveNickname')}
          </button>
          <button type="button" class="dm-thread-nickname-btn dm-thread-nickname-cancel" on:click={cancelNicknameEdit} disabled={nicknameSaving}>
            {$t('messaging.dm.thread.cancel')}
          </button>
        </div>
        {#if nicknameError}
          <p class="dm-thread-nickname-error" role="alert">{nicknameError}</p>
        {/if}
      {:else}
        <div class="dm-thread-header-title-row">
          <div class="dm-thread-title-left">
            <h3 class="dm-thread-title">{contactDisplayName}</h3>
            {#if showOptionsMenu && !isPactoAppThread}
              <div class="dm-thread-header-actions">
                <button
                  type="button"
                  class="dm-thread-dropdown-trigger"
                  title={$t('messaging.dm.thread.optionsTitle')}
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
                      {$t('messaging.dm.thread.setNickname')}
                    </button>
                    <button type="button" class="dm-thread-dropdown-item" role="menuitem" on:click={toggleBlockUser}>
                      {$profiles[npub]?.blocked ? $t('messaging.dm.thread.unblockUser') : $t('messaging.dm.thread.blockUser')}
                    </button>
                    {#if showPinOption}
                      {#if $pinnedDmNpubs.has(npub)}
                        <button type="button" class="dm-thread-dropdown-item" role="menuitem" on:click={unpinDm}>
                          {$t('messaging.dm.thread.unpinDm')}
                        </button>
                      {:else}
                        <button type="button" class="dm-thread-dropdown-item" role="menuitem" on:click={pinDm}>
                          {$t('messaging.dm.thread.pinDm')}
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
                        {$t('messaging.dm.thread.deleteChat')}
                      </button>
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
          {#if showWalletButton && !isPactoAppThread}
            <button
              type="button"
              class="dm-thread-wallet-btn"
              title={$dmWalletSidebarVisible ? $t('messaging.dm.thread.closeWallet') : $t('messaging.dm.thread.openWallet')}
              aria-label={$dmWalletSidebarVisible ? $t('messaging.dm.thread.closeWalletSidebar') : $t('messaging.dm.thread.openWalletSidebar')}
              aria-expanded={$dmWalletSidebarVisible}
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
        {#if !isPactoAppThread}
        <div class="dm-thread-npub-row">
          <span class="dm-thread-npub">{truncateNpub(npub)}</span>
          <button
            type="button"
            class="dm-thread-copy-btn"
            title={$t('messaging.dm.thread.copyNpub')}
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
      {/if}
    </div>
  </div>
  <div class="dm-thread-messages" bind:this={dmMessagesContainer} on:scroll={handleMessagesScroll}>
    {#if canLoadOlder}
      <div class="dm-thread-load-older">
        <button type="button" class="load-older-btn" on:click={onLoadOlder} disabled={loadingOlder}>
          {loadingOlder ? $t('messaging.dm.thread.loading') : $t('messaging.dm.thread.loadOlder')}
        </button>
      </div>
    {/if}
    {#if messages.length > 0}
      {#each messages as msg, i (msg.id)}
        <DmMessageRouter
          {msg}
          {npub}
          {isPactoAppThread}
          {contactDisplayName}
          {fulfilledWalletRequestIds}
          {acceptingSquadInviteId}
          {acceptingChannelInSquadId}
          {acceptingWalletPeerInfoRequestId}
          {onAcceptSquadInvite}
          {onAcceptChannelInSquad}
          {onDeclineSquad}
          {onDeclineChannelInSquad}
          {onAcceptWalletPeerInfoRequest}
          {onDeclineWalletPeerInfoRequest}
          {onOpenInviterChat}
          compact={shouldStackWithPrevious(messages[i - 1], msg)}
        />
      {/each}
    {:else}
      <p class="dm-thread-placeholder">{$t('messaging.dm.thread.noMessages')}</p>
    {/if}
  </div>
  {#if ($typingByChat[npub]?.length ?? 0) > 0}
    <p class="dm-thread-typing" role="status">{$t('messaging.dm.thread.typing')}</p>
  {/if}
  {#if $dmSendError}
    <p class="dm-thread-error" role="alert">{$dmSendError}</p>
  {/if}
  {#if !isPactoAppThread}
  <MessageInput
    channelName={truncateNpub(npub)}
    placeholderOverride={peerBlockedByMe ? $t('messaging.dm.thread.blockedPlaceholder', { values: { npub: truncateNpub(npub) } }) : undefined}
    disabled={peerBlockedByMe}
    onSend={onSend}
    onTyping={onTyping}
  />
  {/if}
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
