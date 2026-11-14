<script lang="ts">
  import { currentUser } from '../../stores/auth-session';
  import { activeView } from '../../stores/app';
  import { t } from 'svelte-i18n';
  import SettingsPage from './SettingsPage.svelte';
  import NostrSettingsSection from './NostrSettingsSection.svelte';
  import AppSettingsSection from './AppSettingsSection.svelte';
  import NotificationsSection from './NotificationsSection.svelte';
  import HiddenCommonsSection from './HiddenCommonsSection.svelte';
  import ExperimentalSection from './ExperimentalSection.svelte';
  import BackupSection from './BackupSection.svelte';
  import DangerZoneSection from './DangerZoneSection.svelte';
  import SettingsCollapsibleSection from './SettingsCollapsibleSection.svelte';
  import SettingsEvmSection from './SettingsEvmSection.svelte';

  function goBack() {
    $activeView = 'hub';
  }

  let userNpub = $derived($currentUser?.npub || '');
</script>

<div class="account-settings">
  <SettingsPage onBack={goBack}>
    {#if userNpub}
      <NostrSettingsSection />

      <SettingsCollapsibleSection
        sectionId="settings-evm"
        title={$t('settings.evmSettingsTitle')}
        sectionClass="settings-section--evm"
      >
        <SettingsEvmSection />
      </SettingsCollapsibleSection>

      <AppSettingsSection />
      <NotificationsSection />
      <HiddenCommonsSection />
      <ExperimentalSection />
      <BackupSection />
    {/if}

    <DangerZoneSection />
  </SettingsPage>
</div>

<style>
  .account-settings {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: var(--bg-panel);
    height: 100%;
    min-height: 0;
    overflow: hidden;
    border-left: 1px solid var(--border-subtle);
  }
</style>
