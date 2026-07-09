<script lang="ts">
  import { onMount } from 'svelte';
  import { currentUser } from '../../../stores/auth';
  import { profiles } from '../../../stores/profiles';
  import { showToast } from '../../../stores/toast';
  import { getProfileDisplayName } from '../../../lib/utils/profile';
  import { copyTextToClipboard } from '../../../lib/wallet/clipboard-copy';
  import {
    addSquadBotHolder,
    canAddBotHolder,
    canManageBotHolders,
    ensureSquadBot,
    getSquadBotState,
    removeSquadBotHolder,
    rotateSquadBotKey,
    type SquadBotState,
  } from '../../../lib/squad/squad-bot';
  import { refreshMlsGroupMembers } from '../../../stores/mls-group-members';

  export let announcementsGroupId: string | null = null;
  export let channelMembers: string[] = [];
  export let squadAdminActive = false;
  export let executorRolesLabel = '';

  let state: SquadBotState | null = null;
  let loading = true;
  let acting = false;
  let addNpub = '';
  let error = '';
  let copiedBotNpub = false;

  $: squadId = announcementsGroupId?.trim() || '';
  $: myNpub = $currentUser?.npub ?? '';
  $: canManage = canManageBotHolders({
    squadAdminActive,
    executorRolesLabel,
    state,
  });
  $: candidates = channelMembers.filter(
    (n) => n && n !== myNpub && !(state?.holders ?? []).includes(n)
  );

  async function reload() {
    if (!squadId) {
      state = null;
      loading = false;
      return;
    }
    loading = true;
    error = '';
    try {
      state = (await getSquadBotState(squadId)) ?? (await ensureSquadBot(squadId));
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not load bot key holders.';
      state = null;
    } finally {
      loading = false;
    }
  }

  let lastLoadedId = '';
  $: if (squadId && squadId !== lastLoadedId) {
    lastLoadedId = squadId;
    void reload();
  }

  onMount(() => {
    if (squadId) void reload();
  });

  function label(npub: string): string {
    return getProfileDisplayName($profiles[npub]) || npub.slice(0, 12) + '…';
  }

  async function copyBotNpub() {
    if (!state?.botNpub) return;
    const ok = await copyTextToClipboard(state.botNpub);
    if (ok) {
      copiedBotNpub = true;
      setTimeout(() => {
        copiedBotNpub = false;
      }, 2000);
    } else {
      showToast('Could not copy.');
    }
  }

  async function onAdd() {
    if (!squadId || !addNpub || acting) return;
    const block = canAddBotHolder(channelMembers, myNpub, addNpub, state?.holders ?? [], {
      squadAdminActive,
      executorRolesLabel,
    });
    if (block) {
      showToast(block);
      return;
    }
    acting = true;
    const result = await addSquadBotHolder(squadId, addNpub);
    acting = false;
    if (!result.ok) {
      showToast(result.error);
      return;
    }
    state = result.state;
    addNpub = '';
    showToast('Bot key holder added.');
  }

  async function onRemove(npub: string) {
    if (!squadId || acting) return;
    acting = true;
    const result = await removeSquadBotHolder(squadId, npub);
    acting = false;
    if (!result.ok) {
      showToast(result.error);
      return;
    }
    state = result.state;
    showToast('Holder removed. Remaining holders should rotate the bot key.');
  }

  async function onRotate() {
    if (!squadId || acting) return;
    acting = true;
    await refreshMlsGroupMembers(squadId).catch(() => {});
    const result = await rotateSquadBotKey(squadId);
    acting = false;
    if (!result.ok) {
      showToast(result.error);
      return;
    }
    state = result.state;
    showToast('Bot key rotated.');
  }
</script>

<section
  id="settings-squad-bot-holders"
  class="dashboard-section squad-bot-holders-section"
  aria-labelledby="squad-bot-holders-title"
>
  <h3 id="squad-bot-holders-title" class="section-heading">Join inbox / Bot key holders</h3>
  <p class="section-lead">
    Commons join requests are DMs to this squad’s bot. Only listed holders keep the bot key on their
    device. {#if squadAdminActive}
      With Squad Admin deployed, only members with <strong>Full</strong> executor scope on their roster
      EVM may add, remove, or rotate holders.
    {:else}
      Until Squad Admin is live, any member who is already a holder may add another current member.
    {/if}
  </p>

  {#if loading}
    <p class="muted" role="status">Loading…</p>
  {:else if error}
    <p class="err" role="alert">{error}</p>
  {:else if !state}
    <p class="muted">Bot not initialized yet.</p>
    <button type="button" class="btn" disabled={acting || !squadId} on:click={() => void reload()}>
      Initialize bot
    </button>
  {:else}
    <div class="bot-details">
      <div class="bot-key-box">
        <span class="bot-key-box-label">Bot npub</span>
        <div class="bot-key-value-row">
          <code class="bot-key-value-full">{state.botNpub}</code>
          <button
            type="button"
            class="bot-key-copy-btn"
            aria-label={copiedBotNpub ? 'Copied' : 'Copy bot npub'}
            title={copiedBotNpub ? 'Copied' : 'Copy'}
            on:click={copyBotNpub}
          >
            <svg
              class="bot-key-copy-icon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        </div>
      </div>

      <div class="bot-meta-grid">
        <div class="bot-key-box bot-key-box-compact">
          <span class="bot-key-box-label">Key epoch</span>
          <span class="bot-key-box-value">{state.keyEpoch}</span>
        </div>
        <div class="bot-key-box bot-key-box-compact">
          <span class="bot-key-box-label">Your device</span>
          <span class="bot-key-box-value">
            {#if state.hasLocalSecret}
              Holds bot key
            {:else if state.iAmHolder}
              Listed as holder — waiting for key share
            {:else}
              Not a holder
            {/if}
          </span>
        </div>
      </div>
    </div>

    <h4 class="subhead">Holders</h4>
    <ul class="holder-list">
      {#each state.holders as npub (npub)}
        <li>
          <span>{label(npub)}</span>
          {#if canManage && state.holders.length > 1}
            <button
              type="button"
              class="linkish danger"
              disabled={acting}
              on:click={() => void onRemove(npub)}
            >
              Remove
            </button>
          {/if}
        </li>
      {/each}
    </ul>

    {#if state.iAmHolder && state.hasLocalSecret && !canManage && squadAdminActive}
      <p class="hint">
        You hold the bot key but need Squad Admin <strong>Full</strong> executor scope on your roster
        EVM to change the holder list.
      </p>
    {/if}

    {#if canManage}
      <div class="add-row">
        <label class="sr-only" for="squad-bot-add-holder">Add holder</label>
        <select id="squad-bot-add-holder" bind:value={addNpub} disabled={acting || candidates.length === 0}>
          <option value="">Add member as holder…</option>
          {#each candidates as npub (npub)}
            <option value={npub}>{label(npub)}</option>
          {/each}
        </select>
        <button type="button" class="btn" disabled={acting || !addNpub} on:click={() => void onAdd()}>
          Add
        </button>
      </div>

      <div class="rotate-row">
        <button
          type="button"
          class="btn-secondary squad-bot-rotate-btn"
          disabled={acting}
          on:click={() => void onRotate()}
        >
          Rotate Bot Key
        </button>
      </div>
    {/if}
  {/if}
</section>

<style>
  .squad-bot-holders-section {
    margin-bottom: 16px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 16px;
  }

  .section-heading {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0 0 12px;
  }

  .section-lead,
  .hint,
  .muted {
    margin: 0 0 0.75rem;
    font-size: 0.875rem;
    opacity: 0.85;
    line-height: 1.4;
  }
  .err {
    color: var(--danger, #c44);
    font-size: 0.875rem;
  }
  .bot-details {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0 0 1rem;
  }
  .bot-key-box {
    padding: 10px 12px;
    background: var(--bg-elevated);
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
  }
  .bot-key-box-label {
    display: block;
    margin-bottom: 8px;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: 0.02em;
  }
  .bot-key-value-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .bot-key-value-full {
    flex: 1;
    min-width: 0;
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    line-height: 1.45;
    word-break: break-all;
    color: var(--text-primary);
  }
  .bot-key-copy-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .bot-key-copy-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }
  .bot-key-copy-icon {
    display: block;
  }
  .bot-meta-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 10px;
  }
  .bot-key-box-compact {
    min-width: 0;
  }
  .bot-key-box-value {
    display: block;
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--text-secondary);
    word-break: break-word;
  }
  .subhead {
    margin: 0 0 0.35rem;
    font-size: 0.9rem;
  }
  .holder-list {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0;
  }
  .holder-list li {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.35rem 0;
    border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  }
  .add-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .add-row select {
    flex: 1 1 12rem;
    min-width: 0;
  }
  .rotate-row {
    margin-top: 0.5rem;
  }
  .btn-secondary {
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 0.875rem;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
    cursor: pointer;
    font-family: inherit;
  }
  .btn-secondary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .squad-bot-rotate-btn {
    margin-top: 0.25rem;
  }
  .btn:disabled,
  select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn {
    cursor: pointer;
  }
  .linkish {
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
  }
  .linkish.danger {
    color: var(--danger, #c44);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
  }
</style>
