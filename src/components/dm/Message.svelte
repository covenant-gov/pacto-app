<script lang="ts">
  import FormattedMessageBody from './FormattedMessageBody.svelte';

  export let id: string = '';
  export let authorName: string = '';
  export let content: string = '';
  export let timestamp: string = '';
  export let avatar: string = '';
  /** When set, show a reply bar above the body (author + truncated content or "Attachment"). */
  export let replyToId: string | undefined = undefined;
  export let replyAuthorName: string | undefined = undefined;
  export let replyPreview: string | undefined = undefined;

  function formatTime(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  function jumpToReply() {
    if (!replyToId) return;
    const el = document.getElementById(`msg-${replyToId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
</script>

<div class="message" id={id ? `msg-${id}` : undefined}>
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
    {#if replyToId && (replyAuthorName != null || replyPreview != null)}
      <div class="msg-reply" role="region" aria-label="Reply to {replyAuthorName ?? 'message'}">
        <button
          type="button"
          class="msg-reply-inner"
          on:click={jumpToReply}
          aria-label="Jump to replied message"
        >
          <span class="msg-reply-author">{replyAuthorName ?? 'Unknown'}</span>
          <span class="msg-reply-preview">{#if replyPreview}{replyPreview}{/if}</span>
        </button>
      </div>
    {/if}
    <div class="message-text">
      <FormattedMessageBody content={content} />
    </div>
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

  .msg-reply {
    margin-bottom: 6px;
    padding-left: 10px;
    border-left: 3px solid var(--reply-border, var(--accent));
    color: var(--text-muted);
    font-size: 0.8125rem;
    line-height: 1.3;
  }

  .msg-reply-inner {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }

  .msg-reply-inner:hover {
    color: var(--text-secondary);
  }

  .msg-reply-author {
    font-weight: 500;
    color: var(--text-secondary);
  }

  .msg-reply-preview {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 2px;
  }

  .message-text {
    color: var(--text-secondary);
    font-size: 0.9375rem;
    line-height: 1.375rem;
    word-wrap: break-word;
  }
</style>

