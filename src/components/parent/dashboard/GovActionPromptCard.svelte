<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { GovActionPrompt } from '../../../lib/governance/gov-action-prompts';
  import { openGovernanceFromPrompt } from '../../../stores/gov-action-prompts';

  let { prompt }: { prompt: GovActionPrompt } = $props();
</script>

<div
  class="gov-prompt-card"
  role="region"
  aria-label={$t(prompt.titleKey)}
>
  <p class="gov-prompt-title">{$t(prompt.titleKey)}</p>
  <p class="gov-prompt-desc">
    {$t(prompt.bodyKey, { values: prompt.bodyValues ?? {} })}
  </p>
  <div class="gov-prompt-actions">
    <button
      type="button"
      class="btn-primary"
      onclick={() => openGovernanceFromPrompt(prompt.parentId)}
    >
      {$t('governance.alerts.prompt.openGovernance')}
    </button>
  </div>
</div>

<style>
  .gov-prompt-card {
    margin: 8px 16px;
    padding: 14px 16px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 8px;
    max-width: 520px;
  }

  .gov-prompt-title {
    margin: 0 0 6px 0;
    font-weight: 600;
    font-size: 0.9375rem;
    color: var(--text-primary);
  }

  .gov-prompt-desc {
    margin: 0 0 12px 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }

  .gov-prompt-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .btn-primary {
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    border: none;
    background: var(--accent);
    color: var(--on-accent, #fff);
  }
</style>
