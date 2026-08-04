<script lang="ts">
  import { t } from 'svelte-i18n';
  import { currentUser } from '../../stores/auth';
  import { profiles } from '../../stores/profiles';
  import type { MlsStoreResetGroupState } from '../../lib/api/nostr';
  import { getProfileDisplayName } from '../../lib/utils/profile';

  let { state }: { state: MlsStoreResetGroupState } = $props();
  const currentUserNpub = $derived($currentUser?.npub ?? '');

  function adminName(npub: string): string {
    return getProfileDisplayName($profiles[npub]) || $t('messaging.channel.mlsResetUnknownAdmin');
  }
</script>

<section class="mls-reset-notice" role="status" aria-live="polite" data-testid="mls-reset-notice">
  <h3>{$t('messaging.channel.mlsResetTitle')}</h3>
  {#if state.admin_npubs.length >= 2}
    <p>{$t('messaging.channel.mlsResetMultipleAdmins')}</p>
    <ul aria-label={$t('messaging.channel.mlsResetAdminListLabel')}>
      {#each state.admin_npubs as npub (npub)}
        <li>
          <span>{adminName(npub)}</span>
          <code>{npub}</code>
        </li>
      {/each}
    </ul>
  {:else if state.single_admin && state.admin_npubs.length === 1}
    {@const admin = state.admin_npubs[0]}
    {#if admin === currentUserNpub}
      <p>{$t('messaging.channel.mlsResetSingleAdminSelf')}</p>
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
  .mls-reset-notice {
    margin: 0.75rem;
    padding: 1rem 1.1rem;
    border: 1px solid color-mix(in srgb, var(--accent, #7c6df2) 45%, transparent);
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--surface-2, #24242c) 90%, var(--accent, #7c6df2));
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
</style>
