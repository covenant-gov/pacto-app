<svelte:options runes={true} />

<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import type { SquadMemberEvmSharePayload } from '../../lib/announcements';
  import { currentUser } from '../../stores/auth';
  import { formatMessageTimestamp } from '../../lib/utils/message-formatting';

  let {
    payload,
    authorName,
    authorNpub = undefined,
    timestamp,
  }: {
    payload: SquadMemberEvmSharePayload;
    authorName: string;
    authorNpub?: string;
    timestamp: string;
  } = $props();

  const tFn = get(t);

  const isMine = $derived(Boolean(authorNpub && $currentUser?.npub && authorNpub === $currentUser.npub));

  const summary = $derived(
    isMine
      ? tFn('announcements.signerShare.mine')
      : tFn('announcements.signerShare.theirs', { values: { authorName: authorName || tFn('announcements.signerShare.aMember') } })
  );

  const evmAddress = $derived(payload.evm_address?.trim() ?? '');

  function shortAddr(addr: string): string {
    const a = addr.trim();
    if (a.length < 18) return a;
    return `${a.slice(0, 10)}…${a.slice(-8)}`;
  }
</script>

<div class="signer-share-body">
  <p class="signer-share-title">{summary}</p>
  {#if evmAddress}
    <div class="signer-share-addr-box">
      <code class="signer-share-addr" title={evmAddress}>{shortAddr(evmAddress)}</code>
    </div>
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
    margin: 0;
    font-weight: 600;
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--text-primary);
  }

  .signer-share-addr-box {
    margin-top: 10px;
    padding: 8px 10px;
    background: var(--bg-elevated);
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
  }

  .signer-share-addr {
    display: block;
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    color: var(--text-primary);
  }

  .signer-share-meta {
    margin: 10px 0 0 0;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
</style>
