/**
 * Per-account personal RPC URLs and default RPC selection (Settings → EVM).
 */

import { get } from 'svelte/store';
import { writable } from 'svelte/store';
import { currentNpubForPersistence } from '../../stores/app';
import { getCuratedRpcUrlsForChain } from './rpc-catalog';
import { WALLET_ASSETS_CHAIN_IDS } from './assets';

const STORAGE_VERSION = 1 as const;
export const WALLET_RPC_PREFS_PREFIX = 'pacto_wallet_rpc_prefs_v1';

export const walletRpcPrefsTick = writable(0);

export type RpcOptionGroup = 'personal' | 'curated';

export type RpcDefaultOption = {
  value: string;
  label: string;
  group: RpcOptionGroup;
};

type RpcPrefsPayload = {
  personal: Partial<Record<SupportedChainId, string[]>>;
  defaultRpc: Partial<Record<SupportedChainId, string>>;
};

const EMPTY_PREFS: RpcPrefsPayload = { personal: {}, defaultRpc: {} };

function storageKey(accountNpub: string): string {
  return `${WALLET_RPC_PREFS_PREFIX}_${accountNpub}`;
}

function isSupportedChainId(raw: string): raw is SupportedChainId {
  return (WALLET_ASSETS_CHAIN_IDS as readonly string[]).includes(raw);
}

export function isValidRpcUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeRpcUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!isValidRpcUrl(trimmed)) return null;
  return trimmed.replace(/\/+$/, '');
}

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    const norm = normalizeRpcUrl(url);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

function normalizePersonalMap(raw: unknown): Partial<Record<SupportedChainId, string[]>> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Partial<Record<SupportedChainId, string[]>> = {};
  for (const [chainId, urls] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSupportedChainId(chainId) || !Array.isArray(urls)) continue;
    const next = dedupeUrls(urls.filter((u) => typeof u === 'string'));
    if (next.length > 0) out[chainId] = next;
  }
  return out;
}

function normalizeDefaultMap(
  raw: unknown,
  personal: Partial<Record<SupportedChainId, string[]>>,
): Partial<Record<SupportedChainId, string>> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Partial<Record<SupportedChainId, string>> = {};
  for (const [chainId, url] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSupportedChainId(chainId) || typeof url !== 'string') continue;
    const norm = normalizeRpcUrl(url);
    if (!norm) continue;
    const curated = getCuratedRpcUrlsForChain(chainId);
    const allowed = new Set([...(personal[chainId] ?? []), ...curated]);
    if (allowed.has(norm)) out[chainId] = norm;
  }
  return out;
}

export function loadRpcPrefs(accountNpub: string | null | undefined): RpcPrefsPayload {
  if (!accountNpub || typeof localStorage === 'undefined') return { ...EMPTY_PREFS };
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(accountNpub)) ?? '') as {
      v?: number;
      personal?: unknown;
      defaultRpc?: unknown;
    };
    if (parsed?.v !== STORAGE_VERSION) return { ...EMPTY_PREFS };
    const personal = normalizePersonalMap(parsed.personal);
    const defaultRpc = normalizeDefaultMap(parsed.defaultRpc, personal);
    return { personal, defaultRpc };
  } catch {
    return { ...EMPTY_PREFS };
  }
}

function saveRpcPrefs(accountNpub: string, prefs: RpcPrefsPayload): void {
  if (!accountNpub || typeof localStorage === 'undefined') return;
  localStorage.setItem(
    storageKey(accountNpub),
    JSON.stringify({
      v: STORAGE_VERSION,
      personal: prefs.personal,
      defaultRpc: prefs.defaultRpc,
    }),
  );
  walletRpcPrefsTick.update((n) => n + 1);
}

export function getActiveAccountNpubForRpc(): string | null {
  return get(currentNpubForPersistence);
}

export function listPersonalRpcs(
  accountNpub: string | null | undefined,
  chainId: SupportedChainId,
): string[] {
  return loadRpcPrefs(accountNpub).personal[chainId] ?? [];
}

export function loadDefaultRpc(
  accountNpub: string | null | undefined,
  chainId: SupportedChainId,
): string | null {
  return loadRpcPrefs(accountNpub).defaultRpc[chainId] ?? null;
}

export function listDefaultRpcOptions(
  accountNpub: string | null | undefined,
  chainId: SupportedChainId,
): RpcDefaultOption[] {
  const prefs = loadRpcPrefs(accountNpub);
  const personal = prefs.personal[chainId] ?? [];
  const curated = getCuratedRpcUrlsForChain(chainId);
  const options: RpcDefaultOption[] = [];

  for (const url of personal) {
    options.push({
      value: url,
      label: `${formatRpcDisplay(url)} (personal)`,
      group: 'personal',
    });
  }
  for (const url of curated) {
    options.push({
      value: url,
      label: `${formatRpcDisplay(url)} (public)`,
      group: 'curated',
    });
  }
  return options;
}

export function formatRpcDisplay(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length <= 48) return trimmed;
  return `${trimmed.slice(0, 28)}…${trimmed.slice(-16)}`;
}

function isAllowedDefaultRpc(
  chainId: SupportedChainId,
  url: string,
  personal: string[],
  curated: string[],
): boolean {
  const norm = normalizeRpcUrl(url);
  if (!norm) return false;
  return personal.includes(norm) || curated.includes(norm);
}

export function addPersonalRpc(
  accountNpub: string,
  chainId: SupportedChainId,
  rawUrl: string,
): { ok: true } | { ok: false; error: string } {
  const url = normalizeRpcUrl(rawUrl);
  if (!url) return { ok: false, error: 'Enter a valid http(s) RPC URL.' };

  const prefs = loadRpcPrefs(accountNpub);
  const existing = prefs.personal[chainId] ?? [];
  if (existing.includes(url)) {
    return { ok: false, error: 'That RPC is already in your personal list.' };
  }

  prefs.personal[chainId] = [...existing, url];
  saveRpcPrefs(accountNpub, prefs);
  return { ok: true };
}

export function removePersonalRpc(
  accountNpub: string,
  chainId: SupportedChainId,
  url: string,
): void {
  const prefs = loadRpcPrefs(accountNpub);
  const existing = prefs.personal[chainId] ?? [];
  const next = existing.filter((entry) => entry !== url);
  if (next.length > 0) prefs.personal[chainId] = next;
  else delete prefs.personal[chainId];

  if (prefs.defaultRpc[chainId] === url) {
    delete prefs.defaultRpc[chainId];
  }

  saveRpcPrefs(accountNpub, prefs);
}

export function saveDefaultRpc(
  accountNpub: string,
  chainId: SupportedChainId,
  rawUrl: string | null,
): void {
  const prefs = loadRpcPrefs(accountNpub);
  if (!rawUrl) {
    delete prefs.defaultRpc[chainId];
    saveRpcPrefs(accountNpub, prefs);
    return;
  }

  const url = normalizeRpcUrl(rawUrl);
  if (!url) return;

  const personal = prefs.personal[chainId] ?? [];
  const curated = getCuratedRpcUrlsForChain(chainId);
  if (!isAllowedDefaultRpc(chainId, url, personal, curated)) return;

  prefs.defaultRpc[chainId] = url;
  saveRpcPrefs(accountNpub, prefs);
}

/** Ordered RPC URLs for viem / read-plane when env overrides are unset. */
export function resolveUserRpcUrls(
  chainId: SupportedChainId,
  accountNpub?: string | null,
): string[] {
  const npub = accountNpub ?? getActiveAccountNpubForRpc();
  const curated = getCuratedRpcUrlsForChain(chainId);
  if (!npub) return curated;

  const prefs = loadRpcPrefs(npub);
  const personal = prefs.personal[chainId] ?? [];
  const defaultUrl = prefs.defaultRpc[chainId];

  if (
    defaultUrl &&
    isAllowedDefaultRpc(chainId, defaultUrl, personal, curated)
  ) {
    const rest = dedupeUrls([...curated, ...personal].filter((u) => u !== defaultUrl));
    return dedupeUrls([defaultUrl, ...rest]);
  }

  return curated;
}
