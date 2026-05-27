<script lang="ts">
  import { theme, setTheme, THEME_OPTIONS } from '../../stores/theme';
  import SettingsCollapsibleSection from './SettingsCollapsibleSection.svelte';
</script>

<SettingsCollapsibleSection sectionId="settings-app" title="App settings">
  <div class="theme-section" aria-labelledby="theme-heading">
    <h3 id="theme-heading" class="theme-subheading">Appearance</h3>
    <span class="theme-label">Theme</span>
    <div class="theme-options" role="radiogroup" aria-label="App theme">
      {#each THEME_OPTIONS as opt (opt.value)}
        <label class="theme-option">
          <input
            type="radio"
            name="theme"
            value={opt.value}
            checked={$theme === opt.value}
            on:change={() => setTheme(opt.value)}
          />
          <span class="theme-option-label">{opt.label}</span>
        </label>
      {/each}
    </div>
  </div>
</SettingsCollapsibleSection>

<style>
  .theme-section {
    margin: 0;
  }

  .theme-subheading {
    color: var(--text-primary);
    font-size: 1rem;
    font-weight: 600;
    margin: 0 0 8px 0;
  }

  .theme-label {
    display: block;
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin-bottom: 8px;
  }

  .theme-options {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }

  .theme-option {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    color: var(--text-primary);
    font-size: 0.9375rem;
  }

  .theme-option input {
    accent-color: var(--accent);
  }

  .theme-option-label {
    user-select: none;
  }
</style>
