import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import {
  listStickerPacks,
  saveStickerPack,
  uploadStickerImage,
  fetchStickerImage,
  type StickerPack,
} from './stickers';
import {
  stickerPacks,
  hydrateStickerPacks,
  applyStickerPacksUpdate,
  resetStickerPacksStore,
} from '../../stores/stickers';

vi.mock('@tauri-apps/api/core');

const mockedInvoke = vi.mocked(invoke);

function pack(overrides: Partial<StickerPack> = {}): StickerPack {
  return {
    squadId: 'squad-1',
    packId: 'pack-1',
    name: 'Reactions',
    entries: [
      { shortcode: 'pog', url: 'https://blossom.example/pog.webp', key: 'aa', nonce: 'bb', mime: 'image/webp', size: 42 },
    ],
    updatedAt: 1000,
    updatedBy: 'npub1author',
    deleted: false,
    ...overrides,
  };
}

describe('stickers api wrappers', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    stickerPacks.set([]);
  });

  it('listStickerPacks invokes list_sticker_packs with no args', async () => {
    const packs = [pack()];
    mockedInvoke.mockResolvedValueOnce(packs);
    const result = await listStickerPacks();
    expect(result).toEqual(packs);
    expect(mockedInvoke).toHaveBeenCalledWith('list_sticker_packs');
  });

  it('saveStickerPack invokes save_sticker_pack with exact camelCase keys', async () => {
    const saved = pack();
    mockedInvoke.mockResolvedValueOnce(saved);
    const entries = saved.entries;
    const result = await saveStickerPack('squad-1', 'pack-1', 'Reactions', entries, false);
    expect(result).toEqual(saved);
    expect(mockedInvoke).toHaveBeenCalledWith('save_sticker_pack', {
      squadId: 'squad-1',
      packId: 'pack-1',
      name: 'Reactions',
      entries,
      deleted: false,
    });
  });

  it('uploadStickerImage invokes upload_sticker_image with exact camelCase keys', async () => {
    const uploaded = { url: 'https://blossom.example/x.gif', key: 'cc', nonce: 'dd', mime: 'image/gif', size: 7 };
    mockedInvoke.mockResolvedValueOnce(uploaded);
    const result = await uploadStickerImage([1, 2, 3], 'x.gif');
    expect(result).toEqual(uploaded);
    expect(mockedInvoke).toHaveBeenCalledWith('upload_sticker_image', {
      bytes: [1, 2, 3],
      fileName: 'x.gif',
    });
  });

  it('uploadStickerImage converts a Uint8Array to a plain array', async () => {
    mockedInvoke.mockResolvedValueOnce({ url: '', key: '', nonce: '', mime: '', size: 0 });
    await uploadStickerImage(new Uint8Array([9, 8, 7]), 'y.webp');
    expect(mockedInvoke).toHaveBeenCalledWith('upload_sticker_image', {
      bytes: [9, 8, 7],
      fileName: 'y.webp',
    });
  });

  it('fetchStickerImage invokes fetch_sticker_image with exact camelCase keys', async () => {
    mockedInvoke.mockResolvedValueOnce('/cache/pog.webp');
    const result = await fetchStickerImage('https://blossom.example/pog.webp', 'aa', 'bb');
    expect(result).toBe('/cache/pog.webp');
    expect(mockedInvoke).toHaveBeenCalledWith('fetch_sticker_image', {
      url: 'https://blossom.example/pog.webp',
      key: 'aa',
      nonce: 'bb',
    });
  });
});

describe('stickers store', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    stickerPacks.set([]);
  });

  it('hydrateStickerPacks populates the store from the command result', async () => {
    const packs = [pack(), pack({ packId: 'pack-2' })];
    mockedInvoke.mockResolvedValueOnce(packs);
    await hydrateStickerPacks();
    expect(get(stickerPacks)).toEqual(packs);
  });

  it('applyStickerPacksUpdate replaces store contents rather than appending', () => {
    stickerPacks.set([pack({ packId: 'pack-1' })]);
    applyStickerPacksUpdate([pack({ packId: 'pack-2' })]);
    expect(get(stickerPacks)).toEqual([pack({ packId: 'pack-2' })]);
  });

  it('an invoke rejection leaves the store unchanged', async () => {
    const existing = [pack({ packId: 'pack-existing' })];
    stickerPacks.set(existing);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedInvoke.mockRejectedValueOnce(new Error('backend exploded'));

    await hydrateStickerPacks();

    expect(get(stickerPacks)).toEqual(existing);
    expect(consoleSpy).toHaveBeenCalledWith(
      'hydrateStickerPacks failed:',
      expect.stringContaining('backend exploded')
    );
    consoleSpy.mockRestore();
  });

  it('resetStickerPacksStore empties the store (logout)', () => {
    stickerPacks.set([pack()]);
    resetStickerPacksStore();
    expect(get(stickerPacks)).toEqual([]);
  });
});
