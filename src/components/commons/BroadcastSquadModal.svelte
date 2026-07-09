<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import { showToast } from '../../stores/toast';
  import type { CommonsBroadcastLocalState } from '../../lib/commons/types';
  import type { PublicSquadBroadcastTarget } from '../../lib/commons/squad-create-broadcast';
  import {
    cancelSquadCommonsBroadcast,
    fetchActiveSquadCommonsBroadcast,
    formatBroadcastCooldownRemaining,
    publishSquadCommonsBroadcast,
  } from '../../lib/commons/squad-broadcast';
  import { canBroadcastSquad } from '../../lib/commons/permissions';
  import {
    COMMONS_BROADCAST_DURATION_ROWS,
    formatCommonsBroadcastDuration,
    type CommonsBroadcastDurationHours,
  } from '../../lib/commons/broadcast-duration';
  import { currentUser } from '../../stores/auth';
  import CommonsTagPicker from './CommonsTagPicker.svelte';

  export let squad: PublicSquadBroadcastTarget;
  export let onClose: () => void;
  export let broadcastAllowed = true;
  export let broadcastDeniedReason = 'Role required soon.';

  let tags: string[] = [];
  let message = '';
  let durationHours: CommonsBroadcastDurationHours = 24;
  let submitError = '';
  let publishing = false;
  let cancelling = false;
  let loadingActive = true;
  let activeBroadcast: CommonsBroadcastLocalState | null = null;
  let cooldownLabel = '';
  let cooldownTimer: ReturnType<typeof setInterval> | null = null;

  $: hasActiveBroadcast = !!activeBroadcast;
  $: roleAllowed =
    broadcastAllowed &&
    canBroadcastSquad({ userNpub: $currentUser?.npub, squad });
  $: canSubmit =
    roleAllowed &&
    !hasActiveBroadcast &&
    message.trim().length > 0 &&
    tags.length === 3 &&
    !publishing &&
    !cancelling;
  $: busy = publishing || cancelling;

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

  async function handleTerminate() {
    submitError = '';
    if (!activeBroadcast || cancelling) return;
    cancelling = true;
    try {
      const result = await cancelSquadCommonsBroadcast(squad.id);
      if (!result.ok) {
        submitError = result.error;
        return;
      }
      activeBroadcast = null;
      cooldownLabel = '';
      showToast('Broadcast terminated. You can publish a new one now.');
    } finally {
      cancelling = false;
    }
  }

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
        tags,
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
  dismissible={!busy}
>
  <h2 id="broadcast-squad-title">Broadcast squad</h2>

  {#if loadingActive}
    <p class="broadcast-muted">Checking active broadcast…</p>
  {:else if hasActiveBroadcast && activeBroadcast}
    <p id="broadcast-squad-description" class="broadcast-modal-lead">
      A broadcast is live for <strong>{squad.name}</strong> in Commons.
    </p>
    <div class="broadcast-live-card" role="status">
      <p class="broadcast-live-duration">
        {formatCommonsBroadcastDuration(activeBroadcast.durationHours)}
        {#if cooldownLabel}
          · {cooldownLabel} remaining
        {/if}
      </p>
      <p class="broadcast-live-message">“{activeBroadcast.message}”</p>
      {#if activeBroadcast.tags.length > 0}
        <ul class="broadcast-live-tags" role="list">
          {#each activeBroadcast.tags as tag (tag)}
            <li>#{tag}</li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if submitError}
      <p class="broadcast-error" role="alert">{submitError}</p>
    {/if}

    <div class="broadcast-actions">
      <button
        type="button"
        class="broadcast-btn-terminate"
        on:click={handleTerminate}
        disabled={busy}
      >
        {cancelling ? 'Terminating…' : 'Terminate'}
      </button>
    </div>
  {:else}
    <p id="broadcast-squad-description" class="broadcast-modal-lead">
      Publish a public message for <strong>{squad.name}</strong> in Commons.
    </p>
    {#if !roleAllowed}
      <p class="broadcast-role-denied" role="status">{broadcastDeniedReason}</p>
    {/if}
    <form on:submit|preventDefault={handleSubmit}>
      <span class="broadcast-label">Tags (exactly 3)</span>
      <CommonsTagPicker
        bind:selected={tags}
        maxTags={3}
        disabled={busy || !roleAllowed}
        placeholder="Search tags…"
      />

      <label class="broadcast-label" for="broadcast-squad-message">Message</label>
      <textarea
        id="broadcast-squad-message"
        class="broadcast-textarea"
        rows="4"
        placeholder="What should people know before they request to join?"
        bind:value={message}
        disabled={busy}
        required
      ></textarea>

      <span class="broadcast-label">Duration</span>
      <div class="broadcast-duration" role="radiogroup" aria-label="Broadcast duration">
        {#each COMMONS_BROADCAST_DURATION_ROWS as row, rowIndex (rowIndex)}
          <div class="broadcast-duration-row">
            {#each row as opt (opt.hours)}
              <label class="broadcast-duration-option">
                <input
                  type="radio"
                  name="squad-broadcast-duration"
                  value={opt.hours}
                  bind:group={durationHours}
                  disabled={busy}
                />
                <span>{opt.label}</span>
              </label>
            {/each}
          </div>
        {/each}
      </div>

      {#if submitError}
        <p class="broadcast-error" role="alert">{submitError}</p>
      {/if}

      <div class="broadcast-actions">
        <button type="button" class="broadcast-btn-cancel" on:click={onClose} disabled={busy}>Cancel</button>
        <button type="submit" class="broadcast-btn-submit" disabled={!canSubmit}>
          {publishing ? 'Publishing…' : 'Broadcast'}
        </button>
      </div>
    </form>
  {/if}
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

  .broadcast-muted {
    color: var(--text-muted);
    font-size: 0.8125rem;
    margin: 0 0 12px;
  }

  .broadcast-live-card {
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: var(--bg-panel);
    padding: 14px 16px;
    margin-bottom: 20px;
  }

  .broadcast-live-duration {
    margin: 0 0 8px;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .broadcast-live-message {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.45;
  }

  .broadcast-live-tags {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .broadcast-live-tags li {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 2px 8px;
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    text-transform: uppercase;
  }

  .broadcast-role-denied {
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin: 0 0 12px;
  }

  .broadcast-duration {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
  }

  .broadcast-duration-row {
    display: flex;
    gap: 8px;
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
  .broadcast-btn-submit,
  .broadcast-btn-terminate {
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

  .broadcast-btn-terminate {
    background: transparent;
    border: 1px solid var(--danger, #e55);
    color: var(--danger, #e55);
  }

  .broadcast-btn-terminate:hover:not(:disabled) {
    background: color-mix(in srgb, var(--danger, #e55) 10%, transparent);
  }

  .broadcast-btn-submit:disabled,
  .broadcast-btn-terminate:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
