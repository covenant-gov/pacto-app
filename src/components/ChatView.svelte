<script lang="ts">
  import Message from './Message.svelte';
  import MessageInput from './MessageInput.svelte';
  import { activeChannelId, squads, activeSquadId, channelMessages } from '../stores/app';

  // Get active channel info
  $: activeSquad = $squads.find(c => c.id === $activeSquadId);
  $: activeChannel = activeSquad?.channels.find(ch => ch.id === $activeChannelId);
  $: channelName = activeChannel?.name || 'channel';

  // Get messages for the current channel
  $: currentMessages = $activeChannelId ? ($channelMessages[$activeChannelId] || []) : [];

  function handleSendMessage(content: string) {
    if (!$activeChannelId) return;
    
    const newMessage = {
      id: String(Date.now()),
      authorName: 'You',
      content: content,
      timestamp: new Date().toISOString(),
      avatar: ''
    };
    
    // Update the store for this channel
    channelMessages.update(messages => ({
      ...messages,
      [$activeChannelId]: [...(messages[$activeChannelId] || []), newMessage]
    }));
  }

  // Auto-scroll to bottom when new messages arrive (only if already near bottom)
  let messagesContainer: HTMLDivElement;
  $: if (currentMessages && messagesContainer) {
    setTimeout(() => {
      const isNearBottom = 
        messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 100;
      
      if (isNearBottom) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }, 0);
  }
</script>

<div class="chat-view">
  {#if activeChannel}
    <div class="channel-header">
      <div class="channel-info">
        <span class="channel-icon">#</span>
        <h3 class="channel-name">{channelName}</h3>
      </div>
    </div>

    <div class="messages-container" bind:this={messagesContainer}>
      <div class="messages-list">
        {#each currentMessages as message (message.id)}
          <Message 
            authorName={message.authorName}
            content={message.content}
            timestamp={message.timestamp}
            avatar={message.avatar}
          />
        {/each}
      </div>
    </div>

    <MessageInput channelName={channelName} onSend={handleSendMessage} />
  {:else}
    <div class="empty-state">
      <p>Select a channel to start chatting</p>
    </div>
  {/if}
</div>

<style>
  .chat-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: #242424;
    height: 100%;
    min-width: 0;
    border-left: 1px solid #313338;
  }

  .channel-header {
    height: 48px;
    border-bottom: 1px solid #313338;
    display: flex;
    align-items: center;
    padding: 0 16px;
    flex-shrink: 0;
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
  }

  .channel-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .channel-icon {
    color: #80848e;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .channel-name {
    color: #f2f3f5;
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
  }

  .messages-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
  }

  .messages-list {
    display: flex;
    flex-direction: column;
    padding: 16px 0;
  }

  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #949ba4;
    font-size: 0.875rem;
  }

  /* Scrollbar styling */
  .messages-container::-webkit-scrollbar {
    width: 8px;
  }

  .messages-container::-webkit-scrollbar-track {
    background: transparent;
  }

  .messages-container::-webkit-scrollbar-thumb {
    background: #1a1b1e;
    border-radius: 4px;
  }

  .messages-container::-webkit-scrollbar-thumb:hover {
    background: #1e1f22;
  }
</style>

