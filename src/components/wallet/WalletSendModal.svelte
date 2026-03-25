<script lang="ts">
  import WalletTransferStubModal from './WalletTransferStubModal.svelte';
  import type { WalletTransferSuccessDetail } from '../../lib/wallet';
  import type { WalletSendPrefillPayload } from '../../stores/app';
  import type { WatchedErc20Row } from '../../lib/wallet/watched-tokens';

  export let npub: string;
  export let peerDisplayName: string;
  export let onClose: () => void;
  export let watchedAssetRows: WatchedErc20Row[] = [];
  /** From Accept on a payment request: network, asset, amount, request id. */
  export let formPrefill: WalletSendPrefillPayload | null = null;
  /**
   * Called after the backend confirms receipt (before toast + modal close).
   * Use to refresh balances and post the `wallet_tx_announcement` DM.
   */
  export let onTransferSuccess: ((detail: WalletTransferSuccessDetail) => void | Promise<void>) | undefined =
    undefined;
</script>

<WalletTransferStubModal
  mode="send"
  {npub}
  {peerDisplayName}
  {watchedAssetRows}
  {onClose}
  {formPrefill}
  {onTransferSuccess}
/>
