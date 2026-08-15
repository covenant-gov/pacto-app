<script lang="ts">
  import { t } from 'svelte-i18n';
  import {
    formatNativeEthAmount,
    summarizeTreasuryProposalAction,
    type ProposalActionInput,
    type ProposalActionSummary,
  } from '../../../lib/governance/proposal-action-summary';

  let { to, valueWei, dataHex, operation }: ProposalActionInput = $props();

  let summary: ProposalActionSummary = $derived(
    summarizeTreasuryProposalAction({ to, valueWei, dataHex, operation }),
  );

  function shortAddr(addr: string): string {
    const trimmed = addr.trim();
    if (trimmed.length < 12) return trimmed;
    return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
  }

  function extraNativeAmount(valueWei: string): string | null {
    try {
      return BigInt(valueWei) > 0n ? formatNativeEthAmount(valueWei) : null;
    } catch {
      return null;
    }
  }

  let extraNative = $derived(
    summary.kind === 'native_transfer' ? null : extraNativeAmount(summary.valueWei),
  );
</script>

<div class="action-summary">
  {#if summary.isDelegateCall}
    <p class="action-line muted">{$t('governance.proposal.action.delegatecallNote')}</p>
  {/if}

  {#if summary.kind === 'native_transfer'}
    <p class="action-line">
      {$t('governance.proposal.action.nativeTransfer', {
        values: { amount: formatNativeEthAmount(summary.valueWei), to: shortAddr(summary.to) },
      })}
    </p>
    <p class="action-meta muted" title={summary.to}>
      <code class="action-ref">{summary.to}</code>
    </p>
  {:else if summary.kind === 'erc20_transfer'}
    <p class="action-line">
      {$t('governance.proposal.action.erc20Transfer', {
        values: {
          amount: summary.amountRaw,
          to: shortAddr(summary.to),
          token: shortAddr(summary.token),
        },
      })}
    </p>
    <p class="action-meta muted" title={summary.token}>
      {$t('governance.proposal.action.token')}
      <code class="action-ref">{summary.token}</code>
    </p>
    <p class="action-meta muted" title={summary.to}>
      {$t('governance.proposal.action.recipient')}
      <code class="action-ref">{summary.to}</code>
    </p>
  {:else if summary.kind === 'erc20_approve'}
    <p class="action-line">
      {$t('governance.proposal.action.erc20Approve', {
        values: {
          amount: summary.amountRaw,
          spender: shortAddr(summary.spender),
          token: shortAddr(summary.token),
        },
      })}
    </p>
    <p class="action-meta muted" title={summary.token}>
      {$t('governance.proposal.action.token')}
      <code class="action-ref">{summary.token}</code>
    </p>
    <p class="action-meta muted" title={summary.spender}>
      {$t('governance.proposal.action.spender')}
      <code class="action-ref">{summary.spender}</code>
    </p>
  {:else}
    <p class="action-line">
      {$t('governance.proposal.action.unknownCall', {
        values: {
          selector: summary.selector || '—',
          to: shortAddr(summary.to),
        },
      })}
    </p>
    <p class="action-meta muted" title={summary.to}>
      {$t('governance.proposal.target')}
      <code class="action-ref">{summary.to}</code>
    </p>
    <details class="action-raw">
      <summary>{$t('governance.proposal.action.showRawCalldata')}</summary>
      <code class="action-ref action-raw-hex">{summary.dataHex}</code>
    </details>
  {/if}

  {#if extraNative}
    <p class="action-meta muted">
      {$t('governance.proposal.action.alsoSendsNative', { values: { amount: extraNative } })}
    </p>
  {/if}
</div>

<style>
  .action-summary {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0 0 8px 0;
  }
  .action-line,
  .action-meta {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.45;
  }
  .action-line {
    color: var(--text-primary);
    font-weight: 500;
  }
  .muted {
    color: var(--text-muted);
  }
  .action-ref {
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    word-break: break-all;
  }
  .action-raw {
    margin-top: 2px;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  .action-raw summary {
    cursor: pointer;
    user-select: none;
  }
  .action-raw-hex {
    display: block;
    margin-top: 6px;
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--bg-hover);
    white-space: pre-wrap;
  }
</style>
