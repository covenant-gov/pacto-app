<script lang="ts">
  import { t } from 'svelte-i18n';
  import { currentUser } from '../../stores/auth-session';
  import { requireBackupVerified } from '../../stores/backup-verification';
  import SettingsCollapsibleSection from './SettingsCollapsibleSection.svelte';
  import EvmAccountKeyExportModal from './EvmAccountKeyExportModal.svelte';
  import ExportAllSecretsModal from './ExportAllSecretsModal.svelte';
  import MoreActionsMenu from '../ui/MoreActionsMenu.svelte';

  let userNpub = $derived($currentUser?.npub || '');
  let exportSeedModalOpen = $state(false);
  let exportAllModalOpen = $state(false);
</script>

<SettingsCollapsibleSection sectionId="settings-backup" title={$t('settings.backupTitle')}>
  <div class="backup-row">
    <span class="backup-row-label">{$t('settings.backupSecretsLabel')}</span>
    <MoreActionsMenu
      ariaLabel={$t('settings.backupActionsMenu')}
      items={[
        {
          id: 'export-seed',
          label: $t('profile.exportSeedPhrase'),
          onSelect: () => {
            if (requireBackupVerified()) {
              exportSeedModalOpen = true;
            }
          },
        },
        {
          id: 'export-all',
          label: $t('profile.exportAll'),
          onSelect: () => {
            exportAllModalOpen = true;
          },
        },
      ]}
    />
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
  .backup-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-panel);
  }

  .backup-row-label {
    min-width: 0;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--text-primary);
  }
</style>
