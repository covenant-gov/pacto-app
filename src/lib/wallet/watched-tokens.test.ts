import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  catalogTokenId,
  customTokenId,
  defaultWatchedErc20Rows,
  loadWatchedErc20Rows,
  saveWatchedErc20Rows,
  watchedRowsToWire,
  buildCatalogSearchEntries,
  catalogEntryToRow,
  listWalletAssetOptionsForChainWithWatched,
  type WatchedErc20Row,
} from './watched-tokens';

describe('watched-tokens', () => {
  let storage: Record<string, string> = {};

  beforeEach(() => {
    storage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
      removeItem: (key: string) => {
        delete storage[key];
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('token id helpers', () => {
    it('builds catalog ids in uppercase', () => {
      expect(catalogTokenId('sepolia', 'usdc')).toBe('catalog_sepolia_USDC');
    });

    it('builds custom ids from a lowercased address', () => {
      expect(customTokenId('sepolia', '  0xAbC  ')).toBe('custom_sepolia_0xabc');
    });
  });

  describe('defaultWatchedErc20Rows', () => {
    it('returns USDC and USDT for every configured chain', () => {
      const rows = defaultWatchedErc20Rows();
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(['USDC', 'USDT']).toContain(row.symbol);
        expect(row.source).toBe('catalog');
      }
    });
  });

  describe('loadWatchedErc20Rows', () => {
    it('returns defaults when no account is given', () => {
      const rows = loadWatchedErc20Rows(null);
      expect(rows).toEqual(defaultWatchedErc20Rows());
    });

    it('returns defaults when no stored data exists', () => {
      const rows = loadWatchedErc20Rows('npub1');
      expect(rows).toEqual(defaultWatchedErc20Rows());
    });

    it('loads stored rows with the correct version', () => {
      const stored: WatchedErc20Row[] = [
        {
          id: catalogTokenId('sepolia', 'USDC'),
          network: 'sepolia',
          symbol: 'USDC',
          address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
          decimals: 6,
          source: 'catalog',
        },
      ];
      saveWatchedErc20Rows('npub1', stored);
      const rows = loadWatchedErc20Rows('npub1');
      expect(rows).toEqual(stored);
    });

    it('falls back to defaults when the stored version is wrong', () => {
      storage[`pacto_wallet_watched_erc20_v1_npub1`] = JSON.stringify({
        version: 0,
        rows: [],
      });
      expect(loadWatchedErc20Rows('npub1')).toEqual(defaultWatchedErc20Rows());
    });

    it('falls back to defaults when the stored JSON is malformed', () => {
      storage[`pacto_wallet_watched_erc20_v1_npub1`] = 'not-json';
      expect(loadWatchedErc20Rows('npub1')).toEqual(defaultWatchedErc20Rows());
    });

    it('filters invalid rows and keeps valid ones', () => {
      const stored = {
        version: 1,
        rows: [
          {
            id: 'valid',
            network: 'sepolia',
            symbol: 'USDC',
            address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
            decimals: 6,
            source: 'catalog',
          },
          'not-an-object',
          { network: 'sepolia', symbol: 'BAD', address: '0xabc', decimals: 6, source: 'catalog' },
        ],
      };
      storage[`pacto_wallet_watched_erc20_v1_npub1`] = JSON.stringify(stored);
      const rows = loadWatchedErc20Rows('npub1');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe('valid');
    });

    it('dedupes rows with the same network and address', () => {
      const address = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
      const rows: WatchedErc20Row[] = [
        {
          id: catalogTokenId('sepolia', 'USDC'),
          network: 'sepolia',
          symbol: 'USDC',
          address,
          decimals: 6,
          source: 'catalog',
        },
        {
          id: customTokenId('sepolia', address),
          network: 'sepolia',
          symbol: 'USDC2',
          address,
          decimals: 6,
          source: 'custom',
        },
      ];
      saveWatchedErc20Rows('npub1', rows);
      const loaded = loadWatchedErc20Rows('npub1');
      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.id).toBe(catalogTokenId('sepolia', 'USDC'));
    });

    it('migrates legacy all_tokens mode', () => {
      storage['pacto_wallet_bar_token_filter'] = 'all_tokens';
      const rows = loadWatchedErc20Rows('npub1');
      expect(rows).toEqual(defaultWatchedErc20Rows());
      expect(storage['pacto_wallet_bar_token_filter']).toBeUndefined();
    });

    it('migrates legacy native_only mode to an empty list', () => {
      storage['pacto_wallet_bar_token_filter'] = 'native_only';
      expect(loadWatchedErc20Rows('npub1')).toEqual([]);
    });

    it('migrates legacy native_usdc mode to only USDC rows', () => {
      storage['pacto_wallet_bar_token_filter'] = 'native_usdc';
      const rows = loadWatchedErc20Rows('npub1');
      expect(rows.every((r) => r.symbol === 'USDC')).toBe(true);
    });
  });

  describe('saveWatchedErc20Rows', () => {
    it('does nothing when localStorage is unavailable', () => {
      vi.stubGlobal('localStorage', undefined);
      expect(() => saveWatchedErc20Rows('npub1', [])).not.toThrow();
    });

    it('writes normalized rows with the current version', () => {
      const rows: WatchedErc20Row[] = [
        {
          id: catalogTokenId('sepolia', 'USDC'),
          network: 'sepolia',
          symbol: 'USDC',
          address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
          decimals: 6,
          source: 'catalog',
        },
      ];
      saveWatchedErc20Rows('npub1', rows);
      const raw = storage['pacto_wallet_watched_erc20_v1_npub1'];
      expect(JSON.parse(raw)).toEqual({ version: 1, rows });
    });
  });

  describe('watchedRowsToWire', () => {
    it('maps rows to the wire format expected by the backend', () => {
      const rows: WatchedErc20Row[] = [
        {
          id: 'x',
          network: 'sepolia',
          symbol: 'USDC',
          address: '0xabc',
          decimals: 6,
          source: 'catalog',
        },
      ];
      expect(watchedRowsToWire(rows)).toEqual([
        { network: 'sepolia', symbol: 'USDC', address: '0xabc', decimals: 6 },
      ]);
    });
  });

  describe('buildCatalogSearchEntries', () => {
    it('includes a search entry for every chain and token pair', () => {
      const entries = buildCatalogSearchEntries();
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.symbol).toMatch(/USDC|USDT/);
        expect(entry.address.startsWith('0x')).toBe(true);
        expect(entry.searchText).toContain(entry.network.toLowerCase());
      }
    });
  });

  describe('catalogEntryToRow', () => {
    it('converts a search entry to a catalog row', () => {
      const entry = buildCatalogSearchEntries()[0]!;
      const row = catalogEntryToRow(entry);
      expect(row.id).toBe(entry.id);
      expect(row.network).toBe(entry.network);
      expect(row.symbol).toBe(entry.symbol);
      expect(row.address).toBe(entry.address);
      expect(row.decimals).toBe(entry.decimals);
      expect(row.source).toBe('catalog');
    });
  });

  describe('listWalletAssetOptionsForChainWithWatched', () => {
    it('returns the native option first', () => {
      const options = listWalletAssetOptionsForChainWithWatched('sepolia', []);
      expect(options[0]).toEqual({ code: 'ETH', kind: 'native', decimals: 18 });
    });

    it('includes watched ERC-20 tokens for the requested chain', () => {
      const watched: WatchedErc20Row[] = [
        {
          id: 'custom_sepolia_0xabc',
          network: 'sepolia',
          symbol: 'MOCK',
          address: '0x1111111111111111111111111111111111111111',
          decimals: 18,
          source: 'custom',
        },
      ];
      const options = listWalletAssetOptionsForChainWithWatched('sepolia', watched);
      expect(options.map((o) => o.code)).toEqual(['ETH', 'MOCK']);
    });

    it('excludes zero-address tokens', () => {
      const watched: WatchedErc20Row[] = [
        {
          id: 'zero',
          network: 'sepolia',
          symbol: 'ZERO',
          address: '0x0000000000000000000000000000000000000000',
          decimals: 18,
          source: 'custom',
        },
      ];
      const options = listWalletAssetOptionsForChainWithWatched('sepolia', watched);
      expect(options.map((o) => o.code)).toEqual(['ETH']);
    });

    it('ignores watched tokens from other chains', () => {
      const watched: WatchedErc20Row[] = [
        {
          id: 'other',
          network: 'mainnet',
          symbol: 'MOCK',
          address: '0x1111111111111111111111111111111111111111',
          decimals: 18,
          source: 'custom',
        },
      ];
      const options = listWalletAssetOptionsForChainWithWatched('sepolia', watched);
      expect(options.map((o) => o.code)).toEqual(['ETH']);
    });
  });
});
