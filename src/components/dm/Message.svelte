<script lang="ts">
  import FormattedMessageBody from './FormattedMessageBody.svelte';
  import { formatMessageTimestamp } from '../../lib/utils/message-formatting';
  import { summarizeStructuredMessageContent } from '../../lib/messaging/structured-content-notice';
  import type { Mention } from '../../lib/messaging/mentions';
  import type { NostrProfile } from '../../lib/api/nostr';
  import { t } from 'svelte-i18n';

  export let id: string = '';
  export let authorName: string = '';
  export let content: string = '';
  export let body: string = '';
  export let mentions: Mention[] | undefined = undefined;
  export let rosterNpubs: string[] | Set<string> | undefined = undefined;
  export let profiles: Record<string, NostrProfile | undefined> | undefined = undefined;
  export let currentUserNpub: string | undefined = undefined;
  export let isMentioned: boolean = false;
  export let timestamp: string = '';
  export let avatar: string = '';
  /** Hide avatar + name/timestamp; nest under the previous message from the same author. */
  export let compact: boolean = false;
  /** When set, show a reply bar above the body (author + truncated content or "Attachment"). */
  export let replyToId: string | undefined = undefined;
  export let replyAuthorName: string | undefined = undefined;
  export let replyPreview: string | undefined = undefined;

  $: displayContent = body || content;
  $: structuredNotice = summarizeStructuredMessageContent(displayContent, $t);

  function jumpToReply() {
    if (!replyToId) return;
    const el = document.getElementById(`msg-${replyToId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
</script>

<div class="message" class:compact class:mentioned={isMentioned} id={id ? `msg-${id}` : undefined}>
  <div class="avatar" aria-hidden={compact ? 'true' : undefined}>
    {#if !compact}
      {#if avatar}
        <img src={avatar} alt={authorName} />
      {:else}
        <div class="avatar-placeholder">{authorName.charAt(0).toUpperCase()}</div>
      {/if}
    {/if}
  </div>
  <div class="message-content">
    {#if !compact}
      <div class="message-header">
        <span class="author-name">{authorName}</span>
        <span class="timestamp"><time datetime={timestamp}>{formatMessageTimestamp(timestamp)}</time></span>
      </div>
    {/if}
    {#if replyToId && (replyAuthorName != null || replyPreview != null)}
      <div class="msg-reply" role="region" aria-label={$t('messaging.message.replyTo', { values: { name: replyAuthorName ?? $t('messaging.message.replyToDefault') } })}>
        <button
          type="button"
          class="msg-reply-inner"
          on:click={jumpToReply}
          aria-label={$t('messaging.message.jumpToReply')}
        >
          <span class="msg-reply-author">{replyAuthorName ?? $t('messaging.message.replyUnknown')}</span>
          <span class="msg-reply-preview">{#if replyPreview}{replyPreview}{/if}</span>
        </button>
      </div>
    {/if}
    <div class="message-text">
      {#if structuredNotice}
        <span class="structured-notice">{structuredNotice}</span>
      {:else}
        <FormattedMessageBody content={displayContent} {mentions} {profiles} {rosterNpubs} />
      {/if}
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

  .message.mentioned {
    background: rgba(88, 101, 242, 0.12);
  }

  .message.compact {
    padding-top: 2px;
    padding-bottom: 2px;
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

  .message.compact .avatar {
    height: auto;
    min-height: 0;
    margin-top: 0;
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

  .structured-notice {
    color: var(--text-muted);
    font-size: 0.875rem;
  }
</style>

