/**
 * Pairwise DM wallet address exchange (persisted per account + peer npub).
 */
import { invoke } from '@tauri-apps/api/core';

export async function getDmPeerEvmAddress(peerNpub: string): Promise<string | null> {
  return await invoke<string | null>('get_dm_peer_evm_address', { peerNpub });
}

export async function setDmPeerEvmAddress(peerNpub: string, address: string): Promise<void> {
  await invoke('set_dm_peer_evm_address', { peerNpub, address });
}
