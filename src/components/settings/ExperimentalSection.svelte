<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import {
    advancedEvmAccounts,
    evmAccountDisplayName,
    importEvmAccountRow,
    listEvmAccounts,
    updateEvmAccountRow,
    type EvmAccountRow,
  } from '../../lib/wallet/evm-accounts';
  import { appConfig } from '../../stores/app-config';
  import { currentUser } from '../../stores/auth-session';
  import { featureEnabled, featureFlags, setFeatureFlagEnabled } from '../../stores/feature-flags';
  import { showToast } from '../../stores/toast';
  import { TooltipProvider } from '$lib/components/ui/tooltip/index.js';
  import CopyableKeyPill from '../ui/CopyableKeyPill.svelte';
  import InfoTip from '../ui/InfoTip.svelte';
  import MoreActionsMenu from '../ui/MoreActionsMenu.svelte';
  import EvmAccountKeyExportModal from './EvmAccountKeyExportModal.svelte';
  import SettingsCollapsibleSection from './SettingsCollapsibleSection.svelte';
  import SettingsFormModal from './SettingsFormModal.svelte';

  const importedKeyEnabled = featureEnabled('advanced_evm_accounts');

  const accountNpub = $derived($currentUser?.npub ?? null);
  const labelMaxLength = $derived($appConfig.walletAccountLabelMaxLength);

  let accounts = $state<EvmAccountRow[]>([]);
  let accountsLoading = $state(false);
  let importedRows = $derived(advancedEvmAccounts(accounts));

  let formMode: 'import' | 'edit' | null = $state(null);
  let formBusy = $state(false);
  let formError = $state<string | null>(null);
  let importKeyInput = $state('');
  let editAccountId = $state<string | null>(null);
  let editLabel = $state('');

  let exportAccount: EvmAccountRow | null = $state(null);
  let exportModalOpen = $state(false);

  $effect(() => {
    void accountNpub;
    void loadAccounts();
  });

  async function loadAccounts() {
    if (!accountNpub) {
      accounts = [];
      accountsLoading = false;
      return;
    }
    accountsLoading = true;
    try {
      accounts = (await listEvmAccounts()) ?? [];
    } catch (e) {
      accounts = [];
      console.error('list_evm_accounts failed:', e);
    } finally {
      accountsLoading = false;
    }
  }

  function handleToggle(key: string, e: Event & { currentTarget: HTMLInputElement }): void {
    setFeatureFlagEnabled(key, e.currentTarget.checked);
  }

  function closeForm() {
    if (formBusy) return;
    formMode = null;
    formError = null;
    importKeyInput = '';
    editAccountId = null;
    editLabel = '';
  }

  function openImport() {
    formError = null;
    importKeyInput = '';
    editAccountId = null;
    formMode = 'import';
  }

  function openEdit(acc: EvmAccountRow) {
    formError = null;
    formMode = 'edit';
    editAccountId = acc.id;
    editLabel = acc.label?.trim() || evmAccountDisplayName(acc);
  }

  function openExport(acc: EvmAccountRow) {
    exportAccount = acc;
    exportModalOpen = true;
  }

  function closeExport() {
    exportModalOpen = false;
    exportAccount = null;
  }

  async function submitForm() {
    if (formBusy || !formMode) return;
    const tr = get(t);
    const mode = formMode;
    formBusy = true;
    formError = null;
    try {
      if (mode === 'import') {
        const key = importKeyInput.trim();
        if (!key) {
          formError = tr('wallet.pastePrivateKey');
          return;
        }
        await importEvmAccountRow(key);
        showToast(tr('wallet.advancedAccountImported'));
      } else if (editAccountId) {
        await updateEvmAccountRow({
          accountId: editAccountId,
          label: editLabel,
          setActiveSigner: false,
          setDefaultShared: false,
        });
        showToast(tr('wallet.accountUpdated'));
      }
      formBusy = false;
      closeForm();
      await loadAccounts();
    } catch (e) {
      formError = getInvokeErrorMessage(
        e,
        mode === 'import' ? tr('wallet.importFailed') : tr('wallet.couldNotUpdateAccount'),
      );
    } finally {
      formBusy = false;
    }
  }
</script>

<TooltipProvider>
<SettingsCollapsibleSection sectionId="settings-experimental" title={$t('settings.experimental.title')}>
  <div class="experimental-settings">
    {#if $featureFlags.length === 0}
      <p class="experimental-empty">{$t('settings.experimental.empty')}</p>
    {:else}
      <ul class="experimental-list" role="list">
        {#each $featureFlags as flag (flag.key)}
          <li class="experimental-flag">
            <div class="experimental-flag-row">
              <label class="experimental-toggle">
                <input
                  type="checkbox"
                  checked={flag.enabled}
                  onchange={(e) => handleToggle(flag.key, e)}
                />
                <span>{$t(`settings.experimental.flags.${flag.key}.name`)}</span>
                <Badge variant="warning-soft">{$t('settings.experimental.badge')}</Badge>
              </label>
              <InfoTip
                text={$t(`settings.experimental.flags.${flag.key}.description`)}
                ariaLabel={$t('settings.experimental.flagInfoAria')}
              />
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    {#if $importedKeyEnabled}
      <button type="button" class="experimental-import" onclick={openImport}>
        {$t('wallet.importPrivateKey')}
      </button>
    {/if}

    {#if accountsLoading && importedRows.length === 0}
      <p class="experimental-empty">{$t('wallet.loadingAccounts')}</p>
    {:else if importedRows.length > 0}
      <ul class="experimental-accounts" role="list">
        {#each importedRows as acc (acc.id)}
          <li class="experimental-account">
            <div class="experimental-account-identity">
              <p class="experimental-account-name">{evmAccountDisplayName(acc)}</p>
              <CopyableKeyPill
                value={acc.address}
                disabled={!acc.address?.trim()}
                ariaLabel={$t('wallet.copyAddressToClipboard')}
              />
            </div>
            <MoreActionsMenu
              disabled={accountsLoading}
              ariaLabel={$t('wallet.accountActionsMenu')}
              items={[
                {
                  id: 'export-key',
                  label: $t('wallet.exportKey'),
                  onSelect: () => openExport(acc),
                },
                {
                  id: 'edit-name',
                  label: $t('wallet.editAccountName'),
                  onSelect: () => openEdit(acc),
                },
              ]}
            />
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</SettingsCollapsibleSection>

{#if formMode}
  <SettingsFormModal
    titleId="experimental-form-title"
    title={formMode === 'import' ? $t('wallet.importPrivateKey') : $t('settings.experimental.editTitle')}
    busy={formBusy}
    primaryLabel={formMode === 'import' ? $t('wallet.import') : $t('wallet.save')}
    primaryBusyLabel={formMode === 'import' ? $t('wallet.importing') : $t('wallet.saving')}
    primaryDisabled={formMode === 'import' && !importKeyInput.trim()}
    cancelLabel={$t('wallet.cancel')}
    error={formError}
    onClose={closeForm}
    onPrimary={submitForm}
  >
    {#if formMode === 'import'}
      <div class="experimental-field-head">
        <label class="ui-field" for="experimental-import-key">
          <span class="ui-field-label">{$t('wallet.pastePrivateKey')}</span>
          <input
            id="experimental-import-key"
            type="password"
            class="ui-input"
            autocomplete="off"
            spellcheck="false"
            placeholder={$t('wallet.privateKeyPlaceholder')}
            bind:value={importKeyInput}
            disabled={formBusy}
          />
        </label>
        <InfoTip
          text={$t('wallet.advancedAccountWarning')}
          ariaLabel={$t('settings.experimental.flagInfoAria')}
        />
      </div>
    {:else}
      <label class="ui-field" for="experimental-edit-name">
        <span class="ui-field-label">{$t('wallet.nameLabel')}</span>
        <input
          id="experimental-edit-name"
          type="text"
          class="ui-input"
          maxlength={labelMaxLength}
          placeholder={$t('wallet.accountNamePlaceholder')}
          bind:value={editLabel}
          disabled={formBusy}
        />
      </label>
    {/if}
  </SettingsFormModal>
{/if}

<EvmAccountKeyExportModal open={exportModalOpen} account={exportAccount} onClose={closeExport} />
</TooltipProvider>

<style>
  .experimental-settings {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .experimental-empty {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .experimental-list,
  .experimental-accounts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }

  .experimental-flag-row {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
  }

  .experimental-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 0.875rem;
    color: var(--text-secondary);
    cursor: pointer;
    user-select: none;
  }

  .experimental-toggle input {
    accent-color: var(--brand);
  }

  .experimental-import {
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }

  .experimental-import:hover {
    background: var(--bg-hover);
  }

  .experimental-account {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-panel);
  }

  .experimental-account-identity {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .experimental-account-name {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .experimental-field-head {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .experimental-field-head :global(.ui-field) {
    margin: 0;
  }
</style>
