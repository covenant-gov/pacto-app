import { invoke } from './index';

/** One sticker within a pack. `key`/`nonce` are hex, as emitted by `crypto::EncryptionParams`. */
export interface StickerEntry {
  shortcode: string;
  url: string;
  key: string;
  nonce: string;
  mime: string;
  size: number;
}

/** A squad-owned sticker pack. Propagated via MLS `sticker_pack_updated` announces; last-write-wins on `updatedAt`. */
export interface StickerPack {
  squadId: string;
  packId: string;
  name: string;
  entries: StickerEntry[];
  updatedAt: number;
  updatedBy: string;
  deleted: boolean;
}

/** Result of encrypting + uploading one sticker image to Blossom. */
export interface UploadedStickerImage {
  url: string;
  key: string;
  nonce: string;
  mime: string;
  size: number;
}

/** List every non-deleted sticker pack across every squad the account belongs to. Backend: list_sticker_packs. */
export async function listStickerPacks(): Promise<StickerPack[]> {
  return await invoke('list_sticker_packs');
}

/**
 * Persist a sticker pack locally; the backend stamps `updated_at` from the system clock.
 * Caller is responsible for sending the MLS announce afterward. Backend: save_sticker_pack.
 */
export async function saveStickerPack(
  squadId: string,
  packId: string,
  name: string,
  entries: StickerEntry[],
  deleted: boolean
): Promise<StickerPack> {
  return await invoke('save_sticker_pack', { squadId, packId, name, entries, deleted });
}

/** Sniff, encrypt, and upload a sticker image to Blossom. Backend: upload_sticker_image. */
export async function uploadStickerImage(
  bytes: number[] | Uint8Array,
  fileName: string
): Promise<UploadedStickerImage> {
  return await invoke('upload_sticker_image', {
    bytes: bytes instanceof Uint8Array ? Array.from(bytes) : bytes,
    fileName,
  });
}

/** Download and decrypt a sticker image, returning a cached local file path. Backend: fetch_sticker_image. */
export async function fetchStickerImage(url: string, key: string, nonce: string): Promise<string> {
  return await invoke('fetch_sticker_image', { url, key, nonce });
}
