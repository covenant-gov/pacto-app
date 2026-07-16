<script lang="ts">
  import { onMount } from 'svelte';
  import TreasuryAuthorityModulePanel from './TreasuryAuthorityModulePanel.svelte';
  import MutinyModulePanel from './MutinyModulePanel.svelte';
  import QuartermasterModulePanel from './QuartermasterModulePanel.svelte';
  import TreasurySafeModulePanel from './TreasurySafeModulePanel.svelte';
  import {
    pactoGovModuleDescriptors,
    type PactoGovModuleId,
  } from '../../../lib/governance/governance-provider';
  import {
    resolveGovernancePrivilege,
    type GovernancePrivilege,
  } from '../../../lib/governance/governance-privilege';
  import {
    getSquadCapabilities,
    type SquadCapabilitiesDto,
    type TreasuryProposalDto,
  } from '../../../lib/governance/api';
  import type { PactoGovProviderPayloadV1 } from '../../../lib/governance/pacto-gov-payload';
  import { explorerAddressUrl, parseSupportedChainId } from '../../../lib/wallet/chains';
  import { isTreasuryProposalActive } from '../../../lib/governance/treasury-proposal-ui';
  import { openExternalUrl } from '../../../lib/utils/open-external';

  export let payload: PactoGovProviderPayloadV1;
  export let network: string;
  export let parentId: string;
  export let announcementsGroupId = '';
  export let myAddress = '';
  export let captainWearers: string[] = [];
  export let crewWearers: string[] = [];
  export let treasuryProposals: TreasuryProposalDto[] = [];
  export let treasuryProposalsLoading = false;
  export let treasuryProposalsError = '';
  export let proposalHasVotedById: Record<string, boolean> = {};
  export let onRefreshProposals: () => void = () => {};
  export let onOpenCrew: () => void = () => {};

  let selected: PactoGovModuleId | null = 'treasury_authority';
  let mutinyActive = false;
  let mutinyModeQm = false;
  let mutinyCaptain = '';
  let capabilities: SquadCapabilitiesDto | null = null;
  let capabilitiesLoadKey = '';

  $: openProposalCount = treasuryProposals.filter((p) => isTreasuryProposalActive(p.status)).length;
  $: modules = pactoGovModuleDescriptors(payload, {
    openProposalCount,
    mutinyActive,
    mutinyModeQm,
  });
  $: if (selected && !modules.some((m) => m.id === selected)) {
    selected = modules[0]?.id ?? null;
  }

  $: captainList = (() => {
    const set = new Set(captainWearers.map((a) => a.trim().toLowerCase()).filter(Boolean));
    if (mutinyCaptain.trim()) set.add(mutinyCaptain.trim().toLowerCase());
    return [...set];
  })();

  $: privilege = resolveGovernancePrivilege({
    myAddress,
    safeAddress: payload.safe,
    captainWearers: captainList,
    crewWearers,
    capabilities,
  }) as GovernancePrivilege;

  $: chainId = parseSupportedChainId(network);

  $: if (parentId.trim() && parentId.trim() !== capabilitiesLoadKey) {
    capabilitiesLoadKey = parentId.trim();
    void loadCapabilities(parentId.trim());
  }

  async function loadCapabilities(pid: string) {
    try {
      const snap = await getSquadCapabilities(pid);
      if (pid !== capabilitiesLoadKey) return;
      capabilities = snap;
    } catch {
      if (pid !== capabilitiesLoadKey) return;
      capabilities = null;
    }
  }

  onMount(() => {
    if (parentId.trim()) {
      capabilitiesLoadKey = parentId.trim();
      void loadCapabilities(parentId.trim());
    }
  });

  function shortAddr(addr: string): string {
    const a = addr.trim();
    if (a.length < 14) return a || '—';
    return `${a.slice(0, 8)}…${a.slice(-6)}`;
  }

  function select(id: PactoGovModuleId) {
    selected = selected === id ? null : id;
  }
</script>

<div class="gov-shell">
  <div class="role-chip" role="status">
    You · <strong>{privilege.roleLabel}</strong>
    {#if privilege.myAddress}
      <code class="role-addr">{shortAddr(privilege.myAddress)}</code>
    {/if}
  </div>

  <div class="module-grid" role="list">
    {#each modules as mod (mod.id)}
      <button
        type="button"
        class="module-card"
        class:selected={selected === mod.id}
        role="listitem"
        aria-pressed={selected === mod.id}
        on:click={() => select(mod.id)}
      >
        <span class="module-label">{mod.label}</span>
        {#if mod.address}
          <code class="module-addr">{shortAddr(mod.address)}</code>
        {/if}
        <span class="module-summary muted">{mod.summary}</span>
      </button>
    {/each}
  </div>

  {#if selected}
    {@const active = modules.find((m) => m.id === selected)}
    <section class="module-panel" aria-label={active?.label ?? 'Module'}>
      <div class="module-panel-head">
        <h4 class="module-panel-title">{active?.label}</h4>
        {#if active?.address}
          {@const url = explorerAddressUrl(chainId, active.address)}
          <code class="module-panel-addr" title={active.address}>{active.address}</code>
          {#if url}
            <button type="button" class="btn-link" on:click={() => openExternalUrl(url)}>Explorer</button>
          {/if}
        {/if}
        <button type="button" class="btn-link" on:click={() => (selected = null)}>Close</button>
      </div>

      {#if selected === 'treasury_authority' && payload.treasuryAuthority}
        <TreasuryAuthorityModulePanel
          {network}
          {parentId}
          treasuryAuthority={payload.treasuryAuthority}
          {privilege}
          proposals={treasuryProposals}
          proposalsLoading={treasuryProposalsLoading}
          proposalsError={treasuryProposalsError}
          {proposalHasVotedById}
          onRefresh={onRefreshProposals}
        />
      {:else if selected === 'mutiny' && payload.mutinyModule}
        <MutinyModulePanel
          {network}
          {parentId}
          mutinyModule={payload.mutinyModule}
          {privilege}
          onStatus={(info) => {
            mutinyActive = info.active;
            mutinyCaptain = info.captain;
          }}
        />
      {:else if selected === 'quartermaster' && payload.quartermaster}
        <QuartermasterModulePanel
          {network}
          {parentId}
          quartermaster={payload.quartermaster}
          {privilege}
          onMutinyMode={(active) => {
            mutinyModeQm = active;
          }}
        />
      {:else if selected === 'squad_admin'}
        <p class="muted">
          Squad Admin executor roles are managed under Crew. Captain-gated role writes stay visible there.
        </p>
        <button type="button" class="btn-primary" on:click={onOpenCrew}>Open Crew</button>
      {:else if selected === 'safe' && payload.safe}
        <TreasurySafeModulePanel
          {network}
          {parentId}
          safeAddress={payload.safe}
          {announcementsGroupId}
          {privilege}
        />
        {@const url = explorerAddressUrl(chainId, payload.safe)}
        {#if url}
          <button type="button" class="btn-link" on:click={() => openExternalUrl(url)}>View Safe on explorer</button>
        {/if}
      {/if}
    </section>
  {/if}
</div>

<style>
  .gov-shell {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .role-chip {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }
  .role-addr {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .module-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
    gap: 10px;
  }
  .module-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    text-align: left;
    padding: 12px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    cursor: pointer;
    color: inherit;
  }
  .module-card:hover {
    border-color: var(--text-muted);
  }
  .module-card.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent);
  }
  .module-label {
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--text-primary);
  }
  .module-addr {
    font-size: 0.6875rem;
    color: var(--text-muted);
  }
  .module-summary {
    font-size: 0.75rem;
    line-height: 1.3;
  }
  .module-panel {
    padding: 14px;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: var(--bg-panel);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .module-panel-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px 12px;
  }
  .module-panel-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
  }
  .module-panel-addr {
    flex: 1 1 12rem;
    min-width: 0;
    font-size: 0.75rem;
    word-break: break-all;
    color: var(--text-muted);
  }
  .muted {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  .btn-primary {
    align-self: flex-start;
    padding: 8px 14px;
    border-radius: 6px;
    border: none;
    background: var(--accent);
    color: var(--accent-contrast, #fff);
    font-size: 0.8125rem;
    cursor: pointer;
  }
  .btn-link {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    font-size: 0.8125rem;
    cursor: pointer;
    text-decoration: underline;
  }
</style>
