/**
 * Shipped ABI JSON for generic read / Advanced calldata preview (Phase H).
 */

import type { Abi } from 'viem';
import erc20Minimal from './abis/erc20-minimal.json';

export const SHIPPED_ABI_CATALOG: Record<string, { label: string; abi: Abi }> = {
  'erc20-minimal': { label: 'ERC-20 (balanceOf, decimals, symbol)', abi: erc20Minimal as Abi },
};

export function listShippedAbiRefs(): { ref: string; label: string }[] {
  return Object.entries(SHIPPED_ABI_CATALOG).map(([ref, meta]) => ({ ref, label: meta.label }));
}

export function loadShippedAbi(ref: string): Abi | null {
  const key = ref.trim();
  return SHIPPED_ABI_CATALOG[key]?.abi ?? null;
}

/** Parse user-pasted ABI JSON (array or `{ abi: [...] }` Foundry artifact). */
export function parseAbiJson(raw: string): Abi {
  const t = raw.trim();
  if (!t) throw new Error('Paste a JSON ABI array.');
  const parsed = JSON.parse(t) as unknown;
  if (Array.isArray(parsed)) return parsed as Abi;
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { abi?: unknown }).abi)) {
    return (parsed as { abi: Abi }).abi;
  }
  throw new Error('ABI JSON must be an array or a Foundry artifact with an abi field.');
}

/** Optional hook: future `squad_infra.provider_payload.custom_module.abiRef`. */
export function resolveAbiRefFromInfraPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const custom = root.custom_module;
  if (!custom || typeof custom !== 'object') return null;
  const abiRef = (custom as Record<string, unknown>).abiRef;
  return typeof abiRef === 'string' && abiRef.trim() ? abiRef.trim() : null;
}
