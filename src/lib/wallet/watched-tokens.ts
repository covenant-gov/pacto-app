/**
 * Watched ERC-20 rows for WalletBar balances and Send asset list (per logged-in account).
 */

import type { Address } from 'viem';
import type { SupportedChainId } from './chains';
import { WALLET_ASSETS, WALLET_ASSETS_CHAIN_IDS } from './assets';

/** Native + watched ERC-20 options for Send / Request asset dropdown. */
export interface WalletAssetOptionRow {
  code: string;
  kind: 'native' | 'erc20';
  address?: Address;
  decimals: number;
}

const STORAGE_VERSION = 1 as const;
const STORAGE_PREFIX = 'pacto_wallet_watched_erc20_v1';
const LEGACY_TOKEN_FILTER = 'pacto_wallet_bar_token_filter';
const LEGACY_TOKEN_VISIBILITY = 'pacto_wallet_bar_token_visibility';

export type WatchedErc20Source = 'catalog' | 'custom';

export interface WatchedErc20Row {
  id: string;
  network: SupportedChainId;
  symbol: string;
  address: string;
  decimals: number;
  source: WatchedErc20Source;
}

export interface WatchedErc20Wire {
  network: string;
  symbol: string;
  address: string;
  decimals: number;
}

export function catalogTokenId(network: SupportedChainId, symbol: string): string {
  return `catalog_${network}_${symbol.toUpperCase()}`;
}

export function customTokenId(network: SupportedChainId, address: string): string {
  const a = address.trim().toLowerCase();
  return `custom_${network}_${a}`;
}

/** Default: USDC + USDT on every configured chain (matches prior “all tokens” bar behavior). */
export function defaultWatchedErc20Rows(): WatchedErc20Row[] {
  const out: WatchedErc20Row[] = [];
  for (const chainId of WALLET_ASSETS_CHAIN_IDS) {
    const net = WALLET_ASSETS.networks[chainId];
    if (!net) continue;
    for (const sym of ['USDC', 'USDT'] as const) {
      const t = net.tokens[sym];
      out.push({
        id: catalogTokenId(chainId, sym),
        network: chainId,
        symbol: sym,
        address: t.address,
        decimals: t.decimals,
        source: 'catalog',
      });
    }
  }
  return out;
}

function isHexAddress(s: string): boolean {
  const t = s.trim();
  const h = t.startsWith('0x') ? t.slice(2) : t;
  return h.length === 40 && /^[0-9a-fA-F]+$/.test(h);
}

function normalizeRows(rows: unknown): WatchedErc20Row[] {
  if (!Array.isArray(rows)) return defaultWatchedErc20Rows();
  if (rows.length === 0) return [];
  const out: WatchedErc20Row[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const network = o.network;
    const symbol = o.symbol;
    const address = o.address;
    const decimals = o.decimals;
    const id = o.id;
    const source = o.source;
    if (
      typeof network !== 'string' ||
      !WALLET_ASSETS_CHAIN_IDS.includes(network as SupportedChainId) ||
      typeof symbol !== 'string' ||
      typeof address !== 'string' ||
      typeof decimals !== 'number' ||
      !Number.isInteger(decimals) ||
      decimals < 0 ||
      decimals > 36 ||
      typeof id !== 'string' ||
      (source !== 'catalog' && source !== 'custom')
    ) {
      continue;
    }
    if (!isHexAddress(address)) continue;
    const sym = symbol.trim().toUpperCase();
    if (!sym || sym.length > 16) continue;
    out.push({
      id,
      network: network as SupportedChainId,
      symbol: sym,
      address: address.trim() as Address,
      decimals,
      source,
    });
  }
  return dedupeWatchedRows(out);
}

function dedupeWatchedRows(rows: WatchedErc20Row[]): WatchedErc20Row[] {
  const seen = new Set<string>();
  const out: WatchedErc20Row[] = [];
  for (const r of rows) {
    const k = `${r.network}:${r.address.trim().toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function storageKey(accountNpub: string): string {
  return `${STORAGE_PREFIX}_${accountNpub}`;
}

function legacyModeToRows(): WatchedErc20Row[] | null {
  if (typeof localStorage === 'undefined') return null;
  let mode: string | null = localStorage.getItem(LEGACY_TOKEN_FILTER);
  if (!mode) {
    const leg = localStorage.getItem(LEGACY_TOKEN_VISIBILITY);
    if (!leg) return null;
    try {
      const o = JSON.parse(leg) as { USDC?: boolean; USDT?: boolean };
      const u = o.USDC === true;
      const us = o.USDT === true;
      if (u && us) mode = 'all_tokens';
      else if (!u && !us) mode = 'native_only';
      else if (u && !us) mode = 'native_usdc';
      else mode = 'native_usdt';
    } catch {
      return null;
    }
  }
  if (
    mode !== 'all_tokens' &&
    mode !== 'native_only' &&
    mode !== 'native_usdc' &&
    mode !== 'native_usdt'
  ) {
    return null;
  }
  if (mode === 'all_tokens') return defaultWatchedErc20Rows();
  if (mode === 'native_only') return [];
  const only: 'USDC' | 'USDT' = mode === 'native_usdc' ? 'USDC' : 'USDT';
  const out: WatchedErc20Row[] = [];
  for (const chainId of WALLET_ASSETS_CHAIN_IDS) {
    const net = WALLET_ASSETS.networks[chainId];
    if (!net) continue;
    const t = net.tokens[only];
    out.push({
      id: catalogTokenId(chainId, only),
      network: chainId,
      symbol: only,
      address: t.address,
      decimals: t.decimals,
      source: 'catalog',
    });
  }
  return out;
}

/**
 * Load watched ERC-20 rows for the logged-in account npub.
 * One-time migration from older WalletBar token dropdown localStorage keys when the watched-token key is absent.
 * Maintainer: removal path is documented under docs/legacy-fixes/ (see legacy-fixes catalog).
 */
export function loadWatchedErc20Rows(accountNpub: string | null | undefined): WatchedErc20Row[] {
  if (!accountNpub || typeof localStorage === 'undefined') return defaultWatchedErc20Rows();
  const key = storageKey(accountNpub);
  const raw = localStorage.getItem(key);
  if (raw) {
    try {
      const o = JSON.parse(raw) as { version?: number; rows?: unknown };
      if (o.version === STORAGE_VERSION && Array.isArray(o.rows)) {
        return normalizeRows(o.rows);
      }
    } catch {
      /* fall through */
    }
  }
  const migrated = legacyModeToRows();
  if (migrated !== null) {
    saveWatchedErc20Rows(accountNpub, migrated);
    return migrated;
  }
  return defaultWatchedErc20Rows();
}

export function saveWatchedErc20Rows(accountNpub: string, rows: WatchedErc20Row[]): void {
  if (typeof localStorage === 'undefined' || !accountNpub) return;
  const normalized = dedupeWatchedRows(rows);
  localStorage.setItem(
    storageKey(accountNpub),
    JSON.stringify({ version: STORAGE_VERSION, rows: normalized })
  );
}

export function watchedRowsToWire(rows: WatchedErc20Row[]): WatchedErc20Wire[] {
  return rows.map((r) => ({
    network: r.network,
    symbol: r.symbol,
    address: r.address,
    decimals: r.decimals,
  }));
}

export interface CatalogSearchEntry {
  id: string;
  network: SupportedChainId;
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  searchText: string;
}

/** Flat catalog from `wallet-assets.json` for the Search tab (predictive filter). */
export function buildCatalogSearchEntries(): CatalogSearchEntry[] {
  const out: CatalogSearchEntry[] = [];
  for (const chainId of WALLET_ASSETS_CHAIN_IDS) {
    const net = WALLET_ASSETS.networks[chainId];
    if (!net) continue;
    for (const sym of ['USDC', 'USDT'] as const) {
      const t = net.tokens[sym];
      if (!t || typeof t.address !== 'string') continue;
      const symbol = sym.toUpperCase();
      const id = catalogTokenId(chainId, symbol);
      const searchText = `${symbol} ${net.displayName} ${chainId}`.toLowerCase();
      out.push({
        id,
        network: chainId,
        symbol,
        name: symbol,
        address: t.address,
        decimals: t.decimals,
        searchText,
      });
    }
  }
  return out;
}

export function catalogEntryToRow(entry: CatalogSearchEntry): WatchedErc20Row {
  return {
    id: entry.id,
    network: entry.network,
    symbol: entry.symbol,
    address: entry.address,
    decimals: entry.decimals,
    source: 'catalog',
  };
}

/** Asset dropdown rows for one chain: native first, then watched ERC-20s for that chain. */
export function listWalletAssetOptionsForChainWithWatched(
  chainId: SupportedChainId,
  watched: readonly WatchedErc20Row[]
): WalletAssetOptionRow[] {
  const net = WALLET_ASSETS.networks[chainId];
  if (!net) return [];
  const native: WalletAssetOptionRow = {
    code: net.native.symbol,
    kind: 'native',
    decimals: net.native.decimals,
  };
  const erc20 = watched
    .filter((r) => r.network === chainId)
    .map((r) => ({
      code: r.symbol,
      kind: 'erc20' as const,
      address: r.address as Address,
      decimals: r.decimals,
    }));
  return [native, ...erc20];
}
