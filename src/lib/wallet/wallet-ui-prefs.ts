/**
 * Which EVM chains appear in wallet UI (Wallet view + DM WalletBar). Persisted per npub.
 */

import { writable } from 'svelte/store';
import type { SupportedChainId } from './chains';
import { WALLET_ASSETS_CHAIN_IDS } from './assets';

const STORAGE_VERSION = 2 as const;
const STORAGE_VERSION_V1 = 1 as const;
/** Prefix for `clear-account-state` scoped removal (`_${npub}`). */
export const WALLET_UI_ENABLED_CHAINS_PREFIX = 'pacto_wallet_ui_enabled_chains_v1';

/** Bump so `WalletBar` reactively re-reads prefs when toggles change in Wallet view. */
export const walletUiEnabledChainsTick = writable(0);

/** Initial checkmarks in Settings → EVM → Enabled chains. Anvil stays off until enabled. */
export function defaultWalletEnabledChains(): SupportedChainId[] {
  return ['sepolia', 'arbitrum'];
}

function sameChainSet(a: readonly SupportedChainId[], b: readonly SupportedChainId[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((id, i) => id === right[i]);
}

/** Version-1 lists: drop Anvil, and replace the old automatic defaults. */
export function migrateEnabledChainsV1(chains: readonly SupportedChainId[]): SupportedChainId[] {
  if (sameChainSet(chains, ['sepolia', 'local']) || sameChainSet(chains, ['arbitrum'])) {
    return defaultWalletEnabledChains();
  }
  const withoutLocal = chains.filter((id) => id !== 'local');
  return withoutLocal.length > 0 ? [...withoutLocal] : defaultWalletEnabledChains();
}

function storageKey(accountNpub: string): string {
  return `${WALLET_UI_ENABLED_CHAINS_PREFIX}_${accountNpub}`;
}

function normalizeChains(raw: unknown): SupportedChainId[] | null {
  if (!Array.isArray(raw)) return null;
  const allowed = new Set(WALLET_ASSETS_CHAIN_IDS);
  const seen = new Set<string>();
  const out: SupportedChainId[] = [];
  for (const c of raw) {
    if (typeof c !== 'string' || !allowed.has(c as SupportedChainId) || seen.has(c)) continue;
    seen.add(c);
    out.push(c as SupportedChainId);
  }
  return out.length > 0 ? out : null;
}

export function loadWalletEnabledChains(accountNpub: string | null | undefined): SupportedChainId[] {
  if (!accountNpub || typeof localStorage === 'undefined') return defaultWalletEnabledChains();
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(accountNpub)) ?? '') as {
      v?: number;
      chains?: unknown;
    };
    const normalized = normalizeChains(parsed?.chains);
    if (parsed?.v === STORAGE_VERSION) return normalized ?? defaultWalletEnabledChains();
    if (parsed?.v === STORAGE_VERSION_V1 && normalized) {
      const migrated = migrateEnabledChainsV1(normalized);
      saveWalletEnabledChains(accountNpub, migrated);
      return migrated;
    }
    return defaultWalletEnabledChains();
  } catch {
    return defaultWalletEnabledChains();
  }
}

export function saveWalletEnabledChains(accountNpub: string, chains: SupportedChainId[]): void {
  if (!accountNpub || typeof localStorage === 'undefined') return;
  const allowed = new Set(WALLET_ASSETS_CHAIN_IDS);
  const next = [...new Set(chains.filter((c) => allowed.has(c)))];
  const toSave = next.length > 0 ? next : defaultWalletEnabledChains();
  localStorage.setItem(
    storageKey(accountNpub),
    JSON.stringify({ v: STORAGE_VERSION, chains: toSave })
  );
  walletUiEnabledChainsTick.update((n) => n + 1);
}
