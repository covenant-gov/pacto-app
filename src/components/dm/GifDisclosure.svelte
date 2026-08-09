<script lang="ts">
  import { t } from 'svelte-i18n';

  type Props = {
    onAccept: () => void;
    onDecline: () => void;
  };
  const { onAccept, onDecline }: Props = $props();
</script>

<div class="gif-disclosure" role="region" aria-label={$t('messaging.messageInput.gifsDisclosureTitle')}>
  <h4 class="gif-disclosure-title">{$t('messaging.messageInput.gifsDisclosureTitle')}</h4>
  <p class="gif-disclosure-body">{$t('messaging.messageInput.gifsDisclosureBody')}</p>
  <div class="gif-disclosure-actions">
    <button type="button" class="gif-disclosure-decline" onclick={onDecline}>
      {$t('messaging.messageInput.gifsDisclosureDecline')}
    </button>
    <button type="button" class="gif-disclosure-accept" onclick={onAccept}>
      {$t('messaging.messageInput.gifsDisclosureAccept')}
    </button>
  </div>
</div>

<style>
  .gif-disclosure {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 12px;
  }

  .gif-disclosure-title {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .gif-disclosure-body {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--text-muted);
  }

  .gif-disclosure-actions {
    display: flex;
    gap: 8px;
    margin-top: 4px;
  }

  .gif-disclosure-accept,
  .gif-disclosure-decline {
    flex: 1;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
  }

  .gif-disclosure-accept {
    border: none;
    background: var(--accent);
    color: var(--bg-primary);
  }

  .gif-disclosure-decline {
    border: 1px solid var(--border-subtle);
    background: none;
    color: var(--text-muted);
  }

  .gif-disclosure-decline:hover {
    color: var(--text-primary);
  }
</style>
