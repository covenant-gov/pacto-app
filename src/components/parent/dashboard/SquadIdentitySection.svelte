<script lang="ts">
  import { t } from 'svelte-i18n';
  import DashboardAssetCard from './DashboardAssetCard.svelte';
  import AvatarPicker from '../../ui/AvatarPicker.svelte';
  import SquadAvatar from '../../squad/SquadAvatar.svelte';
  import { persistSquadPatch } from '../../../lib/squad/squad-catalog';
  import { publishSquadIdentityUpdated } from '../../../lib/squad/squad-identity-announce';
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { showToast } from '../../../stores/toast';
  import type { Squad } from '../../../stores/squads';

  let { squad }: { squad: Squad } = $props();

  let saving = $state(false);
  let saveError = $state<string | null>(null);

  async function saveIcon(url: string | null) {
    if (saving) return;
    saving = true;
    saveError = null;
    try {
      const patched = await persistSquadPatch(squad.id, (row) => ({
        ...row,
        iconUrl: url?.trim() || undefined,
      }));
      if (patched) {
        const published = await publishSquadIdentityUpdated(patched);
        if (!published) {
          const msg = $t('squad.pfp.publishError');
          saveError = msg;
          showToast(msg);
        }
      }
    } catch (e) {
      const msg = getInvokeErrorMessage(e, $t('squad.pfp.saveError'));
      saveError = msg;
      showToast(msg);
    } finally {
      saving = false;
    }
  }
</script>

<DashboardAssetCard headingId="squad-identity-heading" heading={$t('squad.pfp.sectionTitle')}>
  <AvatarPicker
    src={squad.iconUrl ?? null}
    editable
    allowClear={!!squad.iconUrl}
    disabled={saving}
    size={72}
    chooseTitle={$t('squad.pfp.choose')}
    editAriaLabel={$t('squad.pfp.change')}
    cropTitle={$t('squad.pfp.cropTitle')}
    onChange={(url) => void saveIcon(url)}
    onClear={() => void saveIcon(null)}
  >
    {#snippet fallback()}
      <SquadAvatar src={null} name={squad.name} seed={squad.id || squad.name} fill />
    {/snippet}
  </AvatarPicker>
  {#if saveError}
    <p class="squad-identity-error" role="alert">{saveError}</p>
  {/if}
</DashboardAssetCard>

<style>
  .squad-identity-error {
    margin: 8px 0 0;
    font-size: 0.8125rem;
    color: var(--danger);
  }
</style>
