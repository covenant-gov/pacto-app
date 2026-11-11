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
    PRIVILEGE_FLAG_CHIPS,
    PRIVILEGE_ROLE_NAME_MAX_BYTES,
    describePrivilegeCatalogRole,
    encodePrivilegeRoleId,
    packPrivilegeFlags,
  } from '../../../lib/governance/privilege-role-id';
  import { runGovWriteInBackground } from '../../../lib/governance/gov-write-background';
  import { bumpSquadPrivilegeNonce } from '../../../stores/squad-privilege-refresh';
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
  let flagEvent = $state(false);
  let flagDoc = $state(false);
  /** Exclusive right-pane mode: create role vs assign members. */
  let paneMode = $state<'create' | 'assign'>('assign');

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
  const isCreate = $derived(paneMode === 'create');

  const builderFlags = $derived(
    packPrivilegeFlags({
      inviteAccept: flagInvite,
      createChannel: flagChannel,
      broadcast: flagBroadcast,
      manageNetwork: flagNetwork,
      firstMate: flagFirstMate,
      createEvent: flagEvent,
      addDoc: flagDoc,
    }),
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

  const selectedFlagChips = $derived(
    PRIVILEGE_FLAG_CHIPS.filter((chip) => ((selectedRow?.knownFlags ?? 0) & chip.flag) !== 0),
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
      if (catalogIds.length === 0) {
        paneMode = 'create';
        selectedRoleId = '';
      } else if (paneMode === 'assign') {
        if (!selectedRoleId || !catalogIds.includes(selectedRoleId)) {
          selectedRoleId = catalogIds[0] ?? '';
        }
      }
    } catch (e) {
      catalogError =
        e instanceof Error ? e.message : tFn('governance.privileges.error.loadCatalog');
      catalogIds = [];
      paneMode = 'create';
      selectedRoleId = '';
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
    flagEvent = false;
    flagDoc = false;
  }

  function startCreate() {
    paneMode = 'create';
    selectedRoleId = '';
    resetBuilder();
  }

  function selectRole(roleId: string) {
    paneMode = 'assign';
    selectedRoleId = roleId;
  }

  function setDraftFlag(
    flag: 'invite' | 'channel' | 'broadcast' | 'network' | 'firstMate' | 'event' | 'doc',
    on: boolean,
  ) {
    if (!isCreate) return;
    if (flag === 'invite') flagInvite = on;
    else if (flag === 'channel') flagChannel = on;
    else if (flag === 'broadcast') flagBroadcast = on;
    else if (flag === 'network') flagNetwork = on;
    else if (flag === 'firstMate') flagFirstMate = on;
    else if (flag === 'event') flagEvent = on;
    else flagDoc = on;
  }

  function runAction(
    job: () => Promise<unknown>,
    label: string,
    actionKey: string,
    afterSuccess?: () => void | Promise<void>,
  ) {
    actionError = '';
    runGovWriteInBackground({
      label,
      parentId: parentId.trim(),
      actionKey,
      job,
      onSettled: async () => {
        if (afterSuccess) {
          await afterSuccess();
        } else {
          await loadCatalog();
        }
        bumpSquadPrivilegeNonce(parentId);
        onPrivilegesChanged();
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
    const createdRoleId = previewRoleId;
    runAction(
      () =>
        squadAdminCreateRole({
          network,
          parentId,
          squadAdminProxy: proxy,
          roleId: createdRoleId,
        }),
      tFn('governance.squadRoles.action.createRole'),
      'squad-admin-create-role',
      async () => {
        resetBuilder();
        selectedRoleId = createdRoleId;
        paneMode = 'assign';
        await loadCatalog();
      },
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
    runAction(
      () =>
        squadAdminEnableExecutor({
          network,
          parentId,
          squadAdminProxy: proxy,
          executorAddress: exec,
          roleId,
        }),
      tFn('governance.squadRoles.action.enableExecutor'),
      'squad-admin-enable-executor',
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
    runAction(
      () =>
        squadAdminDisableExecutor({
          network,
          parentId,
          squadAdminProxy: proxy,
          executorAddress: exec,
          roleId,
        }),
      tFn('governance.privileges.action.revoke'),
      'squad-admin-disable-executor',
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
      tFn('governance.squadRoles.action.applyFull'),
      'squad-admin-enable-full',
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

    {#if !writesEnabled}
      <p class="muted" role="status">{$t('governance.privileges.captainOnly')}</p>
    {/if}

    {#if catalogError}
      <p class="input-error" role="alert">{catalogError}</p>
    {/if}

    <div class="privileges-layout">
      <div class="role-list">
        <button
          type="button"
          class="role-row"
          class:selected={isCreate}
          disabled={!writesEnabled}
          onclick={startCreate}
        >
          {$t('governance.privileges.newRole')}
        </button>
        {#if catalogLoading && catalogRows.length === 0}
          <p class="muted">{$t('governance.crew.loading')}</p>
        {:else if catalogRows.length === 0}
          <p class="muted">{$t('governance.privileges.catalogEmpty')}</p>
        {:else}
          {#each catalogRows as row (row.roleId)}
            <button
              type="button"
              class="role-row"
              class:selected={!isCreate && row.roleId === selectedRoleId}
              onclick={() => selectRole(row.roleId)}
            >
              <span class="catalog-name"
                >{row.ok ? row.name : $t('governance.privileges.unknownEncoding')}</span
              >
            </button>
          {/each}
        {/if}
      </div>

      <div class="role-editor">
        {#if isCreate}
          <h4 class="pane-title">{$t('governance.privileges.builderTitle')}</h4>
          {#if catalogRows.length === 0}
            <p class="muted pane-hint">{$t('governance.privileges.emptyCatalog')}</p>
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
            value={roleName}
            disabled={!writesEnabled}
            oninput={(e) => {
              roleName = e.currentTarget.value;
            }}
          />

          <fieldset class="flag-set" disabled={!writesEnabled}>
            <legend class="field-label">{$t('governance.privileges.group.members')}</legend>
            <label class="flag-check">
              <input
                type="checkbox"
                checked={flagInvite}
                onchange={(e) => setDraftFlag('invite', e.currentTarget.checked)}
              />
              {flagLabel('inviteAccept')}
            </label>
            {#if isCaptain}
              <label class="flag-check">
                <input
                  type="checkbox"
                  checked={flagFirstMate}
                  onchange={(e) => setDraftFlag('firstMate', e.currentTarget.checked)}
                />
                {flagLabel('firstMate')}
              </label>
            {/if}
          </fieldset>

          <fieldset class="flag-set" disabled={!writesEnabled}>
            <legend class="field-label">{$t('governance.privileges.group.channels')}</legend>
            <label class="flag-check">
              <input
                type="checkbox"
                checked={flagChannel}
                onchange={(e) => setDraftFlag('channel', e.currentTarget.checked)}
              />
              {flagLabel('createChannel')}
            </label>
          </fieldset>

          <fieldset class="flag-set" disabled={!writesEnabled}>
            <legend class="field-label">{$t('governance.privileges.group.content')}</legend>
            <label class="flag-check">
              <input
                type="checkbox"
                checked={flagEvent}
                onchange={(e) => setDraftFlag('event', e.currentTarget.checked)}
              />
              {flagLabel('createEvent')}
            </label>
            <label class="flag-check">
              <input
                type="checkbox"
                checked={flagDoc}
                onchange={(e) => setDraftFlag('doc', e.currentTarget.checked)}
              />
              {flagLabel('addDoc')}
            </label>
            <label class="flag-check">
              <input
                type="checkbox"
                checked={flagBroadcast}
                onchange={(e) => setDraftFlag('broadcast', e.currentTarget.checked)}
              />
              {flagLabel('broadcast')}
            </label>
          </fieldset>

          <fieldset class="flag-set" disabled={!writesEnabled}>
            <legend class="field-label">{$t('governance.privileges.group.network')}</legend>
            <label class="flag-check">
              <input
                type="checkbox"
                checked={flagNetwork}
                onchange={(e) => setDraftFlag('network', e.currentTarget.checked)}
              />
              {flagLabel('manageNetwork')}
            </label>
          </fieldset>

          <button type="button" class="btn-secondary" disabled={!writesEnabled} onclick={createRole}>
            {$t('governance.squadRoles.action.createRole')}
          </button>
        {:else}
          <h4 class="pane-title">{$t('governance.privileges.catalogTitle')}</h4>

          <div class="role-summary" aria-live="polite">
            <p class="summary-name">
              {selectedRow?.ok
                ? selectedRow.name
                : $t('governance.privileges.unknownEncoding')}
            </p>
            {#if selectedFlagChips.length === 0}
              <p class="muted">{$t('governance.privileges.noFlags')}</p>
            {:else}
              <ul class="flag-chips">
                {#each selectedFlagChips as chip (chip.key)}
                  <li class="flag-chip">{flagLabel(chip.key)}</li>
                {/each}
              </ul>
            {/if}
          </div>

          <GovMemberPicker
            bind:value={executorAddress}
            options={memberEvmOptions}
            labelKey="governance.squadRoles.executorLabel"
            ariaLabelKey="governance.squadRoles.executorLabel"
            emptyKey="governance.gate.noSquadMemberForRole"
            selectId="crew-priv-executor"
            disabled={!writesEnabled || !selectedRoleId}
          />
          <div class="assign-actions">
            <button
              type="button"
              class="btn-secondary"
              disabled={!writesEnabled || !selectedRoleId}
              onclick={enableExecutor}
            >
              {$t('governance.privileges.action.assign')}
            </button>
            <button
              type="button"
              class="btn-secondary"
              disabled={!writesEnabled || !selectedRoleId}
              onclick={disableExecutor}
            >
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
        {/if}
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
    margin-bottom: 8px;
  }
  .section-heading {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0;
  }
  .pane-title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 8px;
  }
  .pane-hint {
    margin: 0 0 12px;
  }
  .privileges-layout {
    display: grid;
    grid-template-columns: minmax(140px, 200px) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  .role-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .role-row {
    text-align: left;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-primary);
    border-radius: 6px;
    padding: 8px 10px;
    cursor: pointer;
    min-height: 32px;
  }
  .role-row:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .role-row.selected {
    background: var(--bg-hover);
    border-color: var(--border-subtle);
  }
  .role-row:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .role-row:focus-visible {
    outline: 2px solid var(--border-focus, var(--brand));
    outline-offset: 2px;
  }
  .field-label {
    display: block;
    font-size: 0.75rem;
    color: var(--text-secondary);
    margin: 0 0 4px;
  }
  .privileges-input {
    width: 100%;
    box-sizing: border-box;
    margin-bottom: 12px;
    min-height: 32px;
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    color: var(--text-primary);
  }
  .flag-set {
    border: 0;
    margin: 0 0 10px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .flag-check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 24px;
    font-size: 0.875rem;
  }
  .role-summary {
    margin-bottom: 12px;
  }
  .summary-name {
    margin: 0 0 8px;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .flag-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .flag-chip {
    font-size: 0.75rem;
    color: var(--text-secondary);
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    padding: 4px 8px;
  }
  .assign-actions,
  .full-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-top: 8px;
  }
  .muted {
    color: var(--text-secondary);
    font-size: 0.8125rem;
  }
  .input-error {
    color: var(--danger, var(--text-primary));
    font-size: 0.8125rem;
  }
  @media (max-width: 640px) {
    .privileges-layout {
      grid-template-columns: 1fr;
    }
  }
</style>
