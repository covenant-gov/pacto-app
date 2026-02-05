<script lang="ts">
  import { onMount } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import Navbar from '../components/Navbar.svelte';
  import TopNavbar from '../components/TopNavbar.svelte';
  import CommunityNavbar from '../components/CommunityNavbar.svelte';
  import ChatView from '../components/ChatView.svelte';
  import Profile from '../components/Profile.svelte';
  import MessengerNavbar from '../components/MessengerNavbar.svelte';
  import MessengerChatView from '../components/MessengerChatView.svelte';
  import Message from '../components/Message.svelte';
  import MessageInput from '../components/MessageInput.svelte';
  import { getDmMessages, sendDmMessage, queueProfileSync, fetchMessages } from '../lib/api/nostr';
  import { getInvokeErrorMessage, friendlyMessage } from '../lib/utils/tauri-errors';
  import { isAuthenticated } from '../stores/auth';
  import {
    activeCommunityId,
    activeChannelId,
    activeView,
    activeTopNavTab,
    activeDmId,
    composingNewChat,
    backendDmMessages,
    dmList,
    type DmMessage,
  } from '../stores/app';

  let dmMessagesContainer: HTMLDivElement;
  let dmSendError: string | null = null;
  let prevDmId: string | null = null;

  // Clear send error when user switches to a different DM
  $: if (prevDmId !== $activeDmId) {
    prevDmId = $activeDmId;
    if (prevDmId != null) dmSendError = null;
  }

  function truncateNpub(n: string): string {
    if (n.length <= 16) return n;
    return n.slice(0, 8) + '…' + n.slice(-4);
  }

  // Backend messages for active DM, sorted by at (oldest first). Backend emits message_new on send.
  $: mergedDmMessages = (() => {
    const npub = $activeDmId;
    if (!npub) return [];
    const list = [...($backendDmMessages[npub] ?? [])];
    list.sort((a, b) => a.at - b.at);
    return list;
  })();

  // Load backend messages when active DM changes; queue profile sync (per reference flow).
  $: if ($activeDmId && $activeTopNavTab === 'dms') {
    queueProfileSync($activeDmId).catch(() => {});
    getDmMessages($activeDmId, 100, 0)
      .then((msgs) => {
        backendDmMessages.update((byNpub) => ({
          ...byNpub,
          [$activeDmId!]: msgs as DmMessage[],
        }));
      })
      .catch(() => {});
  }

  function toMessageProps(msg: DmMessage) {
    return {
      authorName: msg.mine ? 'You' : (msg.npub ? truncateNpub(msg.npub) : 'Unknown'),
      content: msg.content,
      timestamp: new Date(msg.at).toISOString(),
      avatar: '',
    };
  }

  async function handleDmSend(content: string) {
    const id = $activeDmId;
    if (!id) return;
    dmSendError = null;
    try {
      const ok = await sendDmMessage(id, content);
      if (!ok) {
        dmSendError = friendlyMessage(
          'Could not deliver to relays. Message may appear as pending or failed.',
          'dm_send'
        );
      }
    } catch (e: unknown) {
      const raw = getInvokeErrorMessage(e, 'Failed to send message');
      dmSendError = friendlyMessage(raw, 'dm_send');
      if (import.meta.env.DEV) console.error('[DM send error]', e);
    }
  }

  onMount(() => {
    $activeCommunityId = 'community-1';
    $activeChannelId = 'channel-1';

    // Pull DMs from Nostr relays when app loads (if already authenticated)
    if ($isAuthenticated) {
      fetchMessages(true).catch(() => {});
    }

    const unlistenNew = listen<{ message: DmMessage; chat_id: string }>('message_new', (event) => {
      const { message, chat_id } = event.payload;
      if (!chat_id.startsWith('npub1')) return;
      const m: DmMessage = {
        id: message.id,
        content: message.content,
        at: message.at,
        mine: message.mine,
        npub: message.npub,
      };
      backendDmMessages.update((byNpub) => {
        const list = byNpub[chat_id] ?? [];
        if (list.some((x) => x.id === m.id)) return byNpub;
        return { ...byNpub, [chat_id]: [...list, m] };
      });
      // Add new DM to list if not already present (e.g. first message from a new contact)
      dmList.update((list) => {
        if (list.some((e) => e.npub === chat_id)) return list;
        return [...list, { npub: chat_id }];
      });
    });

    const unlistenUpdate = listen<{ old_id: string; message: DmMessage; chat_id: string }>(
      'message_update',
      (event) => {
        const { old_id, message, chat_id } = event.payload;
        if (!chat_id.startsWith('npub1')) return;
        const m: DmMessage = {
          id: message.id,
          content: message.content,
          at: message.at,
          mine: message.mine,
          npub: message.npub,
        };
        backendDmMessages.update((byNpub) => {
          const list = byNpub[chat_id] ?? [];
          const out = list.filter((x) => x.id !== old_id && x.id !== m.id);
          return { ...byNpub, [chat_id]: [...out, m].sort((a, b) => a.at - b.at) };
        });
      }
    );

    return () => {
      unlistenNew.then((fn) => fn());
      unlistenUpdate.then((fn) => fn());
    };
  });
</script>

<div class="page">
  <header class="top-navbar-slot">
    <TopNavbar />
  </header>
  <main class="container">
    <Navbar />
    {#if $activeView === 'profile'}
      <Profile />
    {:else if $activeTopNavTab === 'dms'}
      <MessengerNavbar />
      {#if $composingNewChat}
        <MessengerChatView />
      {:else if $activeDmId}
        <div class="dm-thread">
          <div class="dm-thread-header">
            <h3 class="dm-thread-title">Conversation</h3>
            <span class="dm-thread-npub">{truncateNpub($activeDmId)}</span>
          </div>
          <div class="dm-thread-messages" bind:this={dmMessagesContainer}>
            {#if mergedDmMessages.length > 0}
              {#each mergedDmMessages as msg (msg.id)}
                <Message {...toMessageProps(msg)} />
              {/each}
            {:else}
              <p class="dm-thread-placeholder">No messages yet</p>
            {/if}
          </div>
          {#if dmSendError}
            <p class="dm-thread-error" role="alert">{dmSendError}</p>
          {/if}
          <MessageInput channelName={truncateNpub($activeDmId)} onSend={handleDmSend} />
        </div>
      {:else}
        <div class="dm-empty">
          <p>Select a conversation or start a new chat</p>
        </div>
      {/if}
    {:else}
      <CommunityNavbar />
      <ChatView />
    {/if}
  </main>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
  }
  .top-navbar-slot {
    flex-shrink: 0;
    z-index: 10;
  }
  .page .container {
    flex: 1;
    min-height: 0;
  }

  .dm-thread {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background-color: #313338;
  }

  .dm-thread-header {
    padding: 16px 24px;
    border-bottom: 1px solid #1e1f22;
  }

  .dm-thread-title {
    font-size: 1rem;
    font-weight: 600;
    color: #f2f3f5;
    margin: 0 0 2px;
  }

  .dm-thread-npub {
    font-size: 0.8125rem;
    color: #b5bac1;
  }

  .dm-thread-messages {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
  }

  .dm-thread-placeholder {
    font-size: 0.875rem;
    color: #6d6f78;
    margin: 0;
  }

  .dm-thread-error {
    font-size: 0.875rem;
    color: #ed4245;
    margin: 0;
    padding: 8px 24px;
    background-color: rgba(237, 66, 69, 0.1);
    border-top: 1px solid #1e1f22;
  }

  .dm-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: #313338;
    color: #6d6f78;
    font-size: 0.9375rem;
  }
</style>
