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
  .backup-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .btn-export {
    min-height: 40px;
    padding: 0 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-hover);
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }

  .btn-export:hover {
    border-color: var(--brand);
  }

  .btn-export:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }
</style>
