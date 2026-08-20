<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { CrewVoteMode } from '../../../lib/governance/squad-params';

  let {
    mode = $bindable('majority'),
    disabled = false,
    name = 'crew-vote-mode',
    showHints = true,
  }: {
    mode?: CrewVoteMode;
    disabled?: boolean;
    name?: string;
    showHints?: boolean;
  } = $props();
</script>

<div class="vote-mode">
  <p class="label" id={`${name}-label`}>{$t('governance.squadParams.crewVoteMode')}</p>
  <div class="segmented" role="radiogroup" aria-labelledby={`${name}-label`}>
    <label class="segmented-option">
      <input type="radio" {name} value="majority" bind:group={mode} {disabled} />
      <span>{$t('governance.squadParams.majority')}</span>
    </label>
    <label class="segmented-option">
      <input type="radio" {name} value="quorum" bind:group={mode} {disabled} />
      <span>{$t('governance.squadParams.quorum')}</span>
    </label>
  </div>
  {#if showHints}
    <p class="hint">
      {#if mode === 'quorum'}
        {$t('governance.squadParams.quorumHint')}
      {:else}
        {$t('governance.squadParams.majorityHint')}
      {/if}
    </p>
  {/if}
</div>

<style>
  .vote-mode {
    margin-top: 12px;
  }
  .label {
    display: block;
    margin: 0 0 6px;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-muted);
  }
  .segmented {
    display: inline-flex;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    overflow: hidden;
  }
  .segmented-option {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 7px 12px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    cursor: pointer;
    border-right: 1px solid var(--border-subtle);
  }
  .segmented-option:last-child {
    border-right: none;
  }
  .segmented-option:has(input:checked) {
    background: var(--brand);
    color: var(--on-brand);
  }
  .segmented-option:has(input:disabled) {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .segmented-option input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }
  .hint {
    margin: 6px 0 0;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--text-muted);
  }
</style>
