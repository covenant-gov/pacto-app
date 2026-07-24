<script lang="ts">
  import { t } from 'svelte-i18n';
  import { isAuthenticated } from '../../stores/auth';
  import {
    backupVerified,
    backupVerificationModalOpen,
  } from '../../stores/backup-verification';

  let dismissed = false;
</script>

{#if $backupVerified === false && $isAuthenticated && !dismissed}
  <div class="backup-banner" role="status">
    <span class="backup-banner-text">
      {$t('backup.banner.unverifiedWarning')}
    </span>
    <div class="backup-banner-actions">
      <button
        type="button"
        class="backup-banner-cta"
        on:click={() => backupVerificationModalOpen.set(true)}
      >
        {$t('backup.banner.cta')}
      </button>
      <button
        type="button"
        class="backup-banner-dismiss"
        aria-label={$t('backup.banner.dismissReminder')}
        title={$t('commons.dismiss')}
        on:click={() => (dismissed = true)}
      >
        ×
      </button>
    </div>
  </div>
{/if}

<style>
  .backup-banner {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px;
    background-color: rgba(250, 166, 26, 0.12);
    border-bottom: 1px solid var(--border-subtle);
    color: var(--warning);
    font-size: 0.875rem;
    line-height: 1.4;
  }

  .backup-banner-text {
    color: var(--text-primary);
  }

  .backup-banner-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .backup-banner-cta {
    padding: 4px 10px;
    border: 1px solid var(--warning);
    border-radius: 6px;
    background: transparent;
    color: var(--warning);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
  }

  .backup-banner-cta:hover {
    background: rgba(250, 166, 26, 0.15);
  }

  .backup-banner-dismiss {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 1.25rem;
    line-height: 1;
    cursor: pointer;
  }

  .backup-banner-dismiss:hover {
    color: var(--text-primary);
  }
</style>
