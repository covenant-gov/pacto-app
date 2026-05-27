<script lang="ts">
  import chevronDownIcon from '../../icons/chevron-down.svg';
  import {
    setSettingsSectionCollapsed,
    settingsSectionCollapsed,
    type SettingsSectionId,
  } from '../../lib/settings/settings-section-collapse';

  export let sectionId: SettingsSectionId;
  export let title: string;
  export let sectionClass = '';

  $: collapsed = $settingsSectionCollapsed[sectionId] ?? true;
  $: headingId = `${sectionId}-heading`;
  $: panelId = `${sectionId}-panel`;

  function toggleCollapsed() {
    setSettingsSectionCollapsed(sectionId, !collapsed);
  }
</script>

<section
  id={sectionId}
  class="settings-section {sectionClass}"
  class:settings-section--collapsed={collapsed}
  aria-labelledby={headingId}
>
  <h2 id={headingId} class="settings-section-title">
    <button
      type="button"
      class="settings-section-toggle"
      aria-expanded={!collapsed}
      aria-controls={panelId}
      on:click={toggleCollapsed}
    >
      <img
        src={chevronDownIcon}
        alt=""
        class="settings-section-chevron"
        class:settings-section-chevron--open={!collapsed}
      />
      <span class="settings-section-toggle-label">{title}</span>
    </button>
  </h2>

  <div id={panelId} class="settings-section-panel" hidden={collapsed}>
    <slot />
  </div>
</section>

<style>
  .settings-section-title {
    margin: 0 0 12px 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .settings-section--collapsed .settings-section-title {
    margin-bottom: 0;
  }

  .settings-section-panel {
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-page);
    overflow: hidden;
    padding: 24px 28px 28px;
    box-sizing: border-box;
  }

  .settings-section--evm .settings-section-panel {
    padding: 0;
  }

  .settings-section-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 4px 0;
    margin: 0;
    border: none;
    background: transparent;
    font: inherit;
    font-size: inherit;
    font-weight: inherit;
    color: inherit;
    cursor: pointer;
    text-align: left;
    border-radius: 8px;
    outline: none;
  }

  .settings-section-toggle:hover {
    color: var(--text-primary);
  }

  .settings-section-toggle:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .settings-section-chevron {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    display: block;
    transform: rotate(-90deg);
    transition: transform 0.15s ease;
    filter: var(--icon-dropdown-filter);
  }

  .settings-section-chevron--open {
    transform: rotate(0deg);
  }

  .settings-section-toggle-label {
    min-width: 0;
  }

  .settings-section-panel[hidden] {
    display: none;
  }
</style>
