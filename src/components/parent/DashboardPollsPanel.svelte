<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  const tFn = get(t);
  import { tick } from 'svelte';
  import CreatePollModal from './CreatePollModal.svelte';
  import {
    dashboardPollReplicaNonceByParentId,
  } from '../../stores/app';
  import {
    listDashboardPolls,
    sendDashboardPollCreate,
    sendDashboardPollVote,
    type DashboardPollDto,
  } from '../../lib/api/nostr';
  import { showToast } from '../../stores/toast';
  import { currentUser } from '../../stores/auth';
  import { copyTextToClipboard } from '../../lib/wallet/clipboard-copy';
  import type { ParentPoll } from '../../lib/parent/parent-polls';
  import { getPollBallotMap, pollReferenceToken, setPollBallot } from '../../lib/parent/parent-polls';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';

  /** Squad/network id (announcements MLS group id). */
  export let parentId: string;
  /** MLS group for poll create/vote rumors (`resolvePollsMlsGroupId` — announcements scope). */
  export let pollsMlsGroupId: string | null;
  /** Dashboard tab vs `#polls` channel chrome. */
  export let variant: 'dashboard' | 'channel' = 'dashboard';
  /** When true in channel variant, fill the parent split pane instead of a fixed max height. */
  export let fillParent = false;

  let showCreatePollModal = false;
  let parentPollsList: ParentPoll[] = [];
  let pollsScrollEl: HTMLDivElement | null = null;
  let pollBallotRefresh = 0;
  let pollVoteSendingPollId: string | null = null;
  let pollVoteSendingOptionId: string | null = null;

  function dashboardPollDtoToParentPoll(d: DashboardPollDto): ParentPoll {
    return {
      id: d.id,
      parentId: d.parent_id,
      title: d.title,
      description: d.description ?? '',
      createdAtMs: d.created_at_ms,
      options: d.options.map((o) => ({
        id: o.id,
        label: o.label,
        votes: Number(o.votes),
      })),
    };
  }

  async function refreshDashboardPollsList(): Promise<void> {
    const pid = parentId?.trim();
    if (!pid) {
      parentPollsList = [];
      return;
    }
    try {
      const rows = await listDashboardPolls(pid);
      parentPollsList = rows.map(dashboardPollDtoToParentPoll);
    } catch {
      parentPollsList = [];
      showToast(tFn('governance.polls.errorLoad'));
    }
  }

  $: viewerNpub = $currentUser?.npub ?? '';

  $: pollReplicaNonceForParent = parentId?.trim()
    ? ($dashboardPollReplicaNonceByParentId[parentId.trim()] ?? 0)
    : 0;

  $: if (parentId?.trim()) {
    void pollReplicaNonceForParent;
    void refreshDashboardPollsList();
  }

  $: pollsFeedScrollKey = `${parentId ?? ''}:${parentPollsList.length}:${parentPollsList.at(-1)?.id ?? ''}`;

  async function scrollPollsFeedToBottom() {
    await tick();
    const el = pollsScrollEl;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }

  $: {
    void pollsFeedScrollKey;
    void scrollPollsFeedToBottom();
  }

  $: pollBallotMap = (() => {
    void pollBallotRefresh;
    if (!viewerNpub || !parentId) return {} as Record<string, string>;
    return getPollBallotMap(viewerNpub, parentId);
  })();

  function openCreatePollModal() {
    if (!viewerNpub?.trim()) {
      showToast(tFn('governance.polls.errorSignInCreate'));
      return;
    }
    if (!parentId?.trim()) {
      showToast(tFn('governance.polls.errorNotReady'));
      return;
    }
    showCreatePollModal = true;
  }

  function closeCreatePollModal() {
    showCreatePollModal = false;
  }

  async function handlePollCreated(poll: ParentPoll) {
    const gid = pollsMlsGroupId?.trim();
    if (!viewerNpub?.trim() || !parentId?.trim()) {
      const msg = tFn('governance.polls.errorSignInCreate');
      showToast(msg);
      throw new Error(msg);
    }
    if (!gid) {
      const msg =
        variant === 'channel'
          ? tFn('governance.polls.errorNoChannel')
          : tFn('governance.polls.errorNoChannelYet');
      showToast(msg);
      throw new Error(msg);
    }
    try {
      await sendDashboardPollCreate({
        mlsGroupId: gid,
        parentId: parentId.trim(),
        pollId: poll.id,
        title: poll.title,
        description: poll.description,
        options: poll.options.map((o) => ({ id: o.id, label: o.label })),
      });
      await refreshDashboardPollsList();
      showToast(tFn('governance.polls.published'));
    } catch (e) {
      const msg = getInvokeErrorMessage(e, tFn('governance.polls.errorPublish'));
      showToast(msg);
      throw new Error(msg, { cause: e });
    }
  }

  async function castPollVote(pollId: string, optionId: string) {
    if (!viewerNpub?.trim() || !parentId?.trim()) {
      showToast(tFn('governance.polls.errorSignInVote'));
      return;
    }
    const gid = pollsMlsGroupId?.trim();
    if (!gid) {
      showToast(tFn('governance.polls.errorNoChannel'));
      return;
    }
    if (pollVoteSendingPollId === pollId) return;
    pollVoteSendingPollId = pollId;
    pollVoteSendingOptionId = optionId;
    try {
      await sendDashboardPollVote({
        mlsGroupId: gid,
        parentId: parentId.trim(),
        pollId,
        optionId,
      });
      setPollBallot(viewerNpub, parentId, pollId, optionId);
      await refreshDashboardPollsList();
      pollBallotRefresh++;
    } finally {
      pollVoteSendingPollId = null;
      pollVoteSendingOptionId = null;
    }
  }

  async function copyPollIdToClipboard(id: string) {
    const ok = await copyTextToClipboard(id);
    showToast(ok ? tFn('governance.polls.copiedId') : tFn('governance.polls.copyFailed'));
  }

  async function copyPollChatReference(id: string) {
    const ok = await copyTextToClipboard(pollReferenceToken(id));
    showToast(ok ? tFn('governance.polls.copiedChatRef') : tFn('governance.polls.copyFailed'));
  }

  $: tallyHint =
    variant === 'channel'
      ? $t('governance.polls.tallyChannelHint')
      : $t('governance.polls.tallyDashboardHint');
</script>

<div
  class="dashboard-polls-shell"
  class:dashboard-polls-shell--channel={variant === 'channel'}
  class:dashboard-polls-shell--channel-fill={variant === 'channel' && fillParent}
>
  <div class="dashboard-polls-scroll" bind:this={pollsScrollEl} role="feed" aria-label={$t('governance.polls.ariaLabel')}>
    <div class="dashboard-polls-scroll-inner">
      {#if !parentId?.trim()}
        <p class="dashboard-placeholder-text muted dashboard-polls-feed-msg">{$t('governance.polls.loading')}</p>
      {:else}
        {#if !viewerNpub?.trim()}
          <p class="dashboard-placeholder-text muted dashboard-polls-feed-msg">
            {$t('governance.polls.signInHint', { values: { tallyHint } })}
          </p>
        {/if}
        {#if parentPollsList.length === 0}
          {#if viewerNpub?.trim()}
            <p class="dashboard-placeholder-text muted dashboard-polls-feed-msg">
              {$t('governance.polls.empty')}
            </p>
          {/if}
        {:else}
          <ul class="dashboard-polls-list" role="list">
            {#each parentPollsList as poll (poll.id)}
              {@const myOpt = pollBallotMap[poll.id]}
              <li class="dashboard-poll-card">
                <div class="dashboard-poll-id-row">
                  <span class="dashboard-poll-id-label">{$t('governance.polls.pollId')}</span>
                  <code class="dashboard-poll-id" title={poll.id}>{poll.id}</code>
                  <div class="dashboard-poll-id-actions">
                    <button
                      type="button"
                      class="btn-link dashboard-poll-copy"
                      onclick={() => copyPollIdToClipboard(poll.id)}
                    >
                      {$t('governance.polls.copyId')}
                    </button>
                    <button
                      type="button"
                      class="btn-link dashboard-poll-copy"
                      onclick={() => copyPollChatReference(poll.id)}
                    >
                      {$t('governance.polls.copyChatRef')}
                    </button>
                  </div>
                </div>
                <h3 class="dashboard-poll-title">{poll.title}</h3>
                {#if poll.description}
                  <p class="dashboard-poll-desc">{poll.description}</p>
                {/if}
                <ul class="dashboard-poll-options" role="list">
                  {#each poll.options as opt (opt.id)}
                    {@const sendingThis =
                      pollVoteSendingPollId === poll.id && pollVoteSendingOptionId === opt.id}
                    <li class="dashboard-poll-option">
                      <span class="dashboard-poll-option-label">{opt.label}</span>
                      <span class="dashboard-poll-option-count">{opt.votes}</span>
                      <button
                        type="button"
                        class="dashboard-poll-vote-btn"
                        class:voted={myOpt === opt.id && !sendingThis}
                        aria-busy={sendingThis}
                        disabled={!viewerNpub?.trim() || pollVoteSendingPollId === poll.id}
                        onclick={() => castPollVote(poll.id, opt.id)}
                      >
                        {#if sendingThis}
                          {$t('governance.polls.voteSending')}
                        {:else if myOpt === opt.id}
                          {$t('governance.polls.voteYour')}
                        {:else if myOpt}
                          {$t('governance.polls.voteChange')}
                        {:else}
                          {$t('governance.polls.vote')}
                        {/if}
                      </button>
                    </li>
                  {/each}
                </ul>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  </div>
  <div class="dashboard-polls-composer">
    <button type="button" class="btn-primary dashboard-polls-create-btn" onclick={openCreatePollModal}>
      {$t('governance.polls.create')}
    </button>
  </div>
</div>

{#if showCreatePollModal && parentId}
  <CreatePollModal
    open={showCreatePollModal}
    parentId={parentId}
    onClose={closeCreatePollModal}
    onCreate={handlePollCreated}
  />
{/if}

<style>
  .dashboard-polls-shell {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    padding: 0 16px 16px;
  }

  .dashboard-polls-shell--channel {
    flex: 0 1 auto;
    max-height: min(42vh, 360px);
    padding: 8px 12px 12px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .dashboard-polls-shell--channel-fill {
    flex: 1;
    min-height: 0;
    max-height: none;
    border-bottom: none;
    padding: 8px 12px 0;
  }

  .dashboard-polls-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    margin-bottom: 12px;
  }

  .dashboard-polls-scroll-inner {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-bottom: 8px;
    box-sizing: border-box;
  }

  .dashboard-polls-shell:not(.dashboard-polls-shell--channel) .dashboard-polls-scroll-inner {
    min-height: 100%;
    justify-content: flex-end;
  }

  .dashboard-polls-feed-msg {
    margin: 0;
    padding: 8px 0;
  }

  .dashboard-polls-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .dashboard-poll-card {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 12px 14px;
    background: var(--bg-elevated);
  }

  .dashboard-poll-id-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .dashboard-poll-id-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
  }

  .dashboard-poll-id {
    font-size: 12px;
    word-break: break-all;
    flex: 1;
    min-width: 120px;
  }

  .dashboard-poll-id-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .dashboard-poll-copy {
    font-size: 12px;
  }

  .dashboard-poll-title {
    margin: 0 0 6px;
    font-size: 16px;
  }

  .dashboard-poll-desc {
    margin: 0 0 10px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .dashboard-poll-options {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .dashboard-poll-option {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  .dashboard-poll-option-label {
    flex: 1;
    min-width: 120px;
  }

  .dashboard-poll-option-count {
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .dashboard-poll-vote-btn {
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-primary);
    cursor: pointer;
    font-size: 12px;
  }

  .dashboard-poll-vote-btn:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .dashboard-poll-vote-btn:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .dashboard-poll-vote-btn.voted {
    border-color: var(--brand);
    color: var(--brand);
  }

  .dashboard-polls-composer {
    flex-shrink: 0;
    padding-top: 4px;
  }

  .dashboard-polls-create-btn {
    width: 100%;
    padding: 10px 16px;
    font-size: 0.9375rem;
  }

  .dashboard-placeholder-text {
    font-size: 13px;
    line-height: 1.45;
  }

  .muted {
    color: var(--text-secondary);
  }
</style>
