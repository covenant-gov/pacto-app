<script lang="ts">
  import { t } from 'svelte-i18n';
  import { currentUser } from '../../stores/auth';
  import { profiles } from '../../stores/profiles';
  import type { MlsStoreResetGroupState } from '../../lib/api/nostr';
  import { getProfileDisplayName } from '../../lib/utils/profile';
  import { requestSquadRecreate } from '../../stores/squad-recreate';

  let { state, squadName = '', formerMemberNpubs = [] }: {
    state: MlsStoreResetGroupState;
    squadName?: string;
    /** Preserved roster for sole-admin recreate (self filtered out on click). */
    formerMemberNpubs?: string[];
  } = $props();
  const currentUserNpub = $derived($currentUser?.npub ?? '');

  function recreateSquad(): void {
    const memberNpubs = formerMemberNpubs.filter((npub) => npub && npub !== currentUserNpub);
    requestSquadRecreate({ name: squadName, memberNpubs });
  }

  function adminName(npub: string): string {
    return getProfileDisplayName($profiles[npub]) || $t('messaging.channel.mlsResetUnknownAdmin');
  }
</script>

<section class="mls-reset-notice" role="status" aria-live="polite" data-testid="mls-reset-notice">
  <h3>{$t('messaging.channel.mlsResetTitle')}</h3>
  {#if state.adminNpubs.length >= 2}
    <p>{$t('messaging.channel.mlsResetMultipleAdmins')}</p>
    <ul aria-label={$t('messaging.channel.mlsResetAdminListLabel')}>
      {#each state.adminNpubs as npub (npub)}
        <li>
          <span>{adminName(npub)}</span>
          <code>{npub}</code>
        </li>
      {/each}
    </ul>
    <p class="rollout-note">{$t('messaging.channel.mlsResetRolloutNote')}</p>
  {:else if state.singleAdmin && state.adminNpubs.length === 1}
    {@const admin = state.adminNpubs[0]}
    {#if admin === currentUserNpub}
      <p>{$t('messaging.channel.mlsResetSingleAdminSelf')}</p>
      <button type="button" class="recreate-button" onclick={recreateSquad}>
        {$t('messaging.channel.mlsResetRecreateButton')}
      </button>
    {:else}
      <p>{$t('messaging.channel.mlsResetSingleAdminOther')}</p>
      <div class="single-admin">
        <span>{adminName(admin)}</span>
        <code>{admin}</code>
      </div>
    {/if}
  {:else}
    <p>{$t('messaging.channel.mlsResetNoAdminRecord')}</p>
  {/if}
  <p class="archive-note">{$t('messaging.channel.mlsResetArchiveNote')}</p>
</section>

<style>
  .recreate-button {
    margin-top: 0.4rem;
    padding: 0.5rem 0.9rem;
    border: none;
    border-radius: 0.5rem;
    background: var(--brand, #7c6df2);
    color: var(--on-brand);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  .mls-reset-notice {
    margin: 0.75rem;
    padding: 1rem 1.1rem;
    border: 1px solid color-mix(in srgb, var(--brand, #7c6df2) 45%, transparent);
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--surface-2, #24242c) 90%, var(--brand, #7c6df2));
    color: var(--text-primary, #f5f5f7);
  }

  h3 {
    margin: 0 0 0.5rem;
    font-size: 1rem;
  }

  p {
    margin: 0.4rem 0;
    line-height: 1.45;
  }

  ul {
    display: grid;
    gap: 0.45rem;
    margin: 0.75rem 0;
    padding: 0;
    list-style: none;
  }

  li,
  .single-admin {
    display: grid;
    gap: 0.15rem;
  }

  code {
    overflow-wrap: anywhere;
    color: var(--text-secondary, #b8b8c2);
    font-size: 0.75rem;
  }

  .archive-note {
    color: var(--text-secondary, #b8b8c2);
    font-size: 0.85rem;
  }

  .rollout-note {
    color: var(--text-secondary, #b8b8c2);
    font-size: 0.85rem;
  }
</style>
