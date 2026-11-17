<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { NostrProfile } from '../../lib/api/nostr';
  import { resolveShownName } from '../../lib/username/shown-name';
  import { currentUser } from '../../stores/auth-session';
  import { ensureShownName, peerUsernameClaims } from '../../stores/peer-username';
  import { profiles } from '../../stores/profiles';
  import { usernameState } from '../../stores/username';

  let {
    npub = '',
    profile,
  }: {
    npub?: string;
    /** When passed, overrides the profiles store for kind-0 display data. */
    profile?: NostrProfile | null;
  } = $props();

  const key = $derived(npub.trim());
  const shown = $derived(
    resolveShownName({
      npub: key,
      profile:
        profile !== undefined ? profile : key ? ($profiles[key] ?? null) : null,
      chain: {
        selfNpub: $currentUser?.npub,
        usernameState: $usernameState,
        peerClaims: $peerUsernameClaims,
      },
    }),
  );

  $effect(() => {
    if (key) ensureShownName(key);
  });
</script>

<span class="verified-name"
  >{shown.name}{#if shown.verified}<span
    class="verified-name-check"
    title={$t('profile.username.verified')}
    aria-label={$t('profile.username.verified')}>✓</span
  >{/if}</span
>

<style>
  .verified-name {
    display: inline-flex;
    align-items: baseline;
    gap: 0.25rem;
    min-width: 0;
    max-width: 100%;
  }

  .verified-name-check {
    color: var(--success);
    font-weight: 700;
    flex: none;
  }
</style>
