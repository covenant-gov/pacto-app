<script lang="ts">
  import type { CommonsJoinRequestPayload } from '../../lib/commons/commons-join-request';

  export let payload: CommonsJoinRequestPayload;
  export let isMine: boolean;
  export let requesterName: string;
</script>

<div class="commons-join-card" role="article">
  <p class="commons-join-badge">Commons join request</p>
  <p class="commons-join-title">{payload.squadName}</p>
  <p class="commons-join-text">
    {#if isMine}
      You requested to join this squad. The broadcaster will respond via DM or squad invite.
    {:else}
      <strong>{requesterName}</strong> requested to join this squad from Commons. Invite them from the squad hub when ready.
    {/if}
  </p>
</div>

<style>
  .commons-join-card {
    margin: 8px 16px;
    padding: 14px 16px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 8px;
    max-width: 520px;
  }

  .commons-join-badge {
    margin: 0 0 6px;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .commons-join-title {
    margin: 0 0 6px;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .commons-join-text {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }
</style>
