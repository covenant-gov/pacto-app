<script lang="ts">
  import { onMount } from 'svelte';
  /**
   * Resizable sidebar: owns width state, resize handle, and window listeners.
   * Parent supplies content via default slot and a class for the wrapper (e.g. squad-navbar, network-navbar).
   */
  export let sidebarClass = '';
  /**
   * Leading: docked on the left; drag the right edge; width = clientX − leftOffset (DM list, squad channels).
   * Trailing: docked on the right; drag the left edge; width grows when the pointer moves left (DM wallet bar).
   */
  export let edge: 'leading' | 'trailing' = 'leading';
  /** Pixels from left of viewport to the left edge of this sidebar (leading edge only). */
  export let leftOffset = 64;
  export let minWidth = 180;
  export let maxWidth = 400;
  export let initialWidth = 240;
  /** When set, width is restored on load and saved when a resize ends. */
  export let persistKey: string | undefined = undefined;

  let width = initialWidth;
  let isResizing = false;
  let dragStartX = 0;
  let dragStartWidth = 0;

  onMount(() => {
    if (!persistKey || typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(persistKey);
    if (!raw) return;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) {
      width = Math.max(minWidth, Math.min(maxWidth, n));
    }
  });

  function startResize(event: MouseEvent) {
    event.preventDefault();
    isResizing = true;
    if (edge === 'trailing') {
      dragStartX = event.clientX;
      dragStartWidth = width;
    }
  }

  function onMouseMove(event: MouseEvent) {
    if (!isResizing) return;
    if (edge === 'trailing') {
      const delta = dragStartX - event.clientX;
      width = Math.max(minWidth, Math.min(maxWidth, dragStartWidth + delta));
    } else {
      const newWidth = event.clientX - leftOffset;
      width = Math.max(minWidth, Math.min(maxWidth, newWidth));
    }
  }

  function stopResize() {
    if (isResizing && persistKey && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(persistKey, String(width));
      } catch {
        // ignore
      }
    }
    isResizing = false;
  }
</script>

<svelte:window on:mousemove={onMouseMove} on:mouseup={stopResize} />

<div
  class="resizable-sidebar {sidebarClass}"
  class:resizable-sidebar--trailing={edge === 'trailing'}
  style="width: {width}px;"
>
  <slot />
  <button
    class="resize-handle"
    class:resize-handle--trailing={edge === 'trailing'}
    type="button"
    aria-label="Resize sidebar"
    on:mousedown={startResize}
  ></button>
</div>

<style>
  .resizable-sidebar {
    display: flex;
    flex-direction: column;
    position: relative;
    flex-shrink: 0;
    min-height: 0;
  }

  .resizable-sidebar--trailing {
    border-left: 1px solid var(--border-subtle);
  }

  .resize-handle {
    position: absolute;
    top: 0;
    right: 0;
    width: 4px;
    height: 100%;
    cursor: ew-resize;
    background-color: transparent;
    transition: background-color 0.15s;
    border: none;
    padding: 0;
    outline: none;
  }

  .resize-handle--trailing {
    right: auto;
    left: 0;
  }

  .resize-handle:hover,
  .resize-handle:focus {
    background-color: var(--accent);
  }
</style>
