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

function excludeSet(excludeAddress?: string | string[]): Set<string> {
  const raw = excludeAddress == null ? [] : Array.isArray(excludeAddress) ? excludeAddress : [excludeAddress];
  const out = new Set<string>();
  for (const item of raw) {
    const addr = checksumAddress(item);
    if (addr) out.add(addr.toLowerCase());
  }
  return out;
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

export type MemberEvmOption = { address: string; label: string };

function shortEvmLabel(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Label on-chain wearers from known roster options; checksum + short address fallback. */
export function labeledWearerOptions(
  wearerAddresses: string[],
  knownOptions: MemberEvmOption[] = [],
): MemberEvmOption[] {
  const labelByKey = new Map<string, string>();
  for (const o of knownOptions) {
    const addr = checksumAddress(o.address);
    if (!addr) continue;
    const key = addr.toLowerCase();
    if (!labelByKey.has(key)) labelByKey.set(key, o.label);
  }
  const out: MemberEvmOption[] = [];
  const seen = new Set<string>();
  for (const raw of wearerAddresses) {
    const addr = checksumAddress(raw);
    if (!addr) continue;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ address: addr, label: labelByKey.get(key) || shortEvmLabel(addr) });
  }
  return out;
}

/** Unique roster EVMs excluding the current captain (and any extra wearers). */
export function randomizeCaptainCandidates(
  options: { address: string }[],
  excludeAddress?: string | string[],
): string[] {
  const excluded = excludeSet(excludeAddress);
  return uniqueRosterAddresses(options.map((o) => o.address)).filter(
    (addr) => !excluded.has(addr.toLowerCase()),
  );
}

function randomUintIndex(length: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % length;
}

/** Pick a random other roster EVM as war-game captain. Never the excluded address. */
export function pickRandomRosterCaptain(
  options: { address: string }[],
  excludeAddress?: string | string[],
  randomIndex: (length: number) => number = randomUintIndex,
): string | null {
  const pool = randomizeCaptainCandidates(options, excludeAddress);
  if (pool.length === 0) return null;
  const i = randomIndex(pool.length);
  if (!Number.isInteger(i) || i < 0 || i >= pool.length) return pool[0] ?? null;
  return pool[i] ?? null;
}
