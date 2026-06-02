<script lang="ts">
  import { currentUser } from '../../stores/auth';
  import { activeView } from '../../stores/app';
  import SettingsPage from '../settings/SettingsPage.svelte';
  import ProfileSection from '../settings/ProfileSection.svelte';
  import NostrSettingsSection from '../settings/NostrSettingsSection.svelte';
  import AppSettingsSection from '../settings/AppSettingsSection.svelte';
  import DangerZoneSection from '../settings/DangerZoneSection.svelte';
  import WalletView from '../wallet/WalletView.svelte';
  import SettingsCollapsibleSection from '../settings/SettingsCollapsibleSection.svelte';

  function goBack() {
    $activeView = 'hub';
  }

  $: userNpub = $currentUser?.npub || '';
</script>

<div class="profile-view">
  <SettingsPage onBack={goBack}>
    <ProfileSection />

    {#if userNpub}
      <NostrSettingsSection />

      <SettingsCollapsibleSection
        sectionId="settings-evm"
        title="EVM settings"
        sectionClass="settings-section--evm"
      >
        <WalletView embeddedInSettings />
      </SettingsCollapsibleSection>

      <AppSettingsSection />
    {/if}

    <DangerZoneSection />
  </SettingsPage>
</div>

<style>
  .profile-view {
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
