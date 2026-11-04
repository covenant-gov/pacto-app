<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
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
  import { confirmKeyedLinkWarning, needsKeyedLinkWarning } from '../../lib/docs/keyed-link-warning';

  interface Props {
    userNpub: string;
    /** Called after a successful publish (e.g. close modal). */
    onPublished?: () => void;
    publishing?: boolean;
  }

  let { userNpub, onPublished = () => {}, publishing = $bindable(false) }: Props = $props();

  let tags: string[] = $state([]);
  let message = $state('');
  let durationHours: CommonsBroadcastDurationHours = $state(24);
  let submitError = $state('');
  let loadingActive = $state(true);
  let activeBroadcast: CommonsBroadcastLocalState | null = $state(null);
  let cooldownLabel = $state('');
  let keyedLinkWarningOpen = $state(false);
  let cooldownTimer: ReturnType<typeof setInterval> | null = null;

  const tFn = get(t);

  const onCooldown = $derived(!!activeBroadcast);
  const canSubmit = $derived(
    !onCooldown &&
    message.trim().length > 0 &&
    tags.length >= 1 &&
    !publishing
  );

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

  function confirmKeyedLink() {
    confirmKeyedLinkWarning();
    keyedLinkWarningOpen = false;
    void handleSubmit(true);
  }

  async function handleSubmit(keyedLinkConfirmed = false) {
    submitError = '';
    if (!canSubmit || !userNpub) return;
    const text = message.trim();
    if (!keyedLinkConfirmed && needsKeyedLinkWarning(text)) {
      keyedLinkWarningOpen = true;
      return;
    }
    publishing = true;
    try {
      const result = await publishUserCommonsBroadcast({
        npub: userNpub,
        message: text,
        durationHours,
        tags,
      });
      if (!result.ok) {
        submitError = result.error;
        return;
      }
      showToast(tFn('commons.broadcast.publishToast'));
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

<form class="user-broadcast-panel" onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
  <span class="broadcast-label">{$t('commons.broadcast.tagsLabelPersonal')}</span>
  <CommonsTagPicker bind:selected={tags} disabled={onCooldown || publishing} />

  {#if loadingActive}
    <p class="broadcast-muted">{$t('commons.broadcast.checkingActive')}</p>
  {:else if onCooldown && activeBroadcast}
    <p class="broadcast-cooldown" role="status">
      {$t('commons.broadcast.cooldownStatus', { values: { cooldownLabel } })}
    </p>
    <p class="broadcast-muted broadcast-cooldown-detail">
      “{activeBroadcast.message}” · {formatCommonsBroadcastDuration(activeBroadcast.durationHours)}
      {#if activeBroadcast.audience}
        · {activeBroadcast.audience === 'new_user' ? $t('commons.broadcast.audienceNew') : $t('commons.broadcast.audienceActive')}
      {/if}
    </p>
  {/if}

  <label class="broadcast-label" for="user-commons-broadcast-message">{$t('commons.broadcast.messageLabel')}</label>
  <textarea
    id="user-commons-broadcast-message"
    class="broadcast-textarea"
    rows="4"
    placeholder={$t('commons.broadcast.personalPlaceholder')}
    bind:value={message}
    disabled={onCooldown || publishing || keyedLinkWarningOpen}
    required
  ></textarea>

  <span class="broadcast-label">{$t('commons.broadcast.durationLabel')}</span>
  <div class="broadcast-duration" role="radiogroup" aria-label={$t('commons.broadcast.durationAriaLabel')}>
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
            <span>{$t(opt.label, { values: { hours: opt.hours } })}</span>
          </label>
        {/each}
      </div>
    {/each}
  </div>

  {#if submitError}
    <p class="broadcast-error" role="alert">{submitError}</p>
  {/if}

  {#if keyedLinkWarningOpen}
    <div class="broadcast-keyed-warning" role="alertdialog" aria-labelledby="user-commons-keyed-title" aria-describedby="user-commons-keyed-body">
      <p id="user-commons-keyed-title" class="broadcast-keyed-title">{$t('commons.broadcast.keyedLinkTitle')}</p>
      <p id="user-commons-keyed-body" class="broadcast-keyed-body">{$t('commons.broadcast.keyedLinkBody')}</p>
      <div class="broadcast-actions">
        <button type="button" class="broadcast-btn-cancel" onclick={() => (keyedLinkWarningOpen = false)}>{$t('commons.broadcast.cancel')}</button>
        <button type="button" class="broadcast-btn-submit" onclick={confirmKeyedLink}>{$t('commons.broadcast.keyedLinkConfirm')}</button>
      </div>
    </div>
  {:else}
    <div class="broadcast-actions">
      <button type="submit" class="broadcast-btn-submit" disabled={!canSubmit}>
        {publishing ? $t('commons.broadcast.publishing') : onCooldown ? $t('commons.broadcast.onCooldown') : $t('commons.broadcast.broadcast')}
      </button>
    </div>
  {/if}
</form>

<style>
  .user-broadcast-panel {
    margin: 0;
  }

  .broadcast-keyed-warning {
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: var(--bg-panel);
    padding: 12px 14px;
    margin-top: 8px;
  }

  .broadcast-keyed-title {
    margin: 0 0 6px;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .broadcast-keyed-body {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.45;
  }

  .broadcast-btn-cancel {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 0.875rem;
    cursor: pointer;
    background: transparent;
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
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
    border-color: var(--brand);
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
    background: var(--brand);
    border: none;
    color: var(--on-brand);
  }

  .broadcast-btn-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
