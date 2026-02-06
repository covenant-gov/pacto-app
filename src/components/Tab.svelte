<script lang="ts">
  export let active: boolean = false;
  export let label: string = "";
  export let image: string = "";
  export let icon: string = "";

  $: firstLetter = label.charAt(0).toUpperCase();
</script>

<button
  class="server-button {active ? 'active' : ''}"
  aria-label={label}
>
  {#if image}
    <img src={image} alt={label} class="tab-image" />
  {:else if icon}
    <img src={icon} alt={label} class="tab-icon" />
  {:else}
    <span class="label">
      <slot>{firstLetter}</slot>
    </span>
  {/if}
  <span class="tooltip">{label}</span>
</button>

<style>
  .server-button {
    width: 48px;
    height: 48px;
    background: #313338;
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
  }

  .server-button.active,
  .server-button:focus,
  .server-button:hover {
    background: #5865f2;
    box-shadow: 0 2px 8px rgba(80,100,255,0.2);
  }

  .label {
    color: #f6f6f6;
    font-size: 1.25rem;
    font-weight: 600;
    pointer-events: none;
    text-align: center;
    width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .tab-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }

  .tab-icon {
    width: 56%;
    height: 56%;
    object-fit: contain;
    pointer-events: none;
  }

  .tooltip {
    position: absolute;
    left: calc(100% + 12px);
    top: 50%;
    transform: translateY(-50%);
    background: #1a1a1a;
    color: #f6f6f6;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 0.875rem;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s ease;
    z-index: 1000;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .tooltip::before {
    content: '';
    position: absolute;
    right: 100%;
    top: 50%;
    transform: translateY(-50%);
    border: 6px solid transparent;
    border-right-color: #1a1a1a;
  }

  .server-button:hover .tooltip {
    opacity: 1;
  }
</style>


