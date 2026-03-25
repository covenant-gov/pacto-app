<script lang="ts">
  import WalletTransferStubModal from './WalletTransferStubModal.svelte';
  import type { WatchedErc20Row } from '../../lib/wallet/watched-tokens';

  export let npub: string;
  export let peerDisplayName: string;
  export let onClose: () => void;
  export let postDmPlaintext: ((content: string) => Promise<boolean>) | undefined = undefined;
  export let watchedAssetRows: WatchedErc20Row[] = [];
</script>

<WalletTransferStubModal
  mode="request"
  {npub}
  {peerDisplayName}
  {watchedAssetRows}
  {onClose}
  {postDmPlaintext}
/>
