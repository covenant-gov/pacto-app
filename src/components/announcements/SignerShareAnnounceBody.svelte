<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { getMlsGroupMembers } from '../../lib/api/nostr';
  import { listSquadMemberEvmInvokeArgs } from '../../lib/squad/squad-member-evm-share';
  import type { SquadMemberEvmSharePayload } from '../../lib/announcements';
  import {
    activeChannelId,
    membershipVersionByGroupId,
    DASHBOARD_CHANNEL_ID,
  } from '../../stores/app';
  import { profiles } from '../../stores/profiles';
  import { getProfileDisplayName } from '../../lib/utils/profile';
  import { formatMessageTimestamp } from '../../lib/utils/message-formatting';

  export let payload: SquadMemberEvmSharePayload;
  export let authorName: string;
  export let authorNpub: string | undefined = undefined;
  export let timestamp: string;

  type EvmRow = { memberNpub: string; evmAddress: string; updatedAtMs: number };

  type RosterRow = {
    npub: string;
    address: string | null;
    isMessageAuthor: boolean;
  };

  let loading = true;
  let loadError = '';
  let rosterRows: RosterRow[] = [];

  function shortAddr(addr: string): string {
    const a = addr.trim();
    if (a.length < 18) return a;
    return a.slice(0, 10) + '…' + a.slice(-8);
  }

  function sortNpubs(memberNpubs: string[]): string[] {
    return [...memberNpubs].sort((a, b) => {
      const na = getProfileDisplayName($profiles[a]) || a;
      const nb = getProfileDisplayName($profiles[b]) || b;
      return na.localeCompare(nb, undefined, { sensitivity: 'base' });
    });
  }

  /** MLS group id for the channel we are viewing; fall back to wire parent_id from the message. */
  function resolveGroupIdForMembers(): string {
    const active = $activeChannelId?.trim() ?? '';
    if (
      active &&
      active !== DASHBOARD_CHANNEL_ID &&
      !active.startsWith('creating-')
    ) {
      return active;
    }
    return payload.parent_id.trim();
  }

  let loadSeq = 0;
  async function loadRoster(): Promise<void> {
    const seq = ++loadSeq;
    const pid = payload.parent_id.trim();
    const ch = $activeChannelId;

    loading = true;
    loadError = '';
    try {
      const q = listSquadMemberEvmInvokeArgs(pid, ch);
      if (!q.parentId) {
        if (seq === loadSeq) rosterRows = [];
        return;
      }

      const evmRows = await invoke<EvmRow[]>('list_squad_member_evm', q);
      if (seq !== loadSeq) return;
      const roster: Record<string, string> = {};
      for (const r of evmRows) roster[r.memberNpub] = r.evmAddress;

      const gid = resolveGroupIdForMembers();
      let memberNpubs: string[] = [];
      try {
        const res = await getMlsGroupMembers(gid);
        memberNpubs = (res.members ?? []) as string[];
      } catch {
        memberNpubs = [];
      }

      if (seq !== loadSeq) return;
      const union = new Set<string>([...memberNpubs, ...Object.keys(roster)]);
      const ordered = sortNpubs([...union]);

      rosterRows = ordered.map((npub) => ({
        npub,
        address: roster[npub]?.trim() || null,
        isMessageAuthor: Boolean(authorNpub && authorNpub === npub),
      }));
    } catch {
      if (seq === loadSeq) {
        loadError = 'Could not load full roster.';
        rosterRows = [];
      }
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  $: rosterMemVer = $activeChannelId
    ? ($membershipVersionByGroupId[$activeChannelId] ?? 0)
    : 0;
  $: payload.parent_id, $activeChannelId, authorNpub, rosterMemVer, void loadRoster();
</script>

<div class="signer-share-body">
  <p class="signer-share-title">Squad signer addresses</p>
  <p class="signer-share-desc">
    {authorName || 'A member'} posted an update. The list below is the signer roster on <em>your</em> device: every
    member in this channel plus any address stored locally for this squad or network. Use the same addresses for
    Safe and treasury flows. Members still show <span class="signer-share-muted">Not shared yet</span> until their client
    posts a share (for example after they join or open Roles).
  </p>

  {#if loading}
    <p class="signer-share-muted">Loading roster…</p>
  {:else if loadError}
    <p class="signer-share-warn" role="alert">{loadError}</p>
    <p class="signer-share-addr">
      <code title={payload.evm_address}>{shortAddr(payload.evm_address)}</code>
      <span class="signer-share-muted"> (this message only)</span>
    </p>
  {:else}
    <ul class="signer-roster" aria-label="Member signer addresses">
      {#each rosterRows as row (row.npub)}
        {@const disp =
          getProfileDisplayName($profiles[row.npub]) ||
          (row.npub.length > 18 ? row.npub.slice(0, 14) + '…' : row.npub)}
        <li class="signer-roster-row" class:signer-roster-row--author={row.isMessageAuthor}>
          <div class="signer-roster-name">
            <span class="signer-roster-display">{disp}</span>
            {#if row.isMessageAuthor}
              <span class="signer-roster-badge">This Signer updated</span>
            {/if}
          </div>
          <div class="signer-roster-addr">
            {#if row.address}
              <code title={row.address}>{shortAddr(row.address)}</code>
            {:else}
              <span class="signer-share-muted">Not shared yet</span>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  <p class="signer-share-meta">
    {#if timestamp}{formatMessageTimestamp(timestamp)}{/if}
  </p>
</div>

<style>
  .signer-share-body {
    flex: 1;
    min-width: 0;
  }

  .signer-share-title {
    margin: 0 0 4px 0;
    font-weight: 600;
    font-size: 0.9375rem;
    color: var(--text-primary);
  }

  .signer-share-desc {
    margin: 0 0 10px 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }

  .signer-share-addr {
    margin: 0 0 6px 0;
    font-size: 0.8125rem;
  }

  .signer-share-addr code {
    font-family: ui-monospace, monospace;
    color: var(--text-primary);
    background: var(--bg-elevated);
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
  }

  .signer-share-meta {
    margin: 10px 0 0 0;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .signer-share-muted {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .signer-share-warn {
    margin: 0 0 8px 0;
    font-size: 0.8125rem;
    color: var(--danger, #c44);
  }

  .signer-roster {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .signer-roster-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    background: var(--bg-elevated);
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
  }

  .signer-roster-row--author {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .signer-roster-name {
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .signer-roster-display {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .signer-roster-badge {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--accent);
  }

  .signer-roster-addr code {
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    color: var(--text-primary);
  }
</style>
