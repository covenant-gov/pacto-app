<script lang="ts">
  import { t } from 'svelte-i18n';
  import { createEventDispatcher } from 'svelte';

  export let messageId: string;
  export let text: string = '';

  const dispatch = createEventDispatcher<{
    copy: { messageId: string; text: string };
    reply: { messageId: string };
  }>();

  function onCopy() {
    dispatch('copy', { messageId, text });
  }

  function onReply() {
    dispatch('reply', { messageId });
  }
</script>

<div class="message-actions-menu" role="group" aria-label="Message actions">
  <button
    type="button"
    class="menu-item"
    role="menuitem"
    aria-label="Copy message"
    title={$t('messaging.message.copy')}
    on:click={onCopy}
  >
    <span class="menu-icon" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
    </span>
    <span class="menu-label">{$t('messaging.message.copy')}</span>
  </button>
  <button
    type="button"
    class="menu-item"
    role="menuitem"
    aria-label="Reply to message"
    title={$t('messaging.message.reply')}
    on:click={onReply}
  >
    <span class="menu-icon" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </span>
    <span class="menu-label">{$t('messaging.message.reply')}</span>
  </button>
</div>

<style>
  .message-actions-menu {
    display: flex;
    flex-direction: column;
    min-width: 180px;
    padding: 6px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(0, 0, 0, 0.15);
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 12px;
    background: none;
    border: none;
    border-radius: 7px;
    color: var(--text-secondary);
    font-size: 0.9375rem;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }

  .menu-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .menu-item:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: -2px;
  }

  .menu-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .menu-item:hover .menu-icon {
    color: var(--text-primary);
  }

  .menu-label {
    flex: 1;
  }
</style>
