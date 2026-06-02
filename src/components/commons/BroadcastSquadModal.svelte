<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import { showToast } from '../../stores/toast';
  import type { CommonsBroadcastLocalState } from '../../lib/commons/types';
  import type { PublicSquadBroadcastTarget } from '../../lib/commons/squad-create-broadcast';
  import {
    fetchActiveSquadCommonsBroadcast,
    formatBroadcastCooldownRemaining,
    publishSquadCommonsBroadcast,
  } from '../../lib/commons/squad-broadcast';
  import { canBroadcastSquad } from '../../lib/commons/permissions';
  import { currentUser } from '../../stores/auth';

  export let squad: PublicSquadBroadcastTarget;
  export let onClose: () => void;
  export let broadcastAllowed = true;
  export let broadcastDeniedReason = 'Role required soon.';

  type DurationHours = 24 | 48 | 72;

  let message = '';
  let durationHours: DurationHours = 24;
  let submitError = '';
  let publishing = false;
  let loadingActive = true;
  let activeBroadcast: CommonsBroadcastLocalState | null = null;
  let cooldownLabel = '';
  let cooldownTimer: ReturnType<typeof setInterval> | null = null;

  $: tags = squad.commonsTags ?? [];
  $: onCooldown = !!activeBroadcast;
  $: roleAllowed =
    broadcastAllowed &&
    canBroadcastSquad({ userNpub: $currentUser?.npub, squad });
  $: canSubmit =
    roleAllowed && !onCooldown && message.trim().length > 0 && tags.length > 0 && !publishing;

  function updateCooldownLabel() {
    if (!activeBroadcast) {
      cooldownLabel = '';
      return;
    }
    cooldownLabel = formatBroadcastCooldownRemaining(activeBroadcast.expiresAt);
    if (!cooldownLabel) {
      activeBroadcast = null;
    }
  }

  async function loadActiveBroadcast() {
    loadingActive = true;
    submitError = '';
    try {
      activeBroadcast = await fetchActiveSquadCommonsBroadcast(squad.id);
      updateCooldownLabel();
    } finally {
      loadingActive = false;
    }
  }

  function startCooldownTimer() {
    if (cooldownTimer) clearInterval(cooldownTimer);
    cooldownTimer = setInterval(updateCooldownLabel, 30_000);
  }

  onMount(() => {
    void loadActiveBroadcast();
    startCooldownTimer();
  });

  onDestroy(() => {
    if (cooldownTimer) clearInterval(cooldownTimer);
  });

  async function handleSubmit() {
    submitError = '';
    if (!canSubmit || publishing) return;
    if (!roleAllowed) {
      submitError = broadcastDeniedReason;
      return;
    }
    publishing = true;
    try {
      const result = await publishSquadCommonsBroadcast(squad, {
        message: message.trim(),
        durationHours,
      });
      if (!result.ok) {
        submitError = result.error;
        return;
      }
      showToast(`Broadcast published for ${squad.name}.`);
      onClose();
    } finally {
      publishing = false;
    }
  }
</script>

<Modal
  titleId="broadcast-squad-title"
  descriptionId="broadcast-squad-description"
  onClose={onClose}
  dismissible={!publishing}
>
  <h2 id="broadcast-squad-title">Broadcast squad</h2>
  <p id="broadcast-squad-description" class="broadcast-modal-lead">
    Publish a public message for <strong>{squad.name}</strong> in Commons.
  </p>
  {#if !roleAllowed}
    <p class="broadcast-role-denied" role="status">{broadcastDeniedReason}</p>
  {/if}
  <form on:submit|preventDefault={handleSubmit}>
    <span class="broadcast-label">Tags</span>
    {#if tags.length > 0}
      <ul class="broadcast-tag-list" role="list">
        {#each tags as tag (tag)}
          <li><span class="broadcast-tag-chip">#{tag}</span></li>
        {/each}
      </ul>
    {:else}
      <p class="broadcast-muted">No tags on this squad.</p>
    {/if}

    {#if loadingActive}
      <p class="broadcast-muted">Checking active broadcast…</p>
    {:else if onCooldown && activeBroadcast}
      <p class="broadcast-cooldown" role="status">
        Active until broadcast expires ({cooldownLabel} remaining).
      </p>
      <p class="broadcast-muted broadcast-cooldown-detail">
        “{activeBroadcast.message}” · {activeBroadcast.durationHours} h
      </p>
    {/if}

    <label class="broadcast-label" for="broadcast-squad-message">Message</label>
    <textarea
      id="broadcast-squad-message"
      class="broadcast-textarea"
      rows="4"
      placeholder="What should people know before they request to join?"
      bind:value={message}
      disabled={onCooldown || publishing}
      required
    ></textarea>

    <span class="broadcast-label">Duration</span>
    <div class="broadcast-duration-row" role="radiogroup" aria-label="Broadcast duration">
      {#each [24, 48, 72] as hours (hours)}
        <label class="broadcast-duration-option">
          <input
            type="radio"
            name="squad-broadcast-duration"
            value={hours}
            bind:group={durationHours}
            disabled={onCooldown || publishing}
          />
          <span>{hours} h</span>
        </label>
      {/each}
    </div>

    {#if submitError}
      <p class="broadcast-error" role="alert">{submitError}</p>
    {/if}

    <div class="broadcast-actions">
      <button type="button" class="broadcast-btn-cancel" on:click={onClose} disabled={publishing}>Cancel</button>
      <button type="submit" class="broadcast-btn-submit" disabled={!canSubmit}>
        {publishing ? 'Publishing…' : onCooldown ? 'On cooldown' : 'Broadcast'}
      </button>
    </div>
  </form>
</Modal>

<style>
  .broadcast-modal-lead {
    color: var(--text-muted);
    font-size: 0.9375rem;
    margin: 0 0 20px;
    line-height: 1.45;
  }

  .broadcast-label {
    display: block;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-secondary);
    margin-bottom: 6px;
  }

  .broadcast-textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-size: 0.9375rem;
    margin-bottom: 12px;
    resize: vertical;
    min-height: 96px;
  }

  .broadcast-textarea:disabled {
    opacity: 0.6;
  }

  .broadcast-tag-list {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .broadcast-tag-chip {
    font-size: 0.8125rem;
    padding: 4px 8px;
    border-radius: 999px;
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
  }

  .broadcast-muted {
    color: var(--text-muted);
    font-size: 0.8125rem;
    margin: 0 0 12px;
  }

  .broadcast-cooldown {
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin: 0 0 4px;
  }

  .broadcast-role-denied {
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin: 0 0 12px;
  }

  .broadcast-cooldown-detail {
    margin-bottom: 16px;
  }

  .broadcast-duration-row {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
  }

  .broadcast-duration-option {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 10px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    font-size: 0.875rem;
    cursor: pointer;
    color: var(--text-secondary);
  }

  .broadcast-duration-option:has(input:checked) {
    border-color: var(--accent);
    color: var(--text-primary);
    background: var(--bg-panel);
  }

  .broadcast-duration-option:has(input:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .broadcast-error {
    color: var(--danger, #e55);
    font-size: 0.8125rem;
    margin: 0 0 12px;
  }

  .broadcast-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 8px;
  }

  .broadcast-btn-cancel,
  .broadcast-btn-submit {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 0.875rem;
    cursor: pointer;
  }

  .broadcast-btn-cancel {
    background: transparent;
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
  }

  .broadcast-btn-submit {
    background: var(--accent);
    border: none;
    color: var(--accent-contrast, #fff);
  }

  .broadcast-btn-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
