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
    showToast(ok ? 'Bot npub copied.' : 'Could not copy.');
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

<section class="squad-bot-holders" aria-labelledby="squad-bot-holders-title">
  <h3 id="squad-bot-holders-title" class="section-title">Join inbox / Bot key holders</h3>
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
    <dl class="meta">
      <div>
        <dt>Bot npub</dt>
        <dd>
          <code class="mono">{state.botNpub}</code>
          <button type="button" class="linkish" on:click={copyBotNpub}>Copy</button>
        </dd>
      </div>
      <div>
        <dt>Key epoch</dt>
        <dd>{state.keyEpoch}</dd>
      </div>
      <div>
        <dt>Your device</dt>
        <dd>
          {#if state.hasLocalSecret}
            Holds bot key
          {:else if state.iAmHolder}
            Listed as holder — waiting for key share
          {:else}
            Not a holder
          {/if}
        </dd>
      </div>
    </dl>

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
        <button type="button" class="btn secondary" disabled={acting} on:click={() => void onRotate()}>
          Rotate bot key
        </button>
        <p class="hint">
          Use after removing a holder. Posts a notice in #announcements and shares the new key with
          remaining holders.
        </p>
      </div>
    {/if}
  {/if}
</section>

<style>
  .squad-bot-holders {
    margin: 1.25rem 0 1.75rem;
    padding-top: 0.5rem;
  }
  .section-title {
    margin: 0 0 0.35rem;
    font-size: 1rem;
    font-weight: 600;
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
  .meta {
    display: grid;
    gap: 0.5rem;
    margin: 0 0 1rem;
  }
  .meta dt {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    opacity: 0.7;
  }
  .meta dd {
    margin: 0.15rem 0 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }
  .mono {
    font-size: 0.8rem;
    word-break: break-all;
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
  .btn {
    cursor: pointer;
  }
  .btn:disabled,
  select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
