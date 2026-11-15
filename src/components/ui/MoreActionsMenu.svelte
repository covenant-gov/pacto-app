<script lang="ts">
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

  let open = $state(false);
  let wrapEl: HTMLDivElement | null = $state(null);
  const menuId = $derived(`more-actions-menu-${ariaLabel.replace(/\s+/g, '-').toLowerCase()}`);

  function toggle() {
    if (disabled) return;
    open = !open;
  }

  function close() {
    open = false;
  }

  function selectItem(item: MoreActionsItem) {
    if (item.disabled) return;
    close();
    item.onSelect();
  }

  $effect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (wrapEl && e.target instanceof Node && wrapEl.contains(e.target)) return;
      open = false;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') open = false;
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

<div class="more-actions {className}" bind:this={wrapEl}>
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
  {#if open}
    <div id={menuId} class="more-actions-menu" role="menu">
      {#each items as item (item.id)}
        <button
          type="button"
          class="more-actions-item"
          role="menuitem"
          disabled={item.disabled}
          onclick={() => selectItem(item)}
        >
          {item.label}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .more-actions {
    position: relative;
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

  .more-actions-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 20;
    min-width: 160px;
    padding: 4px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-elevated);
    box-shadow: 0 8px 24px color-mix(in srgb, var(--text-primary) 12%, transparent);
  }

  .more-actions-item {
    display: block;
    width: 100%;
    margin: 0;
    padding: 8px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: 0.8125rem;
    text-align: left;
    cursor: pointer;
  }

  .more-actions-item:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .more-actions-item:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
