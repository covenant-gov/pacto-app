<script lang="ts">
  /**
   * Resizable sidebar: owns width state, resize handle, and window listeners.
   * Parent supplies content via default slot and a class for the wrapper (e.g. squad-navbar, network-navbar).
   */
  export let sidebarClass = '';
  /** Pixels from left of viewport to the left edge of this sidebar (used to compute width from clientX). */
  export let leftOffset = 64;
  export let minWidth = 180;
  export let maxWidth = 400;
  export let initialWidth = 240;

  let width = initialWidth;
  let isResizing = false;

  function startResize() {
    isResizing = true;
  }

  function onMouseMove(event: MouseEvent) {
    if (!isResizing) return;
    const newWidth = event.clientX - leftOffset;
    width = Math.max(minWidth, Math.min(maxWidth, newWidth));
  }

  function stopResize() {
    isResizing = false;
  }
</script>

<svelte:window on:mousemove={onMouseMove} on:mouseup={stopResize} />

<div class="resizable-sidebar {sidebarClass}" style="width: {width}px;">
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

  .resize-handle:hover,
  .resize-handle:focus {
    background-color: var(--accent);
  }
</style>
