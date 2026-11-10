<script lang="ts">
  import { t } from 'svelte-i18n';

  let {
    warGameStack = false,
    onSelectLive,
    onSelectWargame,
  }: {
    warGameStack?: boolean;
    onSelectLive: () => void;
    onSelectWargame: () => void;
  } = $props();
</script>

<div
  class="governance-stack-switcher"
  role="group"
  aria-label={$t('governance.stack.aria')}
>
  <button
    type="button"
    class="governance-stack-segment"
    class:active={!warGameStack}
    aria-pressed={!warGameStack}
    onclick={onSelectLive}
  >
    {$t('governance.stack.live')}
  </button>
  <button
    type="button"
    class="governance-stack-segment"
    class:active={warGameStack}
    aria-pressed={warGameStack}
    title={$t('governance.stack.wargameHint')}
    aria-label={$t('governance.stack.wargameAria')}
    onclick={onSelectWargame}
  >
    {$t('governance.stack.wargame')}
  </button>
</div>

<style>
  .governance-stack-switcher {
    display: inline-flex;
    align-items: stretch;
    gap: 0;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 2px;
  }
  .governance-stack-segment {
    padding: 0 8px;
    height: 28px;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-muted);
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.15s, background-color 0.15s;
  }
  .governance-stack-segment:hover:not(.active) {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }
  .governance-stack-segment:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 1px;
  }
  .governance-stack-segment.active {
    color: var(--text-primary);
    background: var(--bg-elevated);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }
</style>
