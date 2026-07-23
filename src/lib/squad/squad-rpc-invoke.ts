import { get } from 'svelte/store';
import { currentUser } from '../../stores/auth';
import { parseSupportedChainId } from '../wallet/chains';
import { buildSquadInvokeRpcUrls } from './squad-rpc';

/** Failover RPC list for parent-scoped Tauri invokes, or null when empty / no parent. */
export function squadRpcUrlsForInvoke(
  parentId: string | null | undefined,
  network: string | null | undefined,
): string[] | null {
  if (!parentId?.trim()) return null;
  const npub = get(currentUser)?.npub?.trim() ?? null;
  const chain = parseSupportedChainId(network ?? undefined);
  const urls = buildSquadInvokeRpcUrls(npub, parentId, chain);
  return urls.length > 0 ? urls : null;
}
