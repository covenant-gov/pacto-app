<script lang="ts">
  import type { Snippet } from 'svelte';
  import { formatAssetAmount } from '../../lib/evm/format-token-amount';

  let {
    raw,
    symbol,
    decimals,
    pending = false,
    symbolTitle = '',
    extra,
  }: {
    raw: bigint | string | null | undefined;
    symbol: string;
    decimals?: number;
    pending?: boolean;
    symbolTitle?: string;
    extra?: Snippet;
  } = $props();

  const amount = $derived(
    pending
      ? '…'
      : raw == null || raw === ''
        ? '—'
        : (formatAssetAmount(raw, { symbol, decimals }) ?? '—'),
  );
</script>

<dt class="token-amount-symbol" title={symbolTitle || undefined}>{symbol}</dt>
<dd class="token-amount-dd">
  <strong class="token-amount-value">{amount}</strong>
  {@render extra?.()}
</dd>

<style>
  :global(dl.token-amount-list) {
    margin: 0;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px 14px;
    font-size: 0.875rem;
  }

  .token-amount-symbol {
    margin: 0;
    color: var(--text-muted);
    font-weight: 500;
  }

  .token-amount-dd {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    color: var(--text-primary);
  }

  .token-amount-value {
    font-variant-numeric: tabular-nums;
    word-break: break-all;
  }
</style>
