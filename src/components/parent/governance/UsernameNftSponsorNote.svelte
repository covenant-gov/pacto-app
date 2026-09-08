<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { UsernameNftEligibility } from '../../../lib/governance/username-nft-eligibility';
  import { showUsernameNftSponsorNote } from '../../../lib/governance/username-nft-eligibility';

  let {
    payFrom,
    eligibility,
  }: {
    payFrom: 'default' | 'squad';
    eligibility: UsernameNftEligibility;
  } = $props();

  const visible = $derived(showUsernameNftSponsorNote({ payFrom, eligibility }));
</script>

{#if visible}
  <p class="username-nft-sponsor-note" role="note">
    {$t('governance.usernameNftSponsor.note')}
  </p>
{/if}

<style>
  .username-nft-sponsor-note {
    margin: 8px 0 0;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--brand) 28%, transparent);
    background: color-mix(in srgb, var(--brand) 8%, transparent);
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }
</style>
