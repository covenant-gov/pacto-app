<script lang="ts">
  import { activeTopNavTab, type TopNavTab } from '../stores/app';

  const tabs: { id: TopNavTab; label: string }[] = [
    { id: 'dms', label: 'DMs' },
    { id: 'networks', label: 'Networks' },
    { id: 'communities', label: 'Communities' },
  ];

  function selectTab(id: TopNavTab) {
    $activeTopNavTab = id;
  }
</script>

<div class="top-navbar" role="tablist" aria-label="Main navigation">
  {#each tabs as tab}
    <button
      type="button"
      role="tab"
      class="tab"
      class:active={$activeTopNavTab === tab.id}
      on:click={() => selectTab(tab.id)}
      aria-selected={$activeTopNavTab === tab.id}
      aria-label={tab.label}
    >
      {tab.label}
    </button>
  {/each}
</div>

<style>
  .top-navbar {
    height: 40px;
    min-height: 40px;
    width: 100%;
    background-color: #2b2d31;
    border-bottom: 1px solid #1e1f22;
    display: flex;
    align-items: stretch;
    flex-shrink: 0;
  }

  .tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 12px;
    font-size: 0.8125rem;
    font-weight: 500;
    color: #b5bac1;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    transition: color 0.15s, background-color 0.15s, border-color 0.15s;
    outline: none;
  }

  .tab:hover {
    color: #f2f3f5;
    background-color: rgba(255, 255, 255, 0.04);
  }

  .tab:focus-visible {
    outline: 2px solid #5865f2;
    outline-offset: -2px;
  }

  .tab.active {
    color: #f2f3f5;
    border-bottom-color: #5865f2;
    background-color: rgba(255, 255, 255, 0.02);
  }
</style>
