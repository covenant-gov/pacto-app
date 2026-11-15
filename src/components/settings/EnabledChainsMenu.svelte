<script lang="ts">
  import { t } from 'svelte-i18n';
  import DropdownMenu from '../ui/DropdownMenu.svelte';
  import { WALLET_ASSETS_CHAIN_IDS, WALLET_CHAIN_GROUPS, getWalletNetworkDisplayName } from '../../lib/wallet/assets';
  import type { SupportedChainId } from '../../lib/wallet/chains';

  let {
    enabledSet,
    labelledBy,
    onToggleChain,
  }: {
    enabledSet: Set<SupportedChainId>;
    labelledBy: string;
    onToggleChain: (chain: SupportedChainId) => void;
  } = $props();

  const summary = $derived(
    WALLET_ASSETS_CHAIN_IDS.filter((id) => enabledSet.has(id))
      .map((id) => getWalletNetworkDisplayName(id))
      .join(', '),
  );
</script>

<DropdownMenu
  class="ui-select-menu"
  align="stretch"
  panelRole="listbox"
  panelClass="ui-select-panel"
  multiselectable
>
  {#snippet trigger({ open, toggle, menuId })}
    <button
      type="button"
      class="ui-select"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      aria-labelledby={labelledBy}
      onclick={toggle}
    >
      <span class="ui-select-summary">{summary || $t('settings.noEnabledChains')}</span>
      <svg class="ui-select-chevron" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none">
        <path
          d="M6 9L12 15L18 9"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  {/snippet}
  {#each WALLET_CHAIN_GROUPS as group (group.id)}
    <div>
      <h3 class="chain-group-label">{$t(group.label)}</h3>
      <ul class="chain-toggle-list">
        {#each group.chains as chain (chain)}
          <li>
            <label class="chain-toggle">
              <input
                type="checkbox"
                checked={enabledSet.has(chain)}
                disabled={enabledSet.has(chain) && enabledSet.size <= 1}
                onchange={() => onToggleChain(chain)}
              />
              <span>{getWalletNetworkDisplayName(chain)}</span>
            </label>
          </li>
        {/each}
      </ul>
    </div>
  {/each}
</DropdownMenu>

<style>
  .chain-group-label {
    margin: 0 0 8px;
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .chain-toggle-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .chain-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-size: 0.9375rem;
    color: var(--text-primary);
  }

  .chain-toggle input {
    accent-color: var(--brand);
  }
</style>
