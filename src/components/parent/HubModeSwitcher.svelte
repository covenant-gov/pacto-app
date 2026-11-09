<script lang="ts">
  import { nextHubModeIndex } from '../../lib/ui/hub-mode-tab-keyboard';

  let {
    modes,
    active,
    ariaLabel,
    labelFor,
    onSelect,
    onIntent,
  }: {
    modes: readonly string[];
    active: string;
    ariaLabel: string;
    labelFor: (mode: string) => string;
    onSelect: (mode: string) => void;
    onIntent?: (mode: string) => void;
  } = $props();

  function selectAt(index: number, currentTarget: HTMLElement) {
    const mode = modes[index];
    if (!mode) return;
    onSelect(mode);
    const buttons = currentTarget
      .closest('[role="tablist"]')
      ?.querySelectorAll<HTMLElement>('[role="tab"]');
    buttons?.[index]?.focus();
  }

  function onTabKeydown(event: KeyboardEvent, index: number) {
    const next = nextHubModeIndex(modes.length, index, event.key);
    if (next == null) return;
    event.preventDefault();
    selectAt(next, event.currentTarget as HTMLElement);
  }
</script>

<div class="hub-view-nav" role="tablist" aria-label={ariaLabel}>
  <div class="hub-mode-switcher" role="group">
    {#each modes as mode, index (mode)}
      <button
        type="button"
        role="tab"
        class="hub-mode-segment"
        class:active={active === mode}
        aria-selected={active === mode}
        tabindex={active === mode ? 0 : -1}
        onclick={() => onSelect(mode)}
        onkeydown={(e) => onTabKeydown(e, index)}
        onmouseenter={() => onIntent?.(mode)}
        onfocus={() => onIntent?.(mode)}
      >
        {labelFor(mode)}
      </button>
    {/each}
  </div>
</div>

<style>
  .hub-view-nav {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 48px;
    min-height: 48px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    flex-shrink: 0;
  }
  .hub-mode-switcher {
    display: inline-flex;
    align-items: stretch;
    max-width: 100%;
    overflow-x: auto;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 3px;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.06);
  }
  .hub-mode-segment {
    padding: 0 10px;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--text-muted);
    background: transparent;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.15s, background-color 0.15s;
  }
  .hub-mode-segment:hover:not(.active) {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }
  .hub-mode-segment:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }
  .hub-mode-segment.active {
    color: var(--text-primary);
    background: var(--bg-elevated);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }
</style>
