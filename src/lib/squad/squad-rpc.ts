/**
 * Squad-level dual RPC slots (primary + backup), npub-scoped localStorage.
 * Shared via MLS for slots 1–2 only; user Settings default is a local tertiary failover.
 */

import { writable } from 'svelte/store';
import { getCuratedRpcUrlsForChain } from '../wallet/rpc-catalog';
import { resolveProviderPrimaryRpcUrl } from '../wallet/rpc-providers';
import { loadDefaultRpc, normalizeRpcUrl } from '../wallet/rpc-prefs';
import type { SupportedChainId } from '../wallet/chains';
import { isSquadDeployableChain } from './squad-network';

const STORAGE_VERSION = 1 as const;
/** Prefix for `clear-account-state` scoped removal (`_${npub}`). */
export const SQUAD_RPC_PREFIX = 'pacto_squad_rpc_v1';

export const squadRpcTick = writable(0);

export type SquadRpcSlot =
  | { kind: 'unset' }
  | { kind: 'default_public' }
  | { kind: 'url'; url: string };

export type SquadRpcConfig = {
  chain: SupportedChainId;
  rpc1: SquadRpcSlot;
  rpc2: SquadRpcSlot;
};

function storageKey(accountNpub: string): string {
  return `${SQUAD_RPC_PREFIX}_${accountNpub}`;
}

export function unsetSlot(): SquadRpcSlot {
  return { kind: 'unset' };
}

export function defaultPublicSlot(): SquadRpcSlot {
  return { kind: 'default_public' };
}

export function urlSlot(raw: string): SquadRpcSlot | null {
  const url = normalizeRpcUrl(raw);
  if (!url) return null;
  return { kind: 'url', url };
}

export function parseSquadRpcSlot(raw: unknown): SquadRpcSlot | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.kind === 'unset') return { kind: 'unset' };
  if (o.kind === 'default_public') return { kind: 'default_public' };
  if (o.kind === 'url' && typeof o.url === 'string') {
    const url = normalizeRpcUrl(o.url);
    if (!url) return null;
    return { kind: 'url', url };
  }
  return null;
}

function serializeSlot(slot: SquadRpcSlot): SquadRpcSlot {
  return slot.kind === 'url' ? { kind: 'url', url: slot.url } : { kind: slot.kind };
}

function readBlob(accountNpub: string): Record<string, SquadRpcConfig> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(accountNpub)) ?? '') as {
      v?: number;
      byParentId?: unknown;
    };
    if (parsed?.v !== STORAGE_VERSION || !parsed.byParentId || typeof parsed.byParentId !== 'object') {
      return {};
    }
    const out: Record<string, SquadRpcConfig> = {};
    for (const [parentId, raw] of Object.entries(parsed.byParentId as Record<string, unknown>)) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Record<string, unknown>;
      if (!isSquadDeployableChain(row.chain)) continue;
      const rpc1 = parseSquadRpcSlot(row.rpc1);
      const rpc2 = parseSquadRpcSlot(row.rpc2);
      if (!rpc1 || !rpc2) continue;
      out[parentId] = { chain: row.chain, rpc1, rpc2 };
    }
    return out;
  } catch {
    return {};
  }
}

function writeBlob(accountNpub: string, byParentId: Record<string, SquadRpcConfig>): void {
  if (typeof localStorage === 'undefined') return;
  const serializable: Record<string, unknown> = {};
  for (const [parentId, cfg] of Object.entries(byParentId)) {
    serializable[parentId] = {
      chain: cfg.chain,
      rpc1: serializeSlot(cfg.rpc1),
      rpc2: serializeSlot(cfg.rpc2),
    };
  }
  localStorage.setItem(
    storageKey(accountNpub),
    JSON.stringify({ v: STORAGE_VERSION, byParentId: serializable }),
  );
  squadRpcTick.update((n) => n + 1);
}

export function loadSquadRpcConfig(
  accountNpub: string | null | undefined,
  parentId: string | null | undefined,
): SquadRpcConfig | null {
  if (!accountNpub || !parentId) return null;
  return readBlob(accountNpub)[parentId] ?? null;
}

export function saveSquadRpcConfig(
  accountNpub: string,
  parentId: string,
  config: SquadRpcConfig,
): void {
  if (!accountNpub || !parentId || !isSquadDeployableChain(config.chain)) return;
  const byParentId = readBlob(accountNpub);
  byParentId[parentId] = {
    chain: config.chain,
    rpc1: config.rpc1,
    rpc2: config.rpc2,
  };
  writeBlob(accountNpub, byParentId);
}

/** Create-squad defaults: RPC-1 public, RPC-2 unset. */
export function initSquadRpcOnCreate(
  accountNpub: string,
  parentId: string,
  chain: SupportedChainId,
): SquadRpcConfig {
  const config: SquadRpcConfig = {
    chain,
    rpc1: defaultPublicSlot(),
    rpc2: unsetSlot(),
  };
  saveSquadRpcConfig(accountNpub, parentId, config);
  return config;
}

/** Effective config, or create-squad defaults when missing (not persisted). */
export function effectiveSquadRpcConfig(
  accountNpub: string | null | undefined,
  parentId: string | null | undefined,
  chain: SupportedChainId | null | undefined,
): SquadRpcConfig | null {
  if (!chain || !isSquadDeployableChain(chain)) return null;
  const stored = loadSquadRpcConfig(accountNpub, parentId);
  if (stored) {
    return stored.chain === chain
      ? stored
      : { chain, rpc1: stored.rpc1, rpc2: stored.rpc2 };
  }
  return { chain, rpc1: defaultPublicSlot(), rpc2: unsetSlot() };
}

export function setSquadRpcPrimary(
  accountNpub: string,
  parentId: string,
  chain: SupportedChainId,
  rawUrl: string,
): { ok: true; config: SquadRpcConfig } | { ok: false; error: string } {
  const slot = urlSlot(rawUrl);
  if (!slot) return { ok: false, error: 'Enter a valid http(s) RPC URL.' };
  const config: SquadRpcConfig = {
    chain,
    rpc1: slot,
    rpc2: defaultPublicSlot(),
  };
  saveSquadRpcConfig(accountNpub, parentId, config);
  return { ok: true, config };
}

export function setSquadRpcBackup(
  accountNpub: string,
  parentId: string,
  chain: SupportedChainId,
  rawUrl: string,
): { ok: true; config: SquadRpcConfig } | { ok: false; error: string } {
  const slot = urlSlot(rawUrl);
  if (!slot) return { ok: false, error: 'Enter a valid http(s) RPC URL.' };
  const existing = loadSquadRpcConfig(accountNpub, parentId);
  const rpc1 =
    existing?.rpc1.kind === 'url'
      ? existing.rpc1
      : existing?.rpc1.kind === 'default_public'
        ? existing.rpc1
        : null;
  if (!rpc1 || rpc1.kind !== 'url') {
    return { ok: false, error: 'Set a custom primary RPC before adding a backup.' };
  }
  const config: SquadRpcConfig = {
    chain,
    rpc1,
    rpc2: slot,
  };
  saveSquadRpcConfig(accountNpub, parentId, config);
  return { ok: true, config };
}

export function clearSquadRpcPrimary(
  accountNpub: string,
  parentId: string,
  chain: SupportedChainId,
): SquadRpcConfig {
  const config: SquadRpcConfig = {
    chain,
    rpc1: defaultPublicSlot(),
    rpc2: unsetSlot(),
  };
  saveSquadRpcConfig(accountNpub, parentId, config);
  return config;
}

export function clearSquadRpcBackup(
  accountNpub: string,
  parentId: string,
  chain: SupportedChainId,
): SquadRpcConfig {
  const existing = loadSquadRpcConfig(accountNpub, parentId);
  const rpc1 = existing?.rpc1.kind === 'url' ? existing.rpc1 : defaultPublicSlot();
  const config: SquadRpcConfig = {
    chain,
    rpc1,
    rpc2: rpc1.kind === 'url' ? defaultPublicSlot() : unsetSlot(),
  };
  saveSquadRpcConfig(accountNpub, parentId, config);
  return config;
}

/** Expand a squad slot to concrete URL(s). Custom = one URL; default_public = provider + curated. */
export function expandSquadRpcSlot(slot: SquadRpcSlot, chain: SupportedChainId): string[] {
  if (slot.kind === 'unset') return [];
  if (slot.kind === 'url') return [slot.url];
  const out: string[] = [];
  const provider = resolveProviderPrimaryRpcUrl(chain);
  if (provider) out.push(provider);
  for (const url of getCuratedRpcUrlsForChain(chain)) {
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

/** Squad slots only (no user tertiary). */
export function resolveSquadRpcUrls(config: SquadRpcConfig): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const slot of [config.rpc1, config.rpc2]) {
    for (const url of expandSquadRpcSlot(slot, config.chain)) {
      const key = url.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(url);
    }
  }
  return out;
}

/**
 * Full failover list for Tauri: squad RPC-1 → RPC-2 → distinct Settings default (local only).
 */
export function buildSquadInvokeRpcUrls(
  accountNpub: string | null | undefined,
  parentId: string | null | undefined,
  chain: SupportedChainId | null | undefined,
): string[] {
  const resolvedChain = chain ?? loadSquadRpcConfig(accountNpub, parentId)?.chain ?? null;
  const config = effectiveSquadRpcConfig(accountNpub, parentId, resolvedChain);
  if (!config) return [];
  const out = resolveSquadRpcUrls(config);
  const seen = new Set(out.map((u) => u.trim().toLowerCase()));
  const userDefault = loadDefaultRpc(accountNpub, config.chain);
  if (userDefault) {
    const key = userDefault.trim().toLowerCase();
    if (key && !seen.has(key)) out.push(userDefault);
  }
  return out;
}

export function formatSquadRpcLabel(config: SquadRpcConfig | null): string {
  if (!config) return 'Not set';
  if (config.rpc1.kind === 'default_public') return 'Public node';
  if (config.rpc1.kind === 'url') {
    try {
      return new URL(config.rpc1.url).host;
    } catch {
      return 'Custom';
    }
  }
  return 'Not set';
}

export function squadRpcHasBackup(config: SquadRpcConfig | null): boolean {
  return !!config && config.rpc2.kind === 'url';
}
