<script lang="ts">
  import WalletTransferStubModal from './WalletTransferStubModal.svelte';
  import type { WatchedErc20Row } from '../../lib/wallet/watched-tokens';
  import type { WalletSendPrefillPayload } from '../../stores/app';

  interface Props {
    npub: string;
    peerDisplayName: string;
    onClose: () => void;
    watchedAssetRows?: WatchedErc20Row[];
    /** From Accept on a payment request: network, asset, amount, request id. */
    formPrefill?: WalletSendPrefillPayload | null;
    postDmPlaintext?: ((content: string) => Promise<boolean>) | undefined;
    /** Refresh balances after a send confirms in the background. */
    onBalanceRefresh?: (() => void | Promise<void>) | undefined;
  }

  let {
    npub,
    peerDisplayName,
    onClose,
    watchedAssetRows = [],
    formPrefill = null,
    postDmPlaintext = undefined,
    onBalanceRefresh = undefined,
  }: Props = $props();
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
