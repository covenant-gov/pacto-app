<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { invoke } from '@tauri-apps/api/core';
  import Modal from '../ui/Modal.svelte';
  import { getMlsGroupMembers } from '../../lib/api/nostr';
  import { getEvmAddress } from '../../lib/api/auth';
  import type { SupportedChainId } from '../../lib/wallet/chains';
  import {
    safeDeployProxy,
    userFacingDeploySafeMessage,
    parseWalletOpError,
  } from '../../lib/wallet/backend-wallet';
  import { profiles } from '../../stores/profiles';
  import { currentUser } from '../../stores/auth';
  import { getProfileAvatarSrc, getProfileDisplayName } from '../../lib/utils/profile';
  import { DEPLOY_SAFE_MAX_SIGNERS, TREASURY_SAFE_UI_CAP } from '../../lib/treasury/treasury-safes';

  export let parentId: string;
  export let announcementsGroupId: string | null;
  export let parentType: 'squad' | 'network' = 'squad';
  export let treasurySafeCount: number;
  export let onClose: () => void;
  export let onSuccess: (params: {
    safeAddress: string;
    chain: string;
    label: string;
    entryId: string;
    txHash?: string;
  }) => Promise<void>;

  const titleId = 'deploy-safe-title';
  const descId = 'deploy-safe-desc';

  let loading = true;
  let channelMembers: string[] = [];
  type SquadMemberEvmRow = { memberNpub: string; evmAddress: string; updatedAtMs: number };
  let roster: Record<string, string> = {};
  let myEvm: string | null = null;

  let deployNetwork: SupportedChainId = 'sepolia';
  let selectedMemberNpubs: string[] = [];
  let includeMeAsOwner = true;
  let deployLabel = '';
  let thresholdInput = '1';
  let deployError = '';
  let deploySaving = false;

  function shortAddress(addr: string): string {
    if (!addr || addr.length < 12) return addr;
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }

  function rosterEvm(npub: string): string | undefined {
    return roster[npub];
  }

  /** Accepts optional `0x`; must be 20 bytes hex. */
  function normalizeMyWalletAddress(raw: string | null | undefined): string | null {
    if (raw == null) return null;
    const t = raw.trim();
    const hex = t.startsWith('0x') || t.startsWith('0X') ? t.slice(2) : t;
    if (hex.length !== 40 || !/^[a-fA-F0-9]+$/.test(hex)) return null;
    return `0x${hex.toLowerCase()}`;
  }

  function sortedMemberNpubs(members: string[]): string[] {
    return [...members].sort((a, b) => {
      const na = getProfileDisplayName($profiles[a]) || a;
      const nb = getProfileDisplayName($profiles[b]) || b;
      return na.localeCompare(nb, undefined, { sensitivity: 'base' });
    });
  }

  $: sortedMembers = sortedMemberNpubs(channelMembers);
  /** MLS members except you; your wallet is controlled only by "Include me as an owner". */
  $: signersListNpubs = sortedMembers.filter((n) => n !== ($currentUser?.npub ?? ''));

  /**
   * Inline map (no helper fn): Svelte 5 reactive statements may not register deps read inside nested
   * functions, so owner count stayed 0 after async `myEvm` assignment.
   */
  $: ownerAddresses = (() => {
    const m = new Map<string, string>();
    for (const n of selectedMemberNpubs) {
      const a = roster[n];
      if (a) m.set(a.toLowerCase(), a);
    }
    if (includeMeAsOwner && myEvm) {
      m.set(myEvm.toLowerCase(), myEvm);
    }
    return [...m.values()];
  })();
  $: ownerCount = ownerAddresses.length;
  $: thresholdNum = Math.max(1, parseInt(thresholdInput, 10) || 1);
  $: thresholdValid = ownerCount > 0 && thresholdNum >= 1 && thresholdNum <= ownerCount;
  $: ownerOverMax = ownerCount > DEPLOY_SAFE_MAX_SIGNERS;

  function toggleMember(npub: string): void {
    const evm = roster[npub];
    if (!evm) return;
    if (selectedMemberNpubs.includes(npub)) {
      selectedMemberNpubs = selectedMemberNpubs.filter((x) => x !== npub);
      return;
    }
    const would = new Map<string, string>();
    for (const n of selectedMemberNpubs) {
      const a = roster[n];
      if (a) would.set(a.toLowerCase(), a);
    }
    would.set(evm.toLowerCase(), evm);
    if (includeMeAsOwner && myEvm) would.set(myEvm.toLowerCase(), myEvm);
    if (would.size > DEPLOY_SAFE_MAX_SIGNERS) return;
    selectedMemberNpubs = [...selectedMemberNpubs, npub];
  }

  /** Load embedded wallet address alone so roster / MLS failures never leave `myEvm` unset. */
  async function loadMyWalletAddress(): Promise<void> {
    try {
      let raw: string | null = null;
      try {
        raw = await getEvmAddress();
      } catch {
        raw = null;
      }
      if (raw != null && typeof raw !== 'string') {
        raw = String(raw);
      }
      let normalized = normalizeMyWalletAddress(raw);
      if (!normalized) {
        const me = get(currentUser)?.npub;
        if (me) {
          try {
            const prof = (await invoke('get_profile', { npub: me })) as {
              evm_address?: string;
              evmAddress?: string;
            };
            normalized = normalizeMyWalletAddress(
              prof?.evm_address ?? prof?.evmAddress ?? null
            );
          } catch {
            /* profile not in memory cache */
          }
        }
      }
      myEvm = normalized;
      await tick();
    } catch {
      myEvm = null;
      await tick();
    }
  }

  async function loadAll(): Promise<void> {
    loading = true;
    deployError = '';
    await loadMyWalletAddress();

    let r: Record<string, string> = {};
    try {
      if (parentId.trim()) {
        const evmRows = await invoke<SquadMemberEvmRow[]>('list_squad_member_evm', {
          parentId: parentId.trim(),
        });
        for (const row of evmRows) r[row.memberNpub] = row.evmAddress;
      }
    } catch {
      deployError = 'Could not load squad EVM roster. Co-owner checkboxes may stay empty.';
    }

    try {
      if (announcementsGroupId) {
        const result = await getMlsGroupMembers(announcementsGroupId);
        channelMembers = (result.members ?? []) as string[];
      } else {
        channelMembers = [];
      }
    } catch {
      channelMembers = [];
      if (!deployError) deployError = 'Could not load #announcements members.';
    }

    roster = r;
    selectedMemberNpubs = [];
    thresholdInput = '1';
    loading = false;
  }

  onMount(() => {
    loadAll();
  });

  async function confirmDeploy(): Promise<void> {
    if (treasurySafeCount >= TREASURY_SAFE_UI_CAP) {
      deployError = `At most ${TREASURY_SAFE_UI_CAP} Safes are shown per ${parentType}.`;
      return;
    }
    if (!announcementsGroupId) {
      deployError = 'No announcements channel for this group.';
      return;
    }
    if (includeMeAsOwner && !myEvm) {
      deployError =
        'Add a wallet address to your account to include yourself as an owner, or turn off "Include me".';
      return;
    }
    const owners = ownerAddresses;
    if (owners.length === 0) {
      deployError = 'Select at least one signer with a shared squad EVM address, and/or include yourself.';
      return;
    }
    if (owners.length > DEPLOY_SAFE_MAX_SIGNERS) {
      deployError = `This flow supports at most ${DEPLOY_SAFE_MAX_SIGNERS} owners. Deselect signers or turn off "Include me".`;
      return;
    }
    const th = Math.max(1, parseInt(thresholdInput, 10) || 1);
    if (th < 1 || th > owners.length) {
      deployError = `Threshold must be between 1 and ${owners.length}.`;
      return;
    }

    deploySaving = true;
    deployError = '';
    try {
      const out = await safeDeployProxy(deployNetwork, owners, th, null);
      if (!out.ok) {
        const parsed = out.parsed ?? parseWalletOpError(out.message);
        let msg = parsed ? userFacingDeploySafeMessage(parsed) : out.message;
        if (parsed?.txHash) {
          msg = `${msg} Hash: ${parsed.txHash}`;
        }
        deployError = msg;
        return;
      }
      const entryId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `de-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await onSuccess({
        safeAddress: out.result.safeAddress,
        chain: out.result.chain,
        label: deployLabel.trim(),
        entryId,
        txHash: out.result.txHash,
      });
      onClose();
    } catch (e) {
      deployError =
        typeof e === 'string' ? e : e instanceof Error ? e.message : 'Deploy failed.';
    } finally {
      deploySaving = false;
    }
  }
</script>

<Modal
  {titleId}
  descriptionId={descId}
  {onClose}
  dismissible={!deploySaving}
  contentClass="deploy-safe-modal-panel"
>
  <h2 id={titleId}>Deploy Safe</h2>
  <p id={descId} class="deploy-safe-desc">
    Create a new multisig on-chain (#announcements members need a shared EVM address to be signers).
    Gas is paid from your embedded wallet.
  </p>

  {#if loading}
    <p class="deploy-safe-loading">Loading members…</p>
  {:else}
    <label class="modal-field-label" for="deploy-safe-network">Network</label>
    <select id="deploy-safe-network" class="input-select" bind:value={deployNetwork} disabled={deploySaving}>
      <option value="sepolia">Sepolia</option>
      <option value="mainnet">Ethereum</option>
      <option value="optimism">Optimism</option>
    </select>

    <p class="deploy-safe-signers-caption">Other signers (#announcements)</p>
    <p class="deploy-safe-signers-hint muted">
      Co-owners need an EVM address on the squad roster (shared when they join or from Roles). You are not listed; use
      "Include me as an owner" for your wallet. At most {DEPLOY_SAFE_MAX_SIGNERS} owners total.
    </p>
    <ul class="deploy-safe-member-list" role="list">
      {#each signersListNpubs as npub (npub)}
        {@const evm = rosterEvm(npub)}
        {@const disabled = !evm || deploySaving}
        <li class="deploy-safe-member-row" class:disabled-row={!evm}>
          <input
            id={`deploy-m-${npub.slice(0, 12)}`}
            type="checkbox"
            checked={selectedMemberNpubs.includes(npub)}
            {disabled}
            title={!evm ? 'This member has not shared an EVM address with the squad roster.' : undefined}
            aria-label={!evm
              ? 'Unavailable: no roster EVM'
              : `Signer ${getProfileDisplayName($profiles[npub]) || npub.slice(0, 12)}`}
            on:click|preventDefault={() => toggleMember(npub)}
          />
          {#if getProfileAvatarSrc($profiles[npub])}
            <img src={getProfileAvatarSrc($profiles[npub])} alt="" class="deploy-safe-avatar" />
          {:else}
            <div class="deploy-safe-avatar deploy-safe-avatar-ph" aria-hidden="true"></div>
          {/if}
          <div class="deploy-safe-member-meta">
            <span class="deploy-safe-member-name"
              >{getProfileDisplayName($profiles[npub]) ||
                (npub.length > 20 ? npub.slice(0, 14) + '…' : npub)}</span
            >
            <span class="deploy-safe-member-evm muted"
              >{evm ? shortAddress(evm) : 'Not shared'}</span
            >
          </div>
        </li>
      {/each}
    </ul>

    {#if channelMembers.length === 0}
      <p class="muted deploy-safe-empty">No members loaded. Open the dashboard again or check MLS sync.</p>
    {:else if signersListNpubs.length === 0}
      <p class="muted deploy-safe-empty">No other members in this channel. Use "Include me as an owner" for a 1-of-1 Safe,
        or invite others and ensure they share an EVM address to the roster.</p>
    {/if}

    <label class="deploy-safe-checkbox">
      <input
        type="checkbox"
        checked={includeMeAsOwner}
        disabled={deploySaving}
        on:change={(e) => {
          includeMeAsOwner = (e.currentTarget as HTMLInputElement).checked;
          if (includeMeAsOwner && !myEvm) void loadMyWalletAddress();
        }}
      />
      <span>Include me as an owner</span>
    </label>
    {#if includeMeAsOwner && !myEvm}
      <p class="deploy-safe-warn muted">Your account has no wallet address; turn this off or add a wallet.</p>
    {/if}

    <label class="modal-field-label" for="deploy-safe-threshold">Threshold</label>
    <input
      id="deploy-safe-threshold"
      type="number"
      class="input-address"
      min="1"
      max={Math.max(1, ownerCount)}
      bind:value={thresholdInput}
      disabled={deploySaving || ownerCount === 0}
      aria-invalid={ownerCount > 0 && !thresholdValid ? 'true' : undefined}
    />
    <p class="deploy-safe-owner-count muted">{ownerCount} owner(s) — threshold must be ≤ that.</p>
    {#if ownerOverMax}
      <p class="input-error" role="alert">
        At most {DEPLOY_SAFE_MAX_SIGNERS} owners. Deselect members or turn off "Include me".
      </p>
    {/if}

    <label class="modal-field-label" for="deploy-safe-label">Label (optional)</label>
    <input
      id="deploy-safe-label"
      type="text"
      class="input-address"
      placeholder="e.g. Treasury"
      bind:value={deployLabel}
      disabled={deploySaving}
    />

    {#if deployError}
      <p class="input-error" role="alert">{deployError}</p>
    {/if}

    <div class="modal-actions">
      <button type="button" class="btn-secondary" on:click={onClose} disabled={deploySaving}>Cancel</button>
      <button
        type="button"
        class="btn-primary"
        on:click={confirmDeploy}
        disabled={deploySaving || ownerCount === 0 || !thresholdValid || ownerOverMax}
        >{deploySaving ? 'Deploying…' : 'Deploy Safe'}</button
      >
    </div>
  {/if}
</Modal>

<style>
  .deploy-safe-desc {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin: 0 0 16px 0;
    line-height: 1.45;
  }

  .deploy-safe-loading {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .modal-field-label {
    display: block;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    margin: 12px 0 6px 0;
  }

  .input-select,
  .input-address {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  .deploy-safe-signers-caption {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
    margin: 16px 0 4px 0;
  }

  .deploy-safe-signers-hint {
    font-size: 0.75rem;
    margin: 0 0 8px 0;
    line-height: 1.4;
  }

  .muted {
    color: var(--text-muted);
  }

  .deploy-safe-member-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 220px;
    overflow-y: auto;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
  }

  .deploy-safe-member-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 0.8125rem;
  }

  .deploy-safe-member-row:last-child {
    border-bottom: none;
  }

  .deploy-safe-member-row.disabled-row {
    opacity: 0.65;
  }

  .deploy-safe-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .deploy-safe-avatar-ph {
    background: var(--border);
  }

  .deploy-safe-member-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }

  .deploy-safe-member-name {
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deploy-safe-member-evm {
    font-family: ui-monospace, monospace;
    font-size: 0.7rem;
  }

  .deploy-safe-checkbox {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 14px 0 4px 0;
    font-size: 0.875rem;
    color: var(--text-primary);
    cursor: pointer;
  }

  .deploy-safe-warn {
    font-size: 0.8125rem;
    margin: 0 0 8px 0;
  }

  .deploy-safe-owner-count {
    font-size: 0.75rem;
    margin: 4px 0 0 0;
  }

  .deploy-safe-empty {
    font-size: 0.8125rem;
    margin: 8px 0;
  }

  .input-error {
    color: var(--danger, #e85d5d);
    font-size: 0.8125rem;
    margin: 10px 0 0 0;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 20px;
  }

  :global(.deploy-safe-modal-panel) {
    max-width: 520px;
  }
</style>
