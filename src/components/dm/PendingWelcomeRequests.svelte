<script lang="ts">
  /**
   * Refusable join cards for pending MLS welcomes, shown above the Requests list.
   *
   * These groups added us over MLS with no `squad_invite` DM, so no invite card
   * will ever render them and the join would otherwise be unreachable. They are
   * not conversations, so they are cards rather than navigable rows.
   */
  import { t } from 'svelte-i18n';
  import { profiles } from '../../stores/profiles';
  import { getProfileDisplayName } from '../../lib/utils/profile';
  import { acceptOfferedWelcome, type OfferedWelcome } from '../../lib/invites/pending-welcomes';
  import {
    declineWelcomeForGroup,
    joiningWelcomeGroupIds,
    offeredWelcomeList,
  } from '../../lib/invites/pending-welcomes-store';
  import { dmError } from '../../lib/utils/dm-debug';

  let failedGroupId = $state<string | null>(null);

  function inviterName(npub: string): string {
    const profile = $profiles[npub];
    if (profile) return getProfileDisplayName(profile);
    return npub.length > 16 ? `${npub.slice(0, 8)}…${npub.slice(-4)}` : npub;
  }

  async function accept(welcome: OfferedWelcome): Promise<void> {
    if ($joiningWelcomeGroupIds.includes(welcome.groupId)) return;
    joiningWelcomeGroupIds.update((ids) => [...ids, welcome.groupId]);
    failedGroupId = null;
    try {
      await acceptOfferedWelcome(welcome);
    } catch (e) {
      // Leaving the card in place is the useful failure: retry is legitimate
      // whether the engine still has the welcome or only local materialization failed.
      dmError('accept pending welcome', e);
      failedGroupId = welcome.groupId;
    } finally {
      joiningWelcomeGroupIds.update((ids) => ids.filter((id) => id !== welcome.groupId));
    }
  }
</script>

{#if $offeredWelcomeList.length > 0}
  <ul class="welcome-list" role="list" aria-label={$t('messaging.pendingWelcome.sectionLabel')}>
    {#each $offeredWelcomeList as welcome (welcome.groupId)}
      {@const joining = $joiningWelcomeGroupIds.includes(welcome.groupId)}
      <li class="welcome-card">
        <div class="welcome-icon">
          {#if welcome.imageUrl}
            <img
              src={welcome.imageUrl}
              alt=""
              class="welcome-icon-img"
              referrerpolicy="no-referrer"
              loading="lazy"
              decoding="async"
            />
          {:else}
            <span class="welcome-icon-placeholder" aria-hidden="true">
              {welcome.name.charAt(0).toUpperCase()}
            </span>
          {/if}
        </div>
        <div class="welcome-body">
          <p class="welcome-badge">{$t('messaging.pendingWelcome.badge')}</p>
          <p class="welcome-title">{welcome.name}</p>
          <p class="welcome-text">
            {$t('messaging.pendingWelcome.addedBy', {
              values: { inviterName: inviterName(welcome.inviterNpub) },
            })}
          </p>
          {#if welcome.description}
            <p class="welcome-description">{welcome.description}</p>
          {/if}
          <p class="welcome-meta">
            {$t('messaging.pendingWelcome.memberCount', {
              values: { count: welcome.memberCount },
            })}
          </p>
          {#if failedGroupId === welcome.groupId}
            <p class="welcome-error" aria-live="polite">
              {$t('messaging.pendingWelcome.joinFailed')}
            </p>
          {/if}
          <div class="welcome-actions">
            <button
              type="button"
              class="welcome-btn welcome-btn-accept"
              disabled={joining}
              onclick={() => void accept(welcome)}
            >
              {joining
                ? $t('messaging.pendingWelcome.joining')
                : $t('messaging.pendingWelcome.join')}
            </button>
            <button
              type="button"
              class="welcome-btn welcome-btn-decline"
              disabled={joining}
              onclick={() => declineWelcomeForGroup(welcome.groupId)}
            >
              {$t('messaging.pendingWelcome.decline')}
            </button>
          </div>
          <p class="welcome-caption">{$t('messaging.pendingWelcome.declineCaption')}</p>
        </div>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .welcome-list {
    list-style: none;
    margin: 0;
    padding: 8px 8px 0 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .welcome-card {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .welcome-icon {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-hover);
  }

  .welcome-icon-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .welcome-icon-placeholder {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .welcome-body {
    flex: 1;
    min-width: 0;
  }

  .welcome-badge {
    margin: 0 0 2px 0;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--brand);
  }

  .welcome-title {
    margin: 0 0 2px 0;
    font-weight: 600;
    font-size: 0.9375rem;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }

  .welcome-text,
  .welcome-description,
  .welcome-meta {
    margin: 0 0 4px 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .welcome-description {
    overflow-wrap: anywhere;
  }

  .welcome-meta {
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  .welcome-error {
    margin: 0 0 6px 0;
    font-size: 0.75rem;
    color: var(--danger);
    line-height: 1.4;
  }

  .welcome-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .welcome-btn {
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
  }

  .welcome-btn-accept {
    background: var(--brand);
    color: var(--on-brand);
  }

  .welcome-btn-decline {
    background: var(--bg-elevated);
    color: var(--text-secondary);
    border-color: var(--border-subtle);
  }

  .welcome-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .welcome-caption {
    margin: 6px 0 0 0;
    font-size: 0.6875rem;
    color: var(--text-muted);
    line-height: 1.4;
  }
</style>
