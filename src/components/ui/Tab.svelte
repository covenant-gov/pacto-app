<script lang="ts">
  import { portal } from '../../lib/utils/portal';

  export let active: boolean = false;
  export let label: string = "";
  export let image: string = "";
  export let icon: string = "";
  /** Unread indicator (no count) on the server button. */
  export let hasUnreadDot = false;

  $: firstLetter = label.charAt(0).toUpperCase();
  $: showImage = !!image && !imageBroken;

  let buttonEl: HTMLButtonElement;
  let imageBroken = false;
  $: image, (imageBroken = false);
  let showTooltip = false;
  let tooltipPos = { x: 0, y: 0 };

  function handleTooltipEnter() {
    const rect = buttonEl.getBoundingClientRect();
    tooltipPos = {
      x: rect.right + 10,
      y: rect.top + rect.height / 2,
    };
    showTooltip = true;
  }

  function handleTooltipLeave() {
    showTooltip = false;
  }
</script>

<button
  bind:this={buttonEl}
  class="server-button {active ? 'active' : ''}"
  aria-label={label}
  on:mouseenter={handleTooltipEnter}
  on:mouseleave={handleTooltipLeave}
>
  {#if hasUnreadDot}
    <span class="tab-unread-dot" aria-hidden="true"></span>
  {/if}
  {#if showImage}
    <span class="tab-image-wrap">
      <img src={image} alt={label} class="tab-image" on:error={() => (imageBroken = true)} />
    </span>
  {:else if icon}
    <img src={icon} alt={label} class="tab-icon" />
  {:else}
    <span class="label">
      <slot>{firstLetter}</slot>
    </span>
  {/if}
</button>

{#if showTooltip}
  <div
    class="tab-tooltip-portal"
    style="left: {tooltipPos.x}px; top: {tooltipPos.y}px;"
    use:portal
    role="tooltip"
  >
    {label}
  </div>
{/if}

<style>
  .server-button {
    width: 48px;
    height: 48px;
    background: var(--border-subtle);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, box-shadow 0.15s, border-radius 0.15s;
    cursor: pointer;
    border: none;
    outline: none;
    margin: 4px 0;
    box-shadow: none;
    position: relative;
    user-select: none;
    -webkit-user-select: none;
  }

  .tab-unread-dot {
    position: absolute;
    top: 2px;
    right: 2px;
    z-index: 1;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--brand);
    border: 2px solid var(--bg-panel);
    pointer-events: none;
  }

  .server-button.active,
  .server-button:hover {
    background: var(--brand);
    box-shadow: 0 2px 8px color-mix(in srgb, var(--brand) 20%, transparent);
  }

  .server-button:focus {
    outline: none;
  }

  .server-button:focus-visible {
    background: var(--brand);
    box-shadow: 0 0 0 2px var(--bg-panel), 0 0 0 4px var(--brand);
  }

  .label {
    color: var(--text-primary);
    font-size: 1.25rem;
    font-weight: 600;
    pointer-events: none;
    text-align: center;
    width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    user-select: none;
    -webkit-user-select: none;
  }

  .tab-image-wrap {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    overflow: hidden;
    pointer-events: none;
  }

  .tab-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .tab-icon {
    width: 56%;
    height: 56%;
    object-fit: contain;
    pointer-events: none;
  }

  /* Rendered in portal (body) so not constrained by navbar; appears to the right of the button */
  .tab-tooltip-portal {
    position: fixed;
    transform: translateY(-50%);
    padding: 10px 14px;
    background: var(--bg-elevated);
    color: var(--text-primary);
    border-radius: 8px;
    font-size: 0.9375rem;
    font-weight: 500;
    white-space: nowrap;
    pointer-events: none;
    z-index: 10000;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    border: 1px solid var(--border);
    opacity: 0;
    animation: tab-tooltip-in 0.08s ease-out forwards;
  }

  .tab-tooltip-portal::before {
    content: '';
    position: absolute;
    right: 100%;
    top: 50%;
    transform: translateY(-50%);
    border: 6px solid transparent;
    border-right-color: var(--bg-elevated);
  }

  @keyframes tab-tooltip-in {
    from {
      opacity: 0;
      transform: translateY(-50%) translateX(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(-50%) translateX(0);
    }
  }
</style>
