<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import RefreshIconButton from '../../ui/RefreshIconButton.svelte';
  import GovMemberPicker from '../governance/GovMemberPicker.svelte';
  import {
    getSquadAdminRoleCatalog,
    getSquadCapabilities,
    squadAdminCreateRole,
    squadAdminDisableExecutor,
    squadAdminEnableExecutor,
    squadAdminEnableFullPermission,
  } from '../../../lib/governance/api';
  import {
    gateSquadAdminWrite,
    resolveGovernancePrivilege,
    type GovernancePrivilege,
  } from '../../../lib/governance/governance-privilege';
  import {
    FLAG_BROADCAST,
    FLAG_CREATE_CHANNEL,
    FLAG_FIRST_MATE,
    FLAG_INVITE_ACCEPT,
    FLAG_MANAGE_NETWORK,
    PRIVILEGE_FLAG_CHIPS,
    PRIVILEGE_ROLE_NAME_MAX_BYTES,
    describePrivilegeCatalogRole,
    encodePrivilegeRoleId,
  } from '../../../lib/governance/privilege-role-id';
  import { runOnChainInBackground } from '../../../lib/evm/on-chain-background';
  import { showToast } from '../../../stores/toast';
  import { shortEvmAddress } from '../../../lib/governance/hats-tree-annotations';
  import type { SupportedChainId } from '../../../lib/wallet/chains';

  let {
    parentId = '',
    squadAdminProxy = '',
    network = 'sepolia' as SupportedChainId,
    warGameStack = false,
    memberEvmOptions = [],
    onPrivilegesChanged = () => {},
  }: {
    parentId?: string;
    squadAdminProxy?: string;
    network?: SupportedChainId;
    warGameStack?: boolean;
    memberEvmOptions?: { address: string; label: string }[];
    onPrivilegesChanged?: () => void;
  } = $props();

  const tFn = get(t);

  let privilege = $state<GovernancePrivilege | null>(null);
  let catalogIds = $state<string[]>([]);
  let catalogLoading = $state(false);
  let catalogError = $state('');
  let actionError = $state('');

  let roleName = $state('');
  let flagInvite = $state(false);
  let flagChannel = $state(false);
  let flagBroadcast = $state(false);
  let flagNetwork = $state(false);
  let flagFirstMate = $state(false);

  let selectedRoleId = $state('');
  let executorAddress = $state('');
  let grantFullPermission = $state(false);

  const proxy = $derived(squadAdminProxy.trim());
  const canManageSurface = $derived(!!proxy && !!parentId.trim());
  const saGate = $derived(
    privilege ? gateSquadAdminWrite(privilege) : ({ enabled: false, reason: 'governance.status.loading' } as const),
  );
  const writesEnabled = $derived(saGate.enabled);
  const isCaptain = $derived(privilege?.wearsCaptain === true);

  const builderFlags = $derived(
    (flagInvite ? FLAG_INVITE_ACCEPT : 0) |
      (flagChannel ? FLAG_CREATE_CHANNEL : 0) |
      (flagBroadcast ? FLAG_BROADCAST : 0) |
      (flagNetwork ? FLAG_MANAGE_NETWORK : 0) |
      (flagFirstMate ? FLAG_FIRST_MATE : 0),
  );

  const previewRoleId = $derived.by(() => {
    try {
      return encodePrivilegeRoleId({ name: roleName.trim(), flags: builderFlags });
    } catch {
      return '';
    }
  });

  const previewDecoded = $derived(
    previewRoleId ? describePrivilegeCatalogRole(previewRoleId) : null,
  );

  const catalogRows = $derived(catalogIds.map((id) => describePrivilegeCatalogRole(id)));

  const selectedRow = $derived(
    selectedRoleId ? describePrivilegeCatalogRole(selectedRoleId) : null,
  );

  $effect(() => {
    if (!canManageSurface) return;
    void loadAll();
  });

  async function loadAll() {
    await Promise.all([loadPrivilege(), loadCatalog()]);
  }

  async function loadPrivilege() {
    const pid = parentId.trim();
    if (!pid) {
      privilege = null;
      return;
    }
    try {
      const snap = await getSquadCapabilities(pid, network, { wargame: warGameStack });
      privilege = resolveGovernancePrivilege({
        myAddress: snap.rosterAddress,
        safeAddress: null,
        captainWearers: [],
        crewWearers: [],
        capabilities: snap,
      });
    } catch {
      privilege = null;
    }
  }

  async function loadCatalog() {
    if (!proxy) {
      catalogIds = [];
      return;
    }
    catalogLoading = true;
    catalogError = '';
    try {
      const res = await getSquadAdminRoleCatalog({
        network,
        squadAdminProxy: proxy,
        parentId,
      });
      catalogIds = res.roles ?? [];
      if (selectedRoleId && !catalogIds.includes(selectedRoleId)) {
        selectedRoleId = catalogIds[0] ?? '';
      } else if (!selectedRoleId && catalogIds.length > 0) {
        selectedRoleId = catalogIds[0];
      }
    } catch (e) {
      catalogError =
        e instanceof Error ? e.message : tFn('governance.privileges.error.loadCatalog');
      catalogIds = [];
    } finally {
      catalogLoading = false;
    }
  }

  function resetBuilder() {
    roleName = '';
    flagInvite = false;
    flagChannel = false;
    flagBroadcast = false;
    flagNetwork = false;
    flagFirstMate = false;
  }

  function runAction(fn: () => Promise<unknown>, successMessage: string) {
    actionError = '';
    runOnChainInBackground({
      startedToast: tFn('governance.squadRoles.toast.submitted'),
      jobLabel: tFn('governance.privileges.sectionTitle'),
      parentId: parentId.trim(),
      job: fn,
      onSuccess: async () => {
        showToast(successMessage);
        resetBuilder();
        await loadCatalog();
        onPrivilegesChanged();
      },
      onError: (message) => {
        actionError = message;
      },
    });
  }

  function createRole() {
    if (!writesEnabled) {
      actionError = saGate.reason;
      return;
    }
    if (!roleName.trim()) {
      actionError = tFn('governance.privileges.error.noName', {
        values: { max: PRIVILEGE_ROLE_NAME_MAX_BYTES },
      });
      return;
    }
    if (flagFirstMate && !isCaptain) {
      actionError = tFn('governance.privileges.error.firstMateCaptainOnly');
      return;
    }
    if (!previewRoleId || !previewDecoded?.ok) {
      actionError = tFn('governance.privileges.error.noName', {
        values: { max: PRIVILEGE_ROLE_NAME_MAX_BYTES },
      });
      return;
    }
    const label = previewDecoded.name;
    runAction(
      () =>
        squadAdminCreateRole({
          network,
          parentId,
          squadAdminProxy: proxy,
          roleId: previewRoleId,
        }),
      tFn('governance.squadRoles.toast.roleCreated', { values: { label } }),
    );
  }

  function enableExecutor() {
    if (!writesEnabled) {
      actionError = saGate.reason;
      return;
    }
    const roleId = selectedRoleId.trim();
    const exec = executorAddress.trim();
    if (!roleId) {
      actionError = tFn('governance.privileges.error.noRoleSelected');
      return;
    }
    if (selectedRow?.hasFirstMate && !isCaptain) {
      actionError = tFn('governance.privileges.error.firstMateCaptainOnly');
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(exec)) {
      actionError = tFn('governance.squadRoles.error.invalidExecutor');
      return;
    }
    const label = selectedRow?.name ?? shortEvmAddress(roleId);
    runAction(
      () =>
        squadAdminEnableExecutor({
          network,
          parentId,
          squadAdminProxy: proxy,
          executorAddress: exec,
          roleId,
        }),
      tFn('governance.squadRoles.toast.executorEnabled', { values: { label } }),
    );
  }

  function disableExecutor() {
    if (!writesEnabled) {
      actionError = saGate.reason;
      return;
    }
    const roleId = selectedRoleId.trim();
    const exec = executorAddress.trim();
    if (!roleId) {
      actionError = tFn('governance.privileges.error.noRoleSelected');
      return;
    }
    if (selectedRow?.hasFirstMate && !isCaptain) {
      actionError = tFn('governance.privileges.error.firstMateCaptainOnly');
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(exec)) {
      actionError = tFn('governance.squadRoles.error.invalidExecutor');
      return;
    }
    const label = selectedRow?.name ?? shortEvmAddress(roleId);
    runAction(
      () =>
        squadAdminDisableExecutor({
          network,
          parentId,
          squadAdminProxy: proxy,
          executorAddress: exec,
          roleId,
        }),
      tFn('governance.privileges.toast.executorDisabled', { values: { label } }),
    );
  }

  function applyFull() {
    if (!writesEnabled) {
      actionError = saGate.reason;
      return;
    }
    const exec = executorAddress.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(exec)) {
      actionError = tFn('governance.squadRoles.error.invalidExecutor');
      return;
    }
    runAction(
      () =>
        squadAdminEnableFullPermission({
          network,
          parentId,
          squadAdminProxy: proxy,
          executorAddress: exec,
          enable: grantFullPermission,
        }),
      grantFullPermission
        ? tFn('governance.squadRoles.toast.fullGranted')
        : tFn('governance.squadRoles.toast.fullRevoked'),
    );
  }

  function flagLabel(key: (typeof PRIVILEGE_FLAG_CHIPS)[number]['key']): string {
    return tFn(`governance.privileges.flag.${key}`);
  }
</script>

{#if canManageSurface}
  <section class="dashboard-section privileges-section" aria-labelledby="crew-privileges-heading">
    <div class="privileges-heading-row">
      <h3 id="crew-privileges-heading" class="section-heading">
        {$t('governance.privileges.sectionTitle')}
      </h3>
      <RefreshIconButton
        spinning={catalogLoading}
        ariaLabel={catalogLoading
          ? $t('governance.privileges.refreshing')
          : $t('governance.privileges.refresh')}
        onclick={() => void loadAll()}
      />
    </div>
    <p class="muted privileges-desc">
      {$t('governance.privileges.description', { values: { proxy: shortEvmAddress(proxy) } })}
    </p>

    {#if !writesEnabled}
      <p class="muted" role="status">
        {$t('governance.privileges.captainOnlyWrites')}
        {#if saGate.reason}
          <span class="gate-reason">{$t(saGate.reason)}</span>
        {/if}
      </p>
    {/if}

    {#if catalogError}
      <p class="input-error" role="alert">{catalogError}</p>
    {/if}

    <div class="privileges-grid">
      <div class="privileges-panel">
        <h4 class="panel-title">{$t('governance.privileges.builderTitle')}</h4>
        {#if catalogIds.length === 0 && !catalogLoading}
          <p class="muted">{$t('governance.privileges.emptyCatalog')}</p>
        {/if}
        <label class="field-label" for="crew-priv-role-name">{$t('governance.privileges.roleName')}</label>
        <input
          id="crew-priv-role-name"
          type="text"
          class="privileges-input"
          maxlength={PRIVILEGE_ROLE_NAME_MAX_BYTES}
          autocomplete="off"
          spellcheck="false"
          placeholder={$t('governance.privileges.roleNamePlaceholder')}
          bind:value={roleName}
          disabled={!writesEnabled}
        />
        <fieldset class="flag-set" disabled={!writesEnabled}>
          <legend class="field-label">{$t('governance.privileges.flagsLegend')}</legend>
          <label class="flag-check">
            <input type="checkbox" bind:checked={flagInvite} />
            {flagLabel('inviteAccept')}
          </label>
          <label class="flag-check">
            <input type="checkbox" bind:checked={flagChannel} />
            {flagLabel('createChannel')}
          </label>
          <label class="flag-check">
            <input type="checkbox" bind:checked={flagBroadcast} />
            {flagLabel('broadcast')}
          </label>
          <label class="flag-check">
            <input type="checkbox" bind:checked={flagNetwork} />
            {flagLabel('manageNetwork')}
          </label>
          {#if isCaptain}
            <label class="flag-check">
              <input type="checkbox" bind:checked={flagFirstMate} />
              {flagLabel('firstMate')}
            </label>
          {/if}
        </fieldset>
        {#if previewDecoded?.ok}
          <p class="preview muted">
            {$t('governance.privileges.preview')}:
            <strong>{previewDecoded.name}</strong>
            ·
            {#each PRIVILEGE_FLAG_CHIPS.filter((c) => (previewDecoded.knownFlags & c.flag) !== 0) as chip (chip.bit)}
              <span class="flag-chip">{flagLabel(chip.key)}</span>
            {:else}
              <span class="flag-chip muted">{$t('governance.privileges.noFlags')}</span>
            {/each}
          </p>
          <code class="role-hex" title={previewRoleId}>{previewRoleId.slice(0, 18)}…</code>
        {/if}
        <button type="button" class="btn-secondary" disabled={!writesEnabled} onclick={createRole}>
          {$t('governance.squadRoles.action.createRole')}
        </button>
      </div>

      <div class="privileges-panel">
        <h4 class="panel-title">{$t('governance.privileges.catalogTitle')}</h4>
        {#if catalogLoading && catalogIds.length === 0}
          <p class="muted">{$t('governance.crew.loading')}</p>
        {:else if catalogRows.length === 0}
          <p class="muted">{$t('governance.privileges.catalogEmpty')}</p>
        {:else}
          <ul class="catalog-list">
            {#each catalogRows as row (row.roleId)}
              <li>
                <button
                  type="button"
                  class="catalog-row"
                  class:selected={row.roleId === selectedRoleId}
                  onclick={() => (selectedRoleId = row.roleId)}
                >
                  <span class="catalog-name">{row.name}</span>
                  {#if !row.ok}
                    <span class="flag-chip warn">{$t('governance.privileges.unknownEncoding')}</span>
                  {:else}
                    {#each PRIVILEGE_FLAG_CHIPS.filter((c) => (row.knownFlags & c.flag) !== 0) as chip (chip.bit)}
                      <span class="flag-chip">{flagLabel(chip.key)}</span>
                    {/each}
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        <GovMemberPicker
          bind:value={executorAddress}
          options={memberEvmOptions}
          labelKey="governance.squadRoles.executorLabel"
          ariaLabelKey="governance.squadRoles.executorLabel"
          emptyKey="governance.gate.noSquadMemberForRole"
          selectId="crew-priv-executor"
          disabled={!writesEnabled}
        />

        <div class="assign-actions">
          <button type="button" class="btn-secondary" disabled={!writesEnabled} onclick={enableExecutor}>
            {$t('governance.privileges.action.assign')}
          </button>
          <button type="button" class="btn-secondary" disabled={!writesEnabled} onclick={disableExecutor}>
            {$t('governance.privileges.action.revoke')}
          </button>
        </div>

        <div class="full-row">
          <label class="flag-check">
            <input type="checkbox" bind:checked={grantFullPermission} disabled={!writesEnabled} />
            {$t('governance.squadRoles.grantFull')}
          </label>
          <button type="button" class="btn-secondary" disabled={!writesEnabled} onclick={applyFull}>
            {$t('governance.squadRoles.action.applyFull')}
          </button>
        </div>
      </div>
    </div>

    {#if actionError}
      <p class="input-error" role="alert">{$t(actionError)}</p>
    {/if}
  </section>
{/if}

<style>
  .dashboard-section {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
  }
  .privileges-heading-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
  }
  .section-heading {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0;
  }
  .privileges-desc {
    margin: 0 0 12px;
  }
  .muted {
    color: var(--text-muted);
    font-size: 0.875rem;
  }
  .gate-reason {
    display: block;
    margin-top: 4px;
  }
  .privileges-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 16px;
  }
  .privileges-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .panel-title {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .field-label {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .privileges-input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-elevated);
    color: var(--text-primary);
    font: inherit;
  }
  .flag-set {
    margin: 0;
    padding: 0;
    border: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .flag-check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .preview {
    margin: 0;
    line-height: 1.4;
  }
  .flag-chip {
    display: inline-block;
    margin: 2px 4px 2px 0;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--bg-hover);
    font-size: 0.6875rem;
    color: var(--text-secondary);
  }
  .flag-chip.warn {
    color: var(--danger, #c44);
  }
  .role-hex {
    font-family: ui-monospace, monospace;
    font-size: 0.7rem;
    color: var(--text-muted);
    word-break: break-all;
  }
  .catalog-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    max-height: 180px;
    overflow: auto;
  }
  .catalog-row {
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    border: none;
    border-bottom: 1px solid var(--border-subtle);
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .catalog-row:last-child {
    border-bottom: none;
  }
  .catalog-row.selected {
    background: var(--bg-hover);
  }
  .catalog-name {
    display: block;
    font-weight: 500;
    margin-bottom: 2px;
  }
  .assign-actions,
  .full-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .input-error {
    color: var(--danger, #c44);
    font-size: 0.8125rem;
    margin: 8px 0 0;
  }
  .btn-secondary {
    padding: 6px 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-elevated);
    color: var(--text-primary);
    font: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
  }
  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
