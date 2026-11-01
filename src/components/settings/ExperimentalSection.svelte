<svelte:options runes={true} />

<script lang="ts">
  import { t } from 'svelte-i18n';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import SettingsCollapsibleSection from './SettingsCollapsibleSection.svelte';
  import { featureFlags, setFeatureFlagEnabled } from '../../stores/feature-flags';

  function handleToggle(key: string, e: Event & { currentTarget: HTMLInputElement }): void {
    setFeatureFlagEnabled(key, e.currentTarget.checked);
  }
</script>

<SettingsCollapsibleSection sectionId="settings-experimental" title={$t('settings.experimental.title')}>
  <div class="experimental-settings">
    <p class="experimental-intro">{$t('settings.experimental.intro')}</p>

    {#if $featureFlags.length === 0}
      <p class="experimental-empty">{$t('settings.experimental.empty')}</p>
    {:else}
      <ul class="experimental-list" role="list">
        {#each $featureFlags as flag (flag.key)}
          {@const nameId = `experimental-flag-${flag.key}-name`}
          {@const descriptionId = `experimental-flag-${flag.key}-description`}
          <li>
            <label class="experimental-row">
              <span class="experimental-copy">
                <span class="experimental-heading">
                  <span id={nameId} class="experimental-name">
                    {$t(`settings.experimental.flags.${flag.key}.name`)}
                  </span>
                  <Badge variant="warning-soft">{$t('settings.experimental.badge')}</Badge>
                </span>
                <span id={descriptionId} class="experimental-description">
                  {$t(`settings.experimental.flags.${flag.key}.description`)}
                </span>
              </span>
              <input
                type="checkbox"
                role="switch"
                class="experimental-switch"
                checked={flag.enabled}
                aria-labelledby={nameId}
                aria-describedby={descriptionId}
                onchange={(e) => handleToggle(flag.key, e)}
              />
            </label>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</SettingsCollapsibleSection>

<style>
  .experimental-settings {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .experimental-intro,
  .experimental-empty {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .experimental-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .experimental-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 14px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-panel);
    cursor: pointer;
  }

  .experimental-row:hover {
    background: var(--bg-hover);
  }

  .experimental-copy {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .experimental-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .experimental-name {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .experimental-description {
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }

  .experimental-switch {
    appearance: none;
    flex-shrink: 0;
    position: relative;
    width: 40px;
    height: 24px;
    margin: 0;
    border-radius: 999px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    cursor: pointer;
    transition: background-color 0.15s var(--ease-out), border-color 0.15s var(--ease-out);
  }

  .experimental-switch::before {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--text-muted);
    transition: transform 0.15s var(--ease-out);
  }

  .experimental-switch:checked {
    background: var(--brand);
    border-color: var(--brand);
  }

  .experimental-switch:checked::before {
    background: var(--on-brand);
    transform: translateX(16px);
  }

  .experimental-switch:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .experimental-switch,
    .experimental-switch::before {
      transition: none;
    }
  }
</style>
