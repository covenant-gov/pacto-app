/**
 * Dev-only convenience: auto-add the local Docker dev-stack Nostr relay to a
 * freshly unlocked account. Applied once per account per dev session and only
 * when `import.meta.env.DEV` is true, so production builds are unaffected.
 *
 * EVM chain/RPC are NOT auto-wired: the local Anvil chain is a normal opt-in
 * network configured manually in Settings → EVM, like every other chain.
 */

import { addCustomRelay, listRelays } from '../api/relays';

const LOCAL_RELAY_URL = 'ws://localhost:7000';
const RELAY_TIMEOUT_MS = 5_000;
const APPLIED_FLAG_PREFIX = 'pacto_local_dev_defaults_applied_v1';

const inFlight = new Map<string, Promise<void>>();

function appliedFlagKey(npub: string): string {
  return `${APPLIED_FLAG_PREFIX}_${npub}`;
}

function markApplied(npub: string): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(appliedFlagKey(npub), '1');
  } catch {
    // ignore storage errors
  }
}

function isApplied(npub: string): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    return sessionStorage.getItem(appliedFlagKey(npub)) === '1';
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const { promise: timeoutPromise, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => reject(new Error('timed out')), ms);
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    timeoutPromise,
  ]);
}

async function ensureLocalRelay(): Promise<void> {
  try {
    const relays = await withTimeout(listRelays(), RELAY_TIMEOUT_MS);
    const alreadyAdded = relays.some(
      (r) => r.url.toLowerCase() === LOCAL_RELAY_URL.toLowerCase(),
    );
    if (alreadyAdded) return;
    await withTimeout(addCustomRelay(LOCAL_RELAY_URL, 'both'), RELAY_TIMEOUT_MS);
    console.log('[local-dev] added local relay', LOCAL_RELAY_URL);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn('[local-dev] failed to add local relay:', message);
  }
}

export async function applyLocalDevDefaults(npub: string | null | undefined): Promise<void> {
  if (!import.meta.env.DEV || !npub) return;
  if (isApplied(npub)) return;

  const existing = inFlight.get(npub);
  if (existing) {
    await existing;
    return;
  }

  const run = async (): Promise<void> => {
    try {
      await ensureLocalRelay();
      markApplied(npub);
    } finally {
      inFlight.delete(npub);
    }
  };

  const promise = run();
  inFlight.set(npub, promise);
  await promise;
}
