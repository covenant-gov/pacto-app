<script lang="ts">
  import { t } from 'svelte-i18n';
  import { normalizeLeadingDotDecimalInput } from '../../../lib/wallet/amount-input';
  import { parseOptionalDepositWei } from '../../../lib/governance/sponsor-deposit';

  let {
    includeDeposit = $bindable(false),
    depositEth = $bindable('0.01'),
    disabled = false,
    depositExceedsBalance = false,
    inputId = 'sponsor-initial-deposit',
    labelKey = 'governance.sponsorInitialDeposit.label',
    checkboxKey = 'governance.sponsorInitialDeposit.checkbox',
    placeholderKey = 'governance.sponsorInitialDeposit.placeholder',
    hintKey = 'governance.sponsorInitialDeposit.hint',
    hintOptionalKey = 'governance.sponsorInitialDeposit.hintOptional',
    errorInvalidKey = 'governance.sponsorInitialDeposit.error.invalid',
    errorExceedsKey = 'governance.sponsorInitialDeposit.error.exceedsBalance',
    exceedsBalanceValues = {},
  }: {
    includeDeposit?: boolean;
    depositEth?: string;
    disabled?: boolean;
    depositExceedsBalance?: boolean;
    inputId?: string;
    labelKey?: string;
    checkboxKey?: string;
    placeholderKey?: string;
    hintKey?: string;
    hintOptionalKey?: string;
    errorInvalidKey?: string;
    errorExceedsKey?: string;
    exceedsBalanceValues?: Record<string, string | number>;
  } = $props();

  const depositTrimmed = $derived(depositEth.trim());
  const depositWei = $derived(parseOptionalDepositWei(includeDeposit ? depositTrimmed : '0'));
  const depositInvalidFormat = $derived(
    includeDeposit && depositTrimmed.length > 0 && depositWei === null,
  );

  function onDepositInput(e: Event) {
    depositEth = normalizeLeadingDotDecimalInput((e.currentTarget as HTMLInputElement).value);
  }
</script>

<label class="sponsor-deposit-toggle">
  <input type="checkbox" bind:checked={includeDeposit} {disabled} />
  <span>{$t(checkboxKey)}</span>
</label>

{#if includeDeposit}
  <div class="sponsor-deposit-amount">
    <label class="sponsor-deposit-label" for={inputId}>{$t(labelKey)}</label>
    <input
      id={inputId}
      type="text"
      class="sponsor-deposit-input"
      class:input-invalid={depositInvalidFormat || depositExceedsBalance}
      placeholder={$t(placeholderKey)}
      value={depositEth}
      oninput={onDepositInput}
      {disabled}
      autocomplete="off"
      inputmode="decimal"
      aria-invalid={depositInvalidFormat || depositExceedsBalance ? 'true' : undefined}
    />
    {#if depositInvalidFormat}
      <p class="input-error" role="alert">{$t(errorInvalidKey)}</p>
    {:else if depositExceedsBalance}
      <p class="input-error" role="alert">
        {$t(errorExceedsKey, { values: exceedsBalanceValues })}
      </p>
    {:else if depositWei !== null}
      <p class="sponsor-deposit-hint muted">
        {#if depositWei === 0n}
          {$t(hintOptionalKey)}
        {:else}
          {$t(hintKey)}
        {/if}
      </p>
    {/if}
  </div>
{/if}

<style>
  .sponsor-deposit-toggle {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0 0 10px;
    font-size: 0.875rem;
    line-height: 1.4;
    cursor: pointer;
  }

  .sponsor-deposit-amount {
    margin: 0 0 14px;
  }

  .sponsor-deposit-label {
    display: block;
    margin: 0 0 6px;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-muted);
  }

  .sponsor-deposit-input {
    width: 100%;
    box-sizing: border-box;
  }

  .sponsor-deposit-hint {
    margin: 6px 0 0;
    font-size: 0.8125rem;
    line-height: 1.4;
  }

  .muted {
    color: var(--text-muted);
  }
</style>
