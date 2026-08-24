<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { CatchUpEntry } from '../../lib/api/catch-up';
  import { resolveOneCatchUpEntry } from '../../stores/catch-up';
  import { resolveCatchUpTarget, navigateToTarget } from '../../lib/navigation/open-squad-dashboard';
  import { squads } from '../../stores/squads';
  import { profiles } from '../../stores/profiles';
  import { getProfileDisplayName } from '../../lib/utils/profile';
  import { showToast } from '../../stores/toast';
  import { backendDmMessages, activeDmTab } from '../../stores/dm';
  import { activeTopNavTab, activeView } from '../../stores/navigation';
  import { findWelcomeInviteSource } from '../../lib/invites/find-invite-source';
  import { pendingMlsWelcomes } from '../../stores/mls-chat';
  import { resolveWelcomeEntry } from './resolve-welcome-entry';
  import { SETTINGS_CHANNEL_ID, SETTINGS_CHANNEL_NAME } from '../../lib/squad/hub-channel-names';
  import { sameMlsGroupId } from '../../lib/invites/accept-invite';
  import { acceptOfferedWelcome, offeredWelcomeFromPendingMls } from '../../lib/invites/pending-welcomes';

  let { entry }: { entry: CatchUpEntry } = $props();

  /**
   * `welcome` entries reference an MLS group the member hasn't joined yet,
   * so it never appears in `$squads` — `resolveCatchUpTarget` alone would
   * leave these permanently unopenable. Route them to the DM invite when
   * the invite DM is locally cached, else to DMs -> Requests where the
   * entry's own pending welcome renders a join card (the DM cache only
   * loads one message per chat at startup, so this fallback is common).
   */
  let welcomeSource = $derived(
    entry.kind === 'welcome' ? findWelcomeInviteSource(entry.chatId, $backendDmMessages) : null
  );
  let resolvedWelcome = $derived(
    entry.kind === 'welcome'
      ? resolveWelcomeEntry(entry.chatId, welcomeSource, $pendingMlsWelcomes, $t('notifications.catchup.welcomeUnavailable'))
      : null
  );
  let target = $derived(
    entry.kind === 'welcome' ? (resolvedWelcome?.target ?? null) : resolveCatchUpTarget(entry, $squads)
  );

  /** Where this entry opens: a squad/channel name, or a DM peer's display name. */
  let locationLabel = $derived.by(() => {
    if (entry.kind === 'welcome') return resolvedWelcome?.locationLabel ?? '';
    if (!target || target.kind === 'dm-requests') return '';
    if (target.kind === 'dm') {
      return getProfileDisplayName($profiles[target.npub]);
    }
    const squad = $squads.find((s) => s.id === target.squadId);
    if (target.kind === 'squad-dashboard') return squad?.name ?? '';
    if (target.kind === 'squad-channel' && target.channelId === SETTINGS_CHANNEL_ID) {
      return squad ? `${squad.name} · #${SETTINGS_CHANNEL_NAME}` : '';
    }
    const channel = squad?.channels.find((c) => c.groupId === target.channelId);
    return squad ? `${squad.name} · #${channel?.name ?? ''}` : '';
  });

  let resolving = $state(false);
  let accepting = $state(false);

  let matchingWelcome = $derived(
    entry.kind === 'welcome'
      ? $pendingMlsWelcomes.find((w) => sameMlsGroupId(w.nostr_group_id, entry.chatId))
      : undefined
  );

  function open() {
    if (!target) return;
    if (target.kind === 'dm-requests') {
      activeTopNavTab.set('dms');
      activeDmTab.set('requests');
      activeView.set('hub');
      return;
    }
    navigateToTarget(target);
  }

  async function resolve() {
    if (resolving) return;
    resolving = true;
    try {
      await resolveOneCatchUpEntry(entry.sourceEventId);
    } catch (e) {
      showToast(e instanceof Error ? e.message : $t('notifications.catchup.resolveError'));
    } finally {
      resolving = false;
    }
  }

  async function accept() {
    if (accepting) return;
    if (!matchingWelcome) {
      open();
      return;
    }
    accepting = true;
    try {
      await acceptOfferedWelcome(offeredWelcomeFromPendingMls(matchingWelcome));
      await resolve();
    } catch (e) {
      showToast(e instanceof Error ? e.message : $t('messaging.inviteCard.acceptFailed'));
    } finally {
      accepting = false;
    }
  }
</script>

<li class="catch-up-entry">
  {#if entry.kind === 'welcome'}
    <button
      type="button"
      class="catch-up-entry-accept"
      onclick={accept}
      disabled={accepting}
    >
      {accepting ? $t('messaging.inviteCard.accepting') : $t('messaging.inviteCard.accept')}
    </button>
  {/if}
  <button type="button" class="catch-up-entry-open" onclick={open} disabled={!target}>
    <span class="catch-up-entry-kind catch-up-entry-kind-{entry.kind}">
      {$t(`notifications.catchup.entryKind.${entry.kind}`)}
    </span>
    <span class="catch-up-entry-location">{locationLabel || '…'}</span>
  </button>
  <button
    type="button"
    class="catch-up-entry-resolve"
    aria-label={$t('notifications.catchup.resolveAria')}
    title={$t('notifications.catchup.resolveAria')}
    onclick={resolve}
    disabled={resolving}
  >
    ✕
  </button>
</li>

<style>
  .catch-up-entry {
    display: flex;
    align-items: stretch;
    gap: 4px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .catch-up-entry-open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: none;
    background: none;
    text-align: left;
    cursor: pointer;
  }

  .catch-up-entry-open:hover {
    background: var(--bg-hover);
  }

  .catch-up-entry-open:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .catch-up-entry-kind {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.6875rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .catch-up-entry-kind-action_prompt {
    color: var(--brand);
    border-color: var(--brand);
  }

  .catch-up-entry-location {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  .catch-up-entry-accept {
    flex-shrink: 0;
    margin: 8px 0 8px 8px;
    padding: 4px 10px;
    border: none;
    border-radius: 8px;
    background: var(--brand);
    color: var(--on-brand);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
  }

  .catch-up-entry-accept:hover:not(:disabled) {
    filter: brightness(1.05);
  }

  .catch-up-entry-accept:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .catch-up-entry-resolve {
    flex-shrink: 0;
    width: 36px;
    border: none;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.875rem;
  }

  .catch-up-entry-resolve:hover:not(:disabled) {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .catch-up-entry-resolve:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
