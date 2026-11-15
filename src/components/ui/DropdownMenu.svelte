<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    trigger,
    children,
    align = 'start',
    panelRole = 'menu',
    panelClass = '',
    multiselectable = false,
    disabled = false,
    class: className = '',
  }: {
    trigger: Snippet<[{ open: boolean; toggle: () => void; menuId: string }]>;
    children: Snippet<[{ close: () => void }]>;
    align?: 'start' | 'end' | 'stretch';
    panelRole?: 'menu' | 'listbox';
    panelClass?: string;
    multiselectable?: boolean;
    disabled?: boolean;
    class?: string;
  } = $props();

  const menuId = $props.id();
  let open = $state(false);
  let rootEl: HTMLDivElement | null = $state(null);

  function toggle() {
    if (disabled) return;
    open = !open;
  }

  function close() {
    open = false;
  }

  $effect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (rootEl && e.target instanceof Node && rootEl.contains(e.target)) return;
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

<div class="ui-dropdown {className}" bind:this={rootEl}>
  {@render trigger({ open, toggle, menuId })}
  {#if open}
    <div
      id={menuId}
      class="ui-dropdown-panel ui-dropdown-panel--{align} {panelClass}"
      role={panelRole}
      aria-multiselectable={panelRole === 'listbox' && multiselectable ? true : undefined}
    >
      {@render children({ close })}
    </div>
  {/if}
</div>
