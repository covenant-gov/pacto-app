<script lang="ts">
  import { t } from 'svelte-i18n';
  import CrewVoteModeSwitch from './CrewVoteModeSwitch.svelte';
  import {
    MAX_GOV_DELAY_SECS,
    MAX_QUORUM_BPS,
    MIN_GOV_DELAY_SECS,
    MIN_QUORUM_BPS,
    PRODUCTION_SQUAD_PARAMS,
    type CrewVoteMode,
    validateSquadParams,
  } from '../../../lib/governance/squad-params';

  let {
    customizing = $bindable(false),
    crewChangeDelaySecs = $bindable(PRODUCTION_SQUAD_PARAMS.crewChangeDelaySecs),
    proposalExpirySecs = $bindable(PRODUCTION_SQUAD_PARAMS.proposalExpirySecs),
    crewVoteMode = $bindable(PRODUCTION_SQUAD_PARAMS.crewVoteMode),
    quorumBps = $bindable(PRODUCTION_SQUAD_PARAMS.quorumBps),
    disabled = false,
  }: {
    customizing?: boolean;
    crewChangeDelaySecs?: number;
    proposalExpirySecs?: number;
    crewVoteMode?: CrewVoteMode;
    quorumBps?: number;
    disabled?: boolean;
  } = $props();

  const paramsError = $derived(
    customizing
      ? validateSquadParams({
          crewChangeDelaySecs: Number(crewChangeDelaySecs),
          proposalExpirySecs: Number(proposalExpirySecs),
          crewVoteMode,
          quorumBps: Number(quorumBps),
        })
      : null,
  );
</script>

<details class="squad-params-customize" bind:open={customizing}>
  <summary>{$t('governance.squadParams.customize')}</summary>
  <p class="hint">{$t('governance.squadParams.customizeHint')}</p>

  <div class="field">
    <label class="label" for="squad-params-crew-delay">
      {$t('governance.squadParams.crewChangeDelay')}
    </label>
    <input
      id="squad-params-crew-delay"
      class="input"
      type="number"
      min={MIN_GOV_DELAY_SECS}
      max={MAX_GOV_DELAY_SECS}
      step="1"
      bind:value={crewChangeDelaySecs}
      {disabled}
    />
  </div>

  <div class="field">
    <label class="label" for="squad-params-proposal-expiry">
      {$t('governance.squadParams.proposalExpiry')}
    </label>
    <input
      id="squad-params-proposal-expiry"
      class="input"
      type="number"
      min={MIN_GOV_DELAY_SECS}
      max={MAX_GOV_DELAY_SECS}
      step="1"
      bind:value={proposalExpirySecs}
      {disabled}
    />
    <p class="hint">
      {$t('governance.squadParams.delayBounds', {
        values: { min: MIN_GOV_DELAY_SECS, max: MAX_GOV_DELAY_SECS },
      })}
    </p>
  </div>

  <CrewVoteModeSwitch bind:mode={crewVoteMode} {disabled} name="deploy-crew-vote-mode" />

  {#if crewVoteMode === 'quorum'}
    <div class="field">
      <label class="label" for="squad-params-quorum-bps">
        {$t('governance.squadParams.quorumBps')}
      </label>
      <input
        id="squad-params-quorum-bps"
        class="input"
        type="number"
        min={MIN_QUORUM_BPS}
        max={MAX_QUORUM_BPS}
        step="1"
        bind:value={quorumBps}
        {disabled}
      />
      <p class="hint">
        {$t('governance.squadParams.quorumBounds', {
          values: { min: MIN_QUORUM_BPS, max: MAX_QUORUM_BPS },
        })}
      </p>
    </div>
  {/if}

  {#if paramsError}
    <p class="input-error" role="alert">{$t('governance.squadParams.error.invalid')}</p>
  {/if}
</details>

<style>
  .squad-params-customize {
    margin: 0 0 14px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated, var(--bg-panel));
  }
  summary {
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-primary);
  }
  .field {
    margin-top: 12px;
  }
  .label {
    display: block;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-muted);
    margin-bottom: 6px;
  }
  .input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.9375rem;
  }
  .hint {
    margin: 6px 0 0;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--text-muted);
  }
  .input-error {
    margin: 8px 0 0;
    font-size: 0.875rem;
    color: var(--danger, #c44);
  }
</style>
