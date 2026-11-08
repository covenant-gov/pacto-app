<script lang="ts">
  import SquadEndpointsPanel from './SquadEndpointsPanel.svelte';
  import SquadNetworkSection from './SquadNetworkSection.svelte';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import type { SquadRpcConfig } from '../../../lib/squad/squad-rpc';

  let {
    primaryNetwork,
    practiceNetwork,
    onSetPrimaryNetwork = () => {},
    onSetPracticeNetwork = () => {},
    squadRpcConfig = null,
    onSetSquadRpcPrimary = () => {},
    onSetSquadRpcBackup = () => {},
    onClearSquadRpcPrimary = () => {},
  }: {
    primaryNetwork: SupportedChainId;
    practiceNetwork: SupportedChainId;
    onSetPrimaryNetwork?: (chain: SupportedChainId) => void;
    onSetPracticeNetwork?: (chain: SupportedChainId) => void;
    squadRpcConfig?: SquadRpcConfig | null;
    onSetSquadRpcPrimary?: (url: string) => string | void | Promise<string | void>;
    onSetSquadRpcBackup?: (url: string) => string | void | Promise<string | void>;
    onClearSquadRpcPrimary?: () => void | Promise<void>;
  } = $props();
</script>

<div class="settings-stack">
  <SquadNetworkSection
    {primaryNetwork}
    {practiceNetwork}
    {onSetPrimaryNetwork}
    {onSetPracticeNetwork}
  />

  <SquadEndpointsPanel
    squadNetwork={primaryNetwork}
    {squadRpcConfig}
    {onSetSquadRpcPrimary}
    {onSetSquadRpcBackup}
    {onClearSquadRpcPrimary}
  />
</div>

<style>
  .settings-stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
</style>
