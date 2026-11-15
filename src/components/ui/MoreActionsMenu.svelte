<script lang="ts">
  import DropdownMenu from './DropdownMenu.svelte';

  export type MoreActionsItem = {
    id: string;
    label: string;
    disabled?: boolean;
    onSelect: () => void;
  };

  let {
    ariaLabel,
    title = undefined,
    disabled = false,
    items,
    className = '',
  }: {
    ariaLabel: string;
    title?: string;
    disabled?: boolean;
    items: MoreActionsItem[];
    className?: string;
  } = $props();
</script>

<DropdownMenu class="more-actions {className}" align="end" panelClass="ui-dropdown-panel--list" {disabled}>
  {#snippet trigger({ open, toggle, menuId })}
    <button
      type="button"
      class="more-actions-trigger"
      {disabled}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      onclick={toggle}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        <circle cx="12" cy="5" r="1.75" />
        <circle cx="12" cy="12" r="1.75" />
        <circle cx="12" cy="19" r="1.75" />
      </svg>
    </button>
  {/snippet}
  {#snippet children({ close })}
    {#each items as item (item.id)}
      <button
        type="button"
        class="ui-dropdown-item"
        role="menuitem"
        disabled={item.disabled}
        onclick={() => {
          if (item.disabled) return;
          close();
          item.onSelect();
        }}
      >
        {item.label}
      </button>
    {/each}
  {/snippet}
</DropdownMenu>

<style>
  :global(.more-actions) {
    flex-shrink: 0;
  }

  .more-actions-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-elevated);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .more-actions-trigger:hover:not(:disabled) {
    border-color: var(--brand);
    color: var(--text-primary);
  }

  .more-actions-trigger:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 1px;
  }

  .more-actions-trigger:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
