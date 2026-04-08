<script lang="ts">
  import { onMount } from 'svelte';

  /**
   * Resizable sidebar: owns width state, resize handle, and window listeners.
   * Parent supplies content via default slot and a class for the wrapper (e.g. squad-navbar, network-navbar).
   */
  export let sidebarClass = '';
  /** Leading: pixels from left of viewport to the left edge of this sidebar. Trailing: unused. */
  export let leftOffset = 64;
  /** Leading: handle on the right. Trailing: handle on the left; drag left widens the panel. */
  export let edge: 'leading' | 'trailing' = 'leading';
  /** If set, width is restored and saved across sessions. */
  export let persistKey: string | undefined = undefined;
  export let minWidth = 180;
  export let maxWidth = 400;
  export let initialWidth = 240;

  let width = initialWidth;
  let isResizing = false;
  let resizeStartX = 0;
  let resizeStartWidth = 0;

  onMount(() => {
    if (!persistKey || typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(persistKey);
    if (!raw) return;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return;
    width = Math.max(minWidth, Math.min(maxWidth, n));
  });

  function clampW(w: number) {
    return Math.max(minWidth, Math.min(maxWidth, w));
  }

  function startResize(e: MouseEvent) {
    e.preventDefault();
    isResizing = true;
    resizeStartX = e.clientX;
    resizeStartWidth = width;
  }

  function onMouseMove(event: MouseEvent) {
    if (!isResizing) return;
    if (edge === 'trailing') {
      const delta = event.clientX - resizeStartX;
      width = clampW(resizeStartWidth - delta);
    } else {
      width = clampW(event.clientX - leftOffset);
    }
  }

  function stopResize() {
    if (isResizing && persistKey && typeof localStorage !== 'undefined') {
      localStorage.setItem(persistKey, String(width));
    }
    isResizing = false;
  }
</script>

<svelte:window on:mousemove={onMouseMove} on:mouseup={stopResize} />

<div
  class="resizable-sidebar {sidebarClass}"
  class:resizable-sidebar--trailing={edge === 'trailing'}
  class:resizable-sidebar--leading={edge === 'leading'}
  style="width: {width}px;"
>
  <slot />
  <button
    class="resize-handle"
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
    box-sizing: border-box;
  }

  .resizable-sidebar--trailing {
    border-left: 1px solid var(--border-subtle);
  }

  .resize-handle {
    position: absolute;
    top: 0;
    width: 4px;
    height: 100%;
    cursor: ew-resize;
    background-color: transparent;
    transition: background-color 0.15s;
    border: none;
    padding: 0;
    outline: none;
  }

  .resizable-sidebar--leading .resize-handle {
    right: 0;
    left: auto;
  }

  .resizable-sidebar--trailing .resize-handle {
    left: 0;
    right: auto;
  }

  .resize-handle:hover,
  .resize-handle:focus {
    background-color: var(--accent);
  }
</style>
