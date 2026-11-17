/**
 * Pairwise DM wallet address exchange (persisted per account + peer npub).
 */
import { invoke } from './index';

export async function getDmPeerEvmAddress(peerNpub: string): Promise<string | null> {
  return await invoke<string | null>('get_dm_peer_evm_address', { peerNpub });
}

export async function setDmPeerEvmAddress(
  peerNpub: string,
  address: string,
  sourceAtMs?: number,
): Promise<void> {
  await invoke('set_dm_peer_evm_address', {
    peerNpub,
    address,
    sourceAtMs: sourceAtMs ?? null,
  });
}
