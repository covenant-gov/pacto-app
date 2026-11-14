<script lang="ts">
  import { t } from 'svelte-i18n';
  import { currentUser } from '../../stores/auth-session';
  import { requireBackupVerified } from '../../stores/backup-verification';
  import SettingsCollapsibleSection from './SettingsCollapsibleSection.svelte';
  import EvmAccountKeyExportModal from './EvmAccountKeyExportModal.svelte';
  import ExportAllSecretsModal from './ExportAllSecretsModal.svelte';

  let userNpub = $derived($currentUser?.npub || '');
  let exportSeedModalOpen = $state(false);
  let exportAllModalOpen = $state(false);
</script>

<SettingsCollapsibleSection sectionId="settings-backup" title={$t('settings.backupTitle')}>
  <p class="backup-lead">{$t('settings.backupLead')}</p>
  <div class="backup-actions">
    <button
      type="button"
      class="btn-export"
      onclick={() => {
        if (requireBackupVerified()) {
          exportSeedModalOpen = true;
        }
      }}
    >
      {$t('profile.exportSeedPhrase')}
    </button>
    <button type="button" class="btn-export" onclick={() => (exportAllModalOpen = true)}>
      {$t('profile.exportAll')}
    </button>
  </div>
</SettingsCollapsibleSection>

<EvmAccountKeyExportModal
  variant="seed"
  open={exportSeedModalOpen}
  npub={userNpub}
  onClose={() => (exportSeedModalOpen = false)}
/>

<ExportAllSecretsModal open={exportAllModalOpen} onClose={() => (exportAllModalOpen = false)} />

<style>
  .backup-lead {
    margin: 0 0 16px;
    color: var(--text-muted);
    font-size: 0.9375rem;
    line-height: 1.5;
  }

  .backup-actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  .btn-export {
    flex: 1;
    min-width: 140px;
    min-height: 48px;
    padding: 0 16px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-hover);
    color: var(--text-primary);
    font-size: 1rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }

  .btn-export:hover {
    border-color: var(--brand);
  }
</style>
