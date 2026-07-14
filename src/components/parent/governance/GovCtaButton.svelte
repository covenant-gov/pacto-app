<script lang="ts">
  import type { CtaGate } from '../../../lib/governance/governance-privilege';

  export let label: string;
  export let gate: CtaGate;
  export let acting = false;
  export let variant: 'primary' | 'secondary' | 'danger' = 'secondary';
  export let onClick: () => void = () => {};

  $: disabled = acting || !gate.enabled;
  $: title = gate.enabled ? label : gate.reason;
</script>

<button
  type="button"
  class="gov-cta"
  class:primary={variant === 'primary'}
  class:danger={variant === 'danger'}
  {disabled}
  {title}
  aria-disabled={disabled}
  on:click={() => {
    if (!disabled) onClick();
  }}
>
  {label}
</button>
{#if !gate.enabled && gate.reason}
  <p class="gov-cta-reason muted">{gate.reason}</p>
{/if}

<style>
  .gov-cta {
    font-size: 0.8125rem;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    border: 1px solid var(--border-subtle);
    background: var(--bg-secondary);
    color: var(--text-secondary);
  }
  .gov-cta.primary {
    background: var(--accent);
    color: var(--accent-contrast, #fff);
    border: none;
  }
  .gov-cta.danger {
    color: var(--danger, #e53e3e);
  }
  .gov-cta:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .gov-cta-reason {
    margin: 2px 0 0;
    font-size: 0.6875rem;
    line-height: 1.3;
  }
  .muted {
    color: var(--text-muted);
  }
</style>
