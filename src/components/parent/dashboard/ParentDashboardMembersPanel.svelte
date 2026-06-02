<script lang="ts">
  import { getProfileAvatarSrc, getProfileDisplayName } from '../../../lib/utils/profile';
  import { profiles } from '../../../stores/profiles';

  export let open = false;
  export let channelMembers: string[] = [];
  export let loadingMembers = false;
</script>

{#if open}
  <aside class="members-panel" aria-label="Channel members">
    <div class="members-panel-header">
      <h3 class="members-panel-title">Members</h3>
    </div>
    <div class="members-panel-list">
      {#if loadingMembers}
        <p class="members-panel-loading">Loading…</p>
      {:else}
        {#each channelMembers as member (member)}
          {@const npub = member as string}
          {@const avatarSrc = getProfileAvatarSrc($profiles[npub])}
          <div class="members-panel-member">
            {#if avatarSrc}
              <img src={avatarSrc} alt="" class="members-panel-avatar" />
            {:else}
              <div class="members-panel-avatar members-panel-avatar-placeholder" aria-hidden="true"></div>
            {/if}
            <span class="members-panel-name">{getProfileDisplayName($profiles[npub]) || npub.slice(0, 16) + '…'}</span>
          </div>
        {/each}
      {/if}
    </div>
  </aside>
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
    margin: 0 16px;
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .members-panel-member {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 16px;
    font-size: 0.9375rem;
    color: var(--text-secondary);
  }

  .members-panel-member:hover {
    background: var(--bg-hover);
  }

  .members-panel-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .members-panel-avatar-placeholder {
    background: var(--border);
  }

  .members-panel-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
