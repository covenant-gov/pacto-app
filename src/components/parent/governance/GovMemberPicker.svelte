<script lang="ts">
  import { t } from 'svelte-i18n';
  import { shortEvmAddress } from '../../../lib/governance/hats-tree-annotations';
  import type { MemberEvmOption } from '../../../lib/governance/gov-member-options';

  let {
    value = $bindable(''),
    options = [],
    labelKey = '',
    ariaLabelKey,
    emptyKey,
    loading = false,
    loadingKey = 'governance.field.memberOptionsLoading',
    disabled = false,
    selectId = '',
  }: {
    value?: string;
    options?: MemberEvmOption[];
    labelKey?: string;
    ariaLabelKey: string;
    emptyKey: string;
    loading?: boolean;
    loadingKey?: string;
    disabled?: boolean;
    selectId?: string;
  } = $props();

  const list = $derived.by(() => {
    void options.length;
    return options.map((o) => ({ address: o.address, label: o.label }));
  });

  $effect(() => {
    const opts = list;
    if (opts.length === 0) {
      if (value) value = '';
      return;
    }
    const hit = opts.some((o) => o.address.trim().toLowerCase() === value.trim().toLowerCase());
    if (!value.trim() || !hit) {
      value = opts[0].address;
    }
  });
</script>

<div class="gov-member-picker">
  {#if labelKey}
    <span class="field-label" id={selectId ? `${selectId}-label` : undefined}>{$t(labelKey)}</span>
  {/if}
  {#if list.length > 0}
    <select
      id={selectId || undefined}
      bind:value
      {disabled}
      aria-label={$t(ariaLabelKey)}
      aria-labelledby={labelKey && selectId ? `${selectId}-label` : undefined}
    >
      {#each list as opt (opt.address)}
        <option value={opt.address}>{opt.label} — {shortEvmAddress(opt.address)}</option>
      {/each}
    </select>
  {:else}
    <p class="muted" role="status">{$t(loading ? loadingKey : emptyKey)}</p>
  {/if}
</div>

<style>
  .gov-member-picker {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field-label {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .muted {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  select {
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.8125rem;
  }
</style>
