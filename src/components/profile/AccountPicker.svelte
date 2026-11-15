<script lang="ts">
  import { t } from 'svelte-i18n';
  import DropdownMenu from '../ui/DropdownMenu.svelte';
  import {
    evmAccountDisplayName,
    evmAccountOptionLabel,
    type EvmAccountRow,
  } from '../../lib/wallet/evm-accounts';

  let {
    accounts,
    selectedId,
    onSelect,
  }: {
    accounts: EvmAccountRow[];
    selectedId: string;
    onSelect: (id: string) => void;
  } = $props();

  const selected = $derived(accounts.find((a) => a.id === selectedId) ?? null);
  const name = $derived(selected ? evmAccountDisplayName(selected) : '');
  const canSwitch = $derived(accounts.length > 1);
</script>

{#if canSwitch}
  <DropdownMenu align="start" panelClass="ui-dropdown-panel--list">
    {#snippet trigger({ open, toggle, menuId })}
      <button
        type="button"
        class="account-picker-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={$t('wallet.switchAccountAria')}
        title={$t('wallet.switchAccountAria')}
        onclick={toggle}
      >
        <span class="account-picker-name">{name}</span>
        <span class="account-picker-chevron" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M6 9L12 15L18 9"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
      </button>
    {/snippet}
    {#snippet children({ close })}
      {#each accounts as acc (acc.id)}
        <button
          type="button"
          class="ui-dropdown-item"
          class:ui-dropdown-item--active={acc.id === selectedId}
          role="menuitem"
          onclick={() => {
            close();
            onSelect(acc.id);
          }}
        >
          {evmAccountOptionLabel(acc)}
        </button>
      {/each}
    {/snippet}
  </DropdownMenu>
{:else}
  <span class="account-picker-name">{name}</span>
{/if}

<style>
  .account-picker-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-align: left;
  }

  .account-picker-btn:hover .account-picker-name,
  .account-picker-btn:hover .account-picker-chevron {
    color: var(--text-primary);
  }

  .account-picker-btn:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
    border-radius: 4px;
  }

  .account-picker-name {
    min-width: 0;
    font-size: 1.0625rem;
    font-weight: 600;
    line-height: 1.3;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .account-picker-chevron {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }
</style>
