import { getAddress, isAddress } from 'viem';

function checksumAddress(raw: string): string | null {
  const t = raw.trim();
  if (!t || !isAddress(t as `0x${string}`)) return null;
  try {
    return getAddress(t as `0x${string}`);
  } catch {
    return null;
  }
}

/** Deduped checksummed roster EVMs, first-seen order. */
export function uniqueRosterAddresses(addresses: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of addresses) {
    const addr = checksumAddress(raw);
    if (!addr) continue;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(addr);
  }
  return out;
}

function randomUintIndex(length: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % length;
}

/** Pick a random roster EVM as war-game captain. */
export function pickRandomRosterCaptain(
  addresses: string[],
  randomIndex: (length: number) => number = randomUintIndex,
): string | null {
  const pool = uniqueRosterAddresses(addresses);
  if (pool.length === 0) return null;
  const i = randomIndex(pool.length);
  if (!Number.isInteger(i) || i < 0 || i >= pool.length) return pool[0] ?? null;
  return pool[i] ?? null;
}
