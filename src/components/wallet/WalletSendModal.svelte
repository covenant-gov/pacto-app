<script lang="ts">
  import WalletTransferStubModal from './WalletTransferStubModal.svelte';
  import type { WatchedErc20Row } from '../../lib/wallet/watched-tokens';
  import type { WalletSendPrefillPayload } from '../../stores/app';

  export let npub: string;
  export let peerDisplayName: string;
  export let onClose: () => void;
  export let watchedAssetRows: WatchedErc20Row[] = [];
  /** From Accept on a payment request: network, asset, amount, request id. */
  export let formPrefill: WalletSendPrefillPayload | null = null;
  export let postDmPlaintext: ((content: string) => Promise<boolean>) | undefined = undefined;
  /** Refresh balances after a send confirms in the background. */
  export let onBalanceRefresh: (() => void | Promise<void>) | undefined = undefined;
</script>

<WalletTransferStubModal
  mode="send"
  {npub}
  {peerDisplayName}
  {watchedAssetRows}
  {onClose}
  {formPrefill}
  {postDmPlaintext}
  {onBalanceRefresh}
/>
