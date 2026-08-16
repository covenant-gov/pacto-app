import { writable } from 'svelte/store';
import { listStickerPacks, type StickerPack } from '../lib/api/stickers';
import { getInvokeErrorMessage } from '../lib/utils/tauri-errors';

/** All non-deleted sticker packs across every squad the account belongs to. */
export const stickerPacks = writable<StickerPack[]>([]);

/** Fetch packs from the backend and replace store contents. Leaves the store untouched on failure. */
export async function hydrateStickerPacks(): Promise<void> {
  try {
    const packs = await listStickerPacks();
    stickerPacks.set(packs);
  } catch (e) {
    console.error('hydrateStickerPacks failed:', getInvokeErrorMessage(e));
  }
}

/** Replace store contents wholesale from a `sticker_packs_updated` event payload. */
export function applyStickerPacksUpdate(packs: StickerPack[]): void {
  stickerPacks.set(packs);
}

/** Clear all packs. Call on logout alongside other npub-scoped state. */
export function resetStickerPacksStore(): void {
  stickerPacks.set([]);
}
