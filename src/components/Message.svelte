<script lang="ts">
  export let authorName: string = "";
  export let content: string = "";
  export let timestamp: string = "";
  export let avatar: string = "";

  // Format timestamp (expects ISO string)
  function formatTime(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  }
</script>

<div class="message">
  <div class="avatar">
    {#if avatar}
      <img src={avatar} alt={authorName} />
    {:else}
      <div class="avatar-placeholder">{authorName.charAt(0).toUpperCase()}</div>
    {/if}
  </div>
  <div class="message-content">
    <div class="message-header">
      <span class="author-name">{authorName}</span>
      <span class="timestamp">{formatTime(timestamp)}</span>
    </div>
    <div class="message-text">{content}</div>
  </div>
</div>

<style>
  .message {
    display: flex;
    gap: 16px;
    padding: 8px 16px;
    transition: background 0.1s;
  }

  .message:hover {
    background: var(--bg-hover);
  }

  .avatar {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .avatar img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }

  .avatar-placeholder {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    font-weight: 600;
    font-size: 1rem;
  }

  .message-content {
    flex: 1;
    min-width: 0;
  }

  .message-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 2px;
  }

  .author-name {
    color: var(--text-primary);
    font-weight: 500;
    font-size: 0.9375rem;
  }

  .timestamp {
    color: var(--text-muted);
    font-size: 0.75rem;
    font-weight: 400;
  }

  .message-text {
    color: var(--text-secondary);
    font-size: 0.9375rem;
    line-height: 1.375rem;
    word-wrap: break-word;
  }
</style>

