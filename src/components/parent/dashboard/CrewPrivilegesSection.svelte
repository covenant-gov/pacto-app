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
    FLAG_ADD_DOC,
    FLAG_BROADCAST,
    FLAG_CREATE_CHANNEL,
    FLAG_CREATE_EVENT,
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
  import { bumpSquadPrivilegeNonce } from '../../../stores/squad-privilege-refresh';
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
  let flagEvent = $state(false);
  let flagDoc = $state(false);
  let drafting = $state(false);

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
      (flagFirstMate ? FLAG_FIRST_MATE : 0) |
      (flagEvent ? FLAG_CREATE_EVENT : 0) |
      (flagDoc ? FLAG_ADD_DOC : 0),
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
      if (!drafting) {
        if (selectedRoleId && !catalogIds.includes(selectedRoleId)) {
          selectedRoleId = catalogIds[0] ?? '';
        } else if (!selectedRoleId && catalogIds.length > 0) {
          selectedRoleId = catalogIds[0];
        }
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
    flagEvent = false;
    flagDoc = false;
  }

  function startDraft() {
    drafting = true;
    selectedRoleId = '';
    resetBuilder();
  }

  function selectRole(roleId: string) {
    drafting = false;
    selectedRoleId = roleId;
  }

  function flagChecked(flag: number, draft: boolean): boolean {
    if (drafting) return draft;
    return ((selectedRow?.knownFlags ?? 0) & flag) !== 0;
  }

  function setDraftFlag(flag: 'invite' | 'channel' | 'broadcast' | 'network' | 'firstMate' | 'event' | 'doc', on: boolean) {
    if (!drafting) return;
    if (flag === 'invite') flagInvite = on;
    else if (flag === 'channel') flagChannel = on;
    else if (flag === 'broadcast') flagBroadcast = on;
    else if (flag === 'network') flagNetwork = on;
    else if (flag === 'firstMate') flagFirstMate = on;
    else if (flag === 'event') flagEvent = on;
    else flagDoc = on;
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
        drafting = false;
        resetBuilder();
        await loadCatalog();
        bumpSquadPrivilegeNonce(parentId);
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

    {#if !writesEnabled}
      <p class="muted" role="status">{$t('governance.privileges.captainOnly')}</p>
    {/if}

    {#if catalogError}
      <p class="input-error" role="alert">{catalogError}</p>
    {/if}

    <div class="privileges-layout">
      <div class="role-list">
        <button type="button" class="role-row" class:selected={drafting} disabled={!writesEnabled} onclick={startDraft}>
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
              class:selected={!drafting && row.roleId === selectedRoleId}
              onclick={() => selectRole(row.roleId)}
            >
              <span class="catalog-name">{row.ok ? row.name : $t('governance.privileges.unknownEncoding')}</span>
            </button>
          {/each}
        {/if}
      </div>

      <div class="role-editor">
        <label class="field-label" for="crew-priv-role-name">{$t('governance.privileges.roleName')}</label>
        <input
          id="crew-priv-role-name"
          type="text"
          class="privileges-input"
          maxlength={PRIVILEGE_ROLE_NAME_MAX_BYTES}
          autocomplete="off"
          spellcheck="false"
          placeholder={$t('governance.privileges.roleNamePlaceholder')}
          value={drafting ? roleName : (selectedRow?.name ?? '')}
          disabled={!drafting || !writesEnabled}
          oninput={(e) => {
            if (drafting) roleName = e.currentTarget.value;
          }}
        />

        <fieldset class="flag-set" disabled={!writesEnabled || !drafting}>
          <legend class="field-label">{$t('governance.privileges.group.members')}</legend>
          <label class="flag-check">
            <input
              type="checkbox"
              checked={flagChecked(FLAG_INVITE_ACCEPT, flagInvite)}
              onchange={(e) => setDraftFlag('invite', e.currentTarget.checked)}
            />
            {flagLabel('inviteAccept')}
          </label>
          {#if isCaptain || (!drafting && (selectedRow?.hasFirstMate ?? false))}
            <label class="flag-check">
              <input
                type="checkbox"
                checked={flagChecked(FLAG_FIRST_MATE, flagFirstMate)}
                onchange={(e) => setDraftFlag('firstMate', e.currentTarget.checked)}
              />
              {flagLabel('firstMate')}
            </label>
          {/if}
        </fieldset>

        <fieldset class="flag-set" disabled={!writesEnabled || !drafting}>
          <legend class="field-label">{$t('governance.privileges.group.channels')}</legend>
          <label class="flag-check">
            <input
              type="checkbox"
              checked={flagChecked(FLAG_CREATE_CHANNEL, flagChannel)}
              onchange={(e) => setDraftFlag('channel', e.currentTarget.checked)}
            />
            {flagLabel('createChannel')}
          </label>
        </fieldset>

        <fieldset class="flag-set" disabled={!writesEnabled || !drafting}>
          <legend class="field-label">{$t('governance.privileges.group.content')}</legend>
          <label class="flag-check">
            <input
              type="checkbox"
              checked={flagChecked(FLAG_CREATE_EVENT, flagEvent)}
              onchange={(e) => setDraftFlag('event', e.currentTarget.checked)}
            />
            {flagLabel('createEvent')}
          </label>
          <label class="flag-check">
            <input
              type="checkbox"
              checked={flagChecked(FLAG_ADD_DOC, flagDoc)}
              onchange={(e) => setDraftFlag('doc', e.currentTarget.checked)}
            />
            {flagLabel('addDoc')}
          </label>
          <label class="flag-check">
            <input
              type="checkbox"
              checked={flagChecked(FLAG_BROADCAST, flagBroadcast)}
              onchange={(e) => setDraftFlag('broadcast', e.currentTarget.checked)}
            />
            {flagLabel('broadcast')}
          </label>
        </fieldset>

        <fieldset class="flag-set" disabled={!writesEnabled || !drafting}>
          <legend class="field-label">{$t('governance.privileges.group.network')}</legend>
          <label class="flag-check">
            <input
              type="checkbox"
              checked={flagChecked(FLAG_MANAGE_NETWORK, flagNetwork)}
              onchange={(e) => setDraftFlag('network', e.currentTarget.checked)}
            />
            {flagLabel('manageNetwork')}
          </label>
        </fieldset>

        {#if drafting}
          <button type="button" class="btn-secondary" disabled={!writesEnabled} onclick={createRole}>
            {$t('governance.squadRoles.action.createRole')}
          </button>
        {:else}
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
            <button type="button" class="btn-secondary" disabled={!writesEnabled || !selectedRoleId} onclick={enableExecutor}>
              {$t('governance.privileges.action.assign')}
            </button>
            <button type="button" class="btn-secondary" disabled={!writesEnabled || !selectedRoleId} onclick={disableExecutor}>
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
