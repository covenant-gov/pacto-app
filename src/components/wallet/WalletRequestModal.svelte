<script lang="ts">
  import WalletTransferStubModal from './WalletTransferStubModal.svelte';
  import type { WatchedErc20Row } from '../../lib/wallet/watched-tokens';

  interface Props {
    npub: string;
    peerDisplayName: string;
    onClose: () => void;
    postDmPlaintext?: ((content: string) => Promise<boolean>) | undefined;
    watchedAssetRows?: WatchedErc20Row[];
  }

  let {
    npub,
    peerDisplayName,
    onClose,
    postDmPlaintext = undefined,
    watchedAssetRows = [],
  }: Props = $props();
</script>

<WalletTransferStubModal
  mode="request"
  {npub}
  {peerDisplayName}
  {watchedAssetRows}
  {onClose}
  {postDmPlaintext}
/>
