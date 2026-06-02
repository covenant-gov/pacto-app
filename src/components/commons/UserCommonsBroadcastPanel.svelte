<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { showToast } from '../../stores/toast';
  import CommonsTagPicker from './CommonsTagPicker.svelte';
  import {
    fetchActiveUserCommonsBroadcast,
    publishUserCommonsBroadcast,
  } from '../../lib/commons/user-broadcast';
  import { formatBroadcastCooldownRemaining } from '../../lib/commons/squad-broadcast';
  import {
    COMMONS_BROADCAST_DURATION_ROWS,
    formatCommonsBroadcastDuration,
    type CommonsBroadcastDurationHours,
  } from '../../lib/commons/broadcast-duration';
  import type { CommonsBroadcastLocalState } from '../../lib/commons/types';
  import { commonsUserHasActiveBroadcast } from '../../stores/commons-ui';

  export let userNpub: string;
  /** Called after a successful publish (e.g. close modal). */
  export let onPublished: () => void = () => {};

  let tags: string[] = [];
  let message = '';
  let durationHours: CommonsBroadcastDurationHours = 24;
  let submitError = '';
  export let publishing = false;
  let loadingActive = true;
  let activeBroadcast: CommonsBroadcastLocalState | null = null;
  let cooldownLabel = '';
  let cooldownTimer: ReturnType<typeof setInterval> | null = null;

  $: onCooldown = !!activeBroadcast;
  $: canSubmit =
    !onCooldown &&
    message.trim().length > 0 &&
    tags.length >= 1 &&
    !publishing;

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
    if (!userNpub) return;
    loadingActive = true;
    try {
      activeBroadcast = await fetchActiveUserCommonsBroadcast(userNpub);
      updateCooldownLabel();
    } finally {
      loadingActive = false;
    }
  }

  onMount(() => {
    void loadActiveBroadcast();
    cooldownTimer = setInterval(updateCooldownLabel, 30_000);
  });

  onDestroy(() => {
    if (cooldownTimer) clearInterval(cooldownTimer);
  });

  async function handleSubmit() {
    submitError = '';
    if (!canSubmit || !userNpub) return;
    publishing = true;
    try {
      const result = await publishUserCommonsBroadcast({
        npub: userNpub,
        message: message.trim(),
        durationHours,
        tags,
      });
      if (!result.ok) {
        submitError = result.error;
        return;
      }
      showToast('Broadcast published to Commons.');
      message = '';
      tags = [];
      commonsUserHasActiveBroadcast.set(true);
      await loadActiveBroadcast();
      onPublished();
    } finally {
      publishing = false;
    }
  }
</script>

<form class="user-broadcast-panel" on:submit|preventDefault={handleSubmit}>
  <span class="broadcast-label">Tags (1–3)</span>
  <CommonsTagPicker bind:selected={tags} maxTags={3} disabled={onCooldown || publishing} />

  {#if loadingActive}
    <p class="broadcast-muted">Checking active broadcast…</p>
  {:else if onCooldown && activeBroadcast}
    <p class="broadcast-cooldown" role="status">
      Active until broadcast expires ({cooldownLabel} remaining).
    </p>
    <p class="broadcast-muted broadcast-cooldown-detail">
      “{activeBroadcast.message}” · {formatCommonsBroadcastDuration(activeBroadcast.durationHours)}
      {#if activeBroadcast.audience}
        · {activeBroadcast.audience === 'new_user' ? 'New user' : 'Active user'}
      {/if}
    </p>
  {/if}

  <label class="broadcast-label" for="user-commons-broadcast-message">Message</label>
  <textarea
    id="user-commons-broadcast-message"
    class="broadcast-textarea"
    rows="4"
    placeholder="What should people know before they message you?"
    bind:value={message}
    disabled={onCooldown || publishing}
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
              name="user-commons-duration"
              value={opt.hours}
              bind:group={durationHours}
              disabled={onCooldown || publishing}
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
    <button type="submit" class="broadcast-btn-submit" disabled={!canSubmit}>
      {publishing ? 'Publishing…' : onCooldown ? 'On cooldown' : 'Broadcast'}
    </button>
  </div>
</form>

<style>
  .user-broadcast-panel {
    margin: 0;
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

  .broadcast-cooldown {
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin: 0 0 4px;
  }

  .broadcast-cooldown-detail {
    margin-bottom: 16px;
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

  .broadcast-error {
    color: var(--danger, #e55);
    font-size: 0.8125rem;
    margin: 0 0 12px;
  }

  .broadcast-actions {
    display: flex;
    justify-content: flex-start;
    margin-top: 8px;
  }

  .broadcast-btn-submit {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 0.875rem;
    cursor: pointer;
    background: var(--accent);
    border: none;
    color: var(--accent-contrast, #fff);
  }

  .broadcast-btn-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
