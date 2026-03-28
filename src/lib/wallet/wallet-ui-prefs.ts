/**
 * Which EVM chains appear in wallet UI (Wallet view + DM WalletBar). Persisted per npub.
 */

import { writable } from 'svelte/store';
import type { SupportedChainId } from './chains';
import { WALLET_ASSETS_CHAIN_IDS } from './assets';

const STORAGE_VERSION = 1 as const;
/** Prefix for `clear-account-state` scoped removal (`_${npub}`). */
export const WALLET_UI_ENABLED_CHAINS_PREFIX = 'pacto_wallet_ui_enabled_chains_v1';

/** Bump so `WalletBar` reactively re-reads prefs when toggles change in Wallet view. */
export const walletUiEnabledChainsTick = writable(0);

export function defaultWalletEnabledChains(): SupportedChainId[] {
  return [...WALLET_ASSETS_CHAIN_IDS];
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
    if (parsed?.v !== STORAGE_VERSION) return defaultWalletEnabledChains();
    const n = normalizeChains(parsed.chains);
    return n ?? defaultWalletEnabledChains();
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
