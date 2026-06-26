<script lang="ts">
  import { onMount } from 'svelte';
  import backIcon from '../../icons/chevron-double-left.svg';
  import { setSettingsSectionCollapsed, settingsSectionCollapsed } from '../../lib/settings/settings-section-collapse';

  export let onBack: () => void;

  const SECTION_LINKS = [
    { id: 'settings-profile', label: 'Profile' },
    { id: 'settings-nostr', label: 'Nostr' },
    { id: 'settings-evm', label: 'EVM' },
    { id: 'settings-app', label: 'App' },
    { id: 'settings-dangerzone', label: 'Dangerzone' },
  ] as const;

  const SCROLL_MARKER_OFFSET_PX = 48;
  const SCROLL_BOTTOM_TOLERANCE_PX = 8;

  let activeSectionId: (typeof SECTION_LINKS)[number]['id'] = SECTION_LINKS[0].id;
  let settingsMainEl: HTMLElement | undefined;

  function openSection(sectionId: (typeof SECTION_LINKS)[number]['id']) {
    setSettingsSectionCollapsed(sectionId, false);
  }

  function updateActiveSection() {
    const scrollRoot = settingsMainEl;
    if (!scrollRoot) return;

    if (
      scrollRoot.scrollTop + scrollRoot.clientHeight >=
      scrollRoot.scrollHeight - SCROLL_BOTTOM_TOLERANCE_PX
    ) {
      activeSectionId = SECTION_LINKS[SECTION_LINKS.length - 1].id;
      return;
    }

    const markerY = scrollRoot.getBoundingClientRect().top + SCROLL_MARKER_OFFSET_PX;
    let next = SECTION_LINKS[0].id;

    for (const link of SECTION_LINKS) {
      const el = document.getElementById(link.id);
      if (!el) continue;
      if (el.getBoundingClientRect().top <= markerY) {
        next = link.id;
      }
    }

    activeSectionId = next;
  }

  onMount(() => {
    const scrollRoot = settingsMainEl;
    if (!scrollRoot) return;

    updateActiveSection();

    const onScroll = () => updateActiveSection();
    scrollRoot.addEventListener('scroll', onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => updateActiveSection());
    resizeObserver.observe(scrollRoot);
    for (const link of SECTION_LINKS) {
      const el = document.getElementById(link.id);
      if (el) resizeObserver.observe(el);
    }

    const unsubscribeCollapse = settingsSectionCollapsed.subscribe(() => {
      requestAnimationFrame(updateActiveSection);
    });

    return () => {
      scrollRoot.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
      unsubscribeCollapse();
    };
  });
</script>

<div class="settings-page">
  <header class="settings-page-header">
    <button type="button" class="settings-back" on:click={onBack} aria-label="Back to DMs or Squads">
      <img src={backIcon} alt="" class="settings-back-icon" />
      <span>Back</span>
    </button>
    <h1 class="settings-page-title">Settings</h1>
  </header>

  <div class="settings-body">
    <nav class="settings-sidebar" aria-label="Settings sections">
      <ul class="settings-sidebar-list">
        {#each SECTION_LINKS as link (link.id)}
          <li>
            <a
              class="settings-sidebar-link"
              class:active={activeSectionId === link.id}
              href={`#${link.id}`}
              aria-current={activeSectionId === link.id ? 'location' : undefined}
              on:click={() => openSection(link.id)}
            >
              {link.label}
            </a>
          </li>
        {/each}
      </ul>
    </nav>

    <div class="settings-main" bind:this={settingsMainEl}>
      <div class="settings-sections">
        <slot />
      </div>
    </div>
  </div>
</div>

<style>
  .settings-page {
    width: 100%;
    height: 100%;
    min-height: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }

  .settings-page-header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 24px 24px 20px;
    min-width: 0;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .settings-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-family: inherit;
    cursor: pointer;
    flex-shrink: 0;
    outline: none;
  }

  .settings-back:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .settings-back:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .settings-back-icon {
    width: 18px;
    height: 18px;
    display: block;
    filter: var(--icon-dropdown-filter);
  }

  .settings-page-title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-primary);
    min-width: 0;
  }

  .settings-body {
    display: flex;
    align-items: stretch;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .settings-sidebar {
    width: 200px;
    flex-shrink: 0;
    padding: 20px 12px 32px 16px;
    border-right: 1px solid var(--border-subtle);
    box-sizing: border-box;
  }

  .settings-sidebar-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .settings-sidebar-link {
    display: block;
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--text-secondary);
    text-decoration: none;
    outline: none;
    transition: background-color 0.15s, color 0.15s;
  }

  .settings-sidebar-link:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .settings-sidebar-link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .settings-sidebar-link.active {
    background: var(--bg-elevated);
    color: var(--text-primary);
    box-shadow: inset 0 0 0 1px var(--border-subtle);
  }

  .settings-main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    padding: 24px 32px 64px;
    box-sizing: border-box;
  }

  .settings-sections {
    display: flex;
    flex-direction: column;
    gap: 24px;
    width: 100%;
  }

  :global(.settings-section) {
    scroll-margin-top: 24px;
  }

  :global(.settings-section:not(.settings-section--evm)) {
    max-width: 720px;
  }

  :global(.settings-section-stub) {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.9375rem;
    line-height: 1.5;
  }

  :global(.settings-section--evm) {
    max-width: none;
    width: 100%;
  }
</style>
