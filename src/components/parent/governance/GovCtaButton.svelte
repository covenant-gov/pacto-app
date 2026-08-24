<script lang="ts">
  import { t } from 'svelte-i18n';
  import { hideCtaInlineReason, type CtaGate } from '../../../lib/governance/governance-privilege';

  interface Props {
    label: string;
    gate: CtaGate;
    acting?: boolean;
    variant?: 'primary' | 'secondary' | 'danger' | 'execute';
    compact?: boolean;
    onClick?: () => void;
  }

  let {
    label,
    gate,
    acting = false,
    variant = 'secondary',
    compact = false,
    onClick = () => {},
  }: Props = $props();

  let disabled = $derived(acting || !gate.enabled);
  let title = $derived(gate.enabled ? label : $t(gate.reason));
</script>

<div class="gov-cta-wrap" class:compact>
  <button
    type="button"
    class="gov-cta"
    class:primary={variant === 'primary'}
    class:danger={variant === 'danger'}
    class:execute={variant === 'execute'}
    class:compact
    {disabled}
    {title}
    aria-disabled={disabled}
    onclick={() => {
      if (!disabled) onClick();
    }}
  >
    {label}
  </button>
  {#if !compact && !gate.enabled && gate.reason && !hideCtaInlineReason(gate.reason)}
    <p class="gov-cta-reason muted">{$t(gate.reason)}</p>
  {/if}
</div>

<style>
  .gov-cta-wrap {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .gov-cta-wrap.compact {
    width: 100%;
  }
  .gov-cta {
    font-size: 0.8125rem;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    align-self: flex-start;
  }
  .gov-cta.primary {
    background: var(--brand);
    color: var(--on-brand);
    border: none;
  }
  .gov-cta.execute {
    background: color-mix(in srgb, #16a34a 88%, var(--bg-panel));
    color: #fff;
    border: none;
  }
  .gov-cta.danger {
    color: var(--danger, #e53e3e);
  }
  .gov-cta.compact {
    width: 100%;
    padding: 4px 6px;
    font-size: 0.6875rem;
    line-height: 1.2;
    text-align: center;
    white-space: normal;
    align-self: stretch;
  }
  .gov-cta:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .gov-cta-reason {
    margin: 0;
    font-size: 0.6875rem;
    line-height: 1.3;
  }
  .muted {
    color: var(--text-muted);
  }
</style>
