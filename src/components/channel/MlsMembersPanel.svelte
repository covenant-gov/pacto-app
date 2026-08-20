<script lang="ts">
  import { t } from 'svelte-i18n';
  import Modal from '../ui/Modal.svelte';
  import { getProfileAvatarSrc, getProfileDisplayName } from '../../lib/utils/profile';
  import { restoreMlsMemberAccess } from '../../lib/parent/restore-mls-access';
  import { showToast } from '../../stores/toast';
  import type { NostrProfile } from '../../stores/profiles';

  let {
    groupId,
    members,
    admins,
    pendingWelcomes = [],
    loading = false,
    currentUserNpub = '',
    profiles = {},
  }: {
    groupId: string;
    members: string[];
    admins: string[];
    pendingWelcomes?: string[];
    loading?: boolean;
    currentUserNpub?: string;
    profiles?: Record<string, NostrProfile | undefined>;
  } = $props();

  const canRestore = $derived(
    !!currentUserNpub && admins.some((a) => a === currentUserNpub),
  );

  let confirmNpub = $state<string | null>(null);
  let restoringNpub = $state<string | null>(null);
  let resendingNpub = $state<string | null>(null);

  function displayName(npub: string): string {
    return getProfileDisplayName(profiles[npub]) || `${npub.slice(0, 16)}…`;
  }

  function openConfirm(npub: string): void {
    confirmNpub = npub;
  }

  function closeConfirm(): void {
    if (restoringNpub) return;
    confirmNpub = null;
  }

  async function confirmRestore(): Promise<void> {
    const npub = confirmNpub;
    if (!npub || !groupId) return;
    restoringNpub = npub;
    const result = await restoreMlsMemberAccess(groupId, npub);
    restoringNpub = null;
    confirmNpub = null;
    if (result.ok) {
      showToast($t('messaging.channel.mlsRestoreSuccess', { values: { name: displayName(npub) } }));
    } else {
      showToast(
        $t('messaging.channel.mlsRestoreError', {
          values: { name: displayName(npub), message: result.error },
        }),
      );
    }
  }

  /** Single-click resend for a never-joined pending-invite member: no confirm modal (low risk, no revocation). */
  async function resendInvite(npub: string): Promise<void> {
    if (!groupId || resendingNpub) return;
    resendingNpub = npub;
    const result = await restoreMlsMemberAccess(groupId, npub);
    resendingNpub = null;
    if (result.ok) {
      showToast($t('messaging.channel.mlsResendInviteSuccess', { values: { name: displayName(npub) } }));
    } else {
      showToast(
        $t('messaging.channel.mlsResendInviteError', {
          values: { name: displayName(npub), message: result.error },
        }),
      );
    }
  }

</script>

<aside class="members-panel" aria-label={$t('messaging.channel.membersTitle')}>
  <div class="members-panel-header">
    <h3 class="members-panel-title">{$t('messaging.channel.membersPanelTitle')}</h3>
  </div>
  <div class="members-panel-list">
    {#if loading && members.length === 0}
      <p class="members-panel-loading">{$t('messaging.channel.membersPanelLoading')}</p>
    {:else}
      {#each members as npub (npub)}
        {@const avatarSrc = getProfileAvatarSrc(profiles[npub])}
        {@const isPending = pendingWelcomes.includes(npub)}
        <div class="members-panel-member">
          {#if avatarSrc}
            <img src={avatarSrc} alt="" class="members-panel-avatar" />
          {:else}
            <div class="members-panel-avatar members-panel-avatar-placeholder" aria-hidden="true"></div>
          {/if}
          <span class="members-panel-name">{displayName(npub)}</span>
          {#if isPending}
            <span class="pending-invite-badge" data-testid="mls-pending-invite-badge">
              {$t('messaging.channel.mlsPendingInviteBadge')}
            </span>
          {/if}
          {#if isPending && canRestore}
            <button
              type="button"
              class="resend-invite"
              data-testid="mls-resend-invite"
              data-member={npub}
              disabled={resendingNpub === npub}
              onclick={() => void resendInvite(npub)}
            >
              {$t('messaging.channel.mlsResendInviteButton')}
            </button>
          {:else if canRestore && npub !== currentUserNpub}
            <button
              type="button"
              class="restore-access"
              data-testid="mls-restore-access"
              data-member={npub}
              disabled={restoringNpub === npub}
              onclick={() => openConfirm(npub)}
            >
              {$t('messaging.channel.mlsRestoreButton')}
            </button>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</aside>

{#if confirmNpub}
  <Modal titleId="mls-restore-confirm-title" onClose={closeConfirm}>
    <h2 id="mls-restore-confirm-title">{$t('messaging.channel.mlsRestoreConfirmTitle')}</h2>
    <p class="restore-explainer">
      {$t('messaging.channel.mlsRestoreConfirmBody', { values: { name: displayName(confirmNpub) } })}
    </p>
    <div class="restore-actions">
      <button type="button" class="restore-cancel" disabled={!!restoringNpub} onclick={closeConfirm}>
        {$t('messaging.channel.cancel')}
      </button>
      <button
        type="button"
        class="restore-confirm"
        data-testid="mls-restore-confirm"
        disabled={!!restoringNpub}
        onclick={() => void confirmRestore()}
      >
        {restoringNpub
          ? $t('messaging.channel.mlsRestoreWorking')
          : $t('messaging.channel.mlsRestoreConfirmAction')}
      </button>
    </div>
  </Modal>
{/if}

<style>
  .members-panel {
    width: 240px;
    min-width: 240px;
    background: var(--bg-elevated);
    border-left: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    height: 100%;
  }

  .members-panel-header {
    height: 48px;
    padding: 0 12px 0 16px;
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .members-panel-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .members-panel-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .members-panel-loading {
    margin: 8px 16px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .members-panel-member {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
  }

  .members-panel-member:hover {
    background: var(--bg-hover, color-mix(in srgb, var(--text-primary) 6%, transparent));
  }

  .members-panel-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .members-panel-avatar-placeholder {
    background: var(--surface-2, #2a2a32);
  }

  .members-panel-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.8125rem;
    color: var(--text-primary);
  }

  .restore-access {
    flex-shrink: 0;
    padding: 0.2rem 0.45rem;
    border: 1px solid color-mix(in srgb, var(--brand, #7c6df2) 50%, transparent);
    border-radius: 0.35rem;
    background: transparent;
    color: var(--brand, #7c6df2);
    font-size: 0.7rem;
    font-weight: 600;
    cursor: pointer;
  }

  .restore-access:hover:not(:disabled) {
    background: color-mix(in srgb, var(--brand, #7c6df2) 12%, transparent);
  }

  .restore-access:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .pending-invite-badge {
    flex-shrink: 0;
    padding: 0.15rem 0.4rem;
    border-radius: 0.35rem;
    background: color-mix(in srgb, var(--text-secondary, #9a9aa5) 16%, transparent);
    color: var(--text-secondary, #9a9aa5);
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .resend-invite {
    flex-shrink: 0;
    padding: 0.2rem 0.45rem;
    border: 1px solid color-mix(in srgb, var(--brand, #7c6df2) 50%, transparent);
    border-radius: 0.35rem;
    background: transparent;
    color: var(--brand, #7c6df2);
    font-size: 0.7rem;
    font-weight: 600;
    cursor: pointer;
  }

  .resend-invite:hover:not(:disabled) {
    background: color-mix(in srgb, var(--brand, #7c6df2) 12%, transparent);
  }

  .resend-invite:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .restore-explainer {
    margin: 0 0 1rem;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .restore-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .restore-cancel,
  .restore-confirm {
    padding: 0.45rem 0.85rem;
    border-radius: 0.4rem;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  .restore-cancel {
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-primary);
  }

  .restore-confirm {
    border: none;
    background: var(--brand, #7c6df2);
    color: var(--on-brand);
  }

  .restore-confirm:disabled,
  .restore-cancel:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
