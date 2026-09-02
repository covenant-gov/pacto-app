<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { focusProfileUsername } from '../../stores/navigation';
  import {
    claimedUsername,
    isUsernameVerified,
    refreshUsernameState,
    usernameState,
  } from '../../stores/username';

  onMount(() => {
    void refreshUsernameState();
  });

  const loading = $derived(
    $usernameState.status === 'idle' || $usernameState.status === 'loading',
  );
  const username = $derived($claimedUsername);
  const verified = $derived($isUsernameVerified);
</script>

<section class="commons-early-adopter" aria-label={$t('commons.earlyAdopter.ariaLabel')}>
  <div class="commons-early-adopter-row">
    {#if loading}
      <div class="commons-early-adopter-copy">
        <h2 class="commons-early-adopter-title">{$t('commons.earlyAdopter.title')}</h2>
        <p class="commons-early-adopter-lead">{$t('commons.earlyAdopter.loading')}</p>
      </div>
    {:else if username}
      <button
        type="button"
        class="commons-early-adopter-claimed-btn"
        aria-label={$t('commons.earlyAdopter.ctaAria')}
        onclick={focusProfileUsername}
      >
        <span class="commons-early-adopter-title">{$t('commons.earlyAdopter.title')}</span>
        <span class="commons-early-adopter-claimed">
          {$t('commons.earlyAdopter.claimed', { values: { username } })}
          {#if verified}
            <span class="commons-early-adopter-verified" title={$t('commons.earlyAdopter.verified')}
              >✓</span
            >
          {/if}
        </span>
      </button>
    {:else}
      <div class="commons-early-adopter-copy">
        <h2 class="commons-early-adopter-title">{$t('commons.earlyAdopter.title')}</h2>
        <p class="commons-early-adopter-lead">{$t('commons.earlyAdopter.lead')}</p>
      </div>
      <button
        type="button"
        class="commons-early-adopter-cta"
        aria-label={$t('commons.earlyAdopter.ctaAria')}
        onclick={focusProfileUsername}
      >
        {$t('commons.earlyAdopter.cta')}
      </button>
    {/if}
  </div>
</section>

<style>
  .commons-early-adopter {
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    background: var(--bg-panel);
    padding: 14px 16px;
  }

  .commons-early-adopter-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
  }

  .commons-early-adopter-copy {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    flex: 1 1 12rem;
  }

  .commons-early-adopter-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .commons-early-adopter-lead {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .commons-early-adopter-claimed {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.9375rem;
    color: var(--text-primary);
    font-weight: 500;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .commons-early-adopter-claimed-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    width: 100%;
    border: none;
    background: transparent;
    padding: 0;
    cursor: pointer;
    text-align: left;
  }

  .commons-early-adopter-claimed-btn:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
    border-radius: 4px;
  }

  .commons-early-adopter-verified {
    color: var(--success);
    font-size: 0.875rem;
    font-family: inherit;
  }

  .commons-early-adopter-cta {
    flex: 0 0 auto;
    border: none;
    border-radius: 8px;
    padding: 8px 14px;
    background: var(--brand);
    color: var(--on-brand);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
  }

  .commons-early-adopter-cta:hover {
    filter: brightness(1.05);
  }

  .commons-early-adopter-cta:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }
</style>
