<script lang="ts">
  import { t } from 'svelte-i18n';
  import { shownProfileName } from '../../lib/username/shown-name';
  import { currentUser } from '../../stores/auth-session';
  import { ensurePeerUsername, peerUsernameClaims } from '../../stores/peer-username';
  import { profiles } from '../../stores/profiles';
  import { ensureOwnUsername, heldUsernameFromState, usernameState } from '../../stores/username';

  let { npub = '', fallback = '' }: { npub?: string; fallback?: string } = $props();

  const key = $derived(npub.trim());
  const self = $derived(!!key && key === ($currentUser?.npub ?? ''));
  const chain = $derived.by(() => {
    if (!key) return null;
    if (self) return heldUsernameFromState($usernameState);
    return $peerUsernameClaims[key]?.name ?? null;
  });
  const profile = $derived(key ? ($profiles[key] ?? null) : null);
  const shown = $derived(shownProfileName(profile, chain));
  const label = $derived.by(() => {
    if (shown.verified) return shown.name;
    const unknown = $t('profile.unknownName');
    if (fallback && (!profile || shown.name === unknown)) return fallback;
    return shown.name || fallback;
  });

  $effect(() => {
    if (!key) return;
    if (self) ensureOwnUsername();
    else ensurePeerUsername(key);
  });
</script>

<span class="verified-name">
  {label}
  {#if shown.verified}
    <span class="verified-name-check" title={$t('profile.username.verified')} aria-label={$t('profile.username.verified')}>✓</span>
  {/if}
</span>

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
