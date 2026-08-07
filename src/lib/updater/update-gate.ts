import { writable, type Readable } from 'svelte/store';
import { getStorageCompatibility } from '../api/auth';
import { getMemoizedUpdateCheck, resolveInstalledVersion, updateStatus } from './update-check';
import { isInstalledBelowMinimum } from './version-compare';

const AUTH_AWAIT_TIMEOUT_MS = 10_000;

export type GateReason = 'minimum-version' | 'storage-format';

export type GateState =
  | { status: 'resolving' }
  | { status: 'clear' }
  | {
      status: 'blocked';
      reason: GateReason;
      installedVersion: string;
      requiredVersion: string | null;
      unrecognizedCount: number;
    };

/**
 * Owns the gate's three states, both triggers (local storage-format probe,
 * remote minimum-version check), and the freeze. The setter itself rejects
 * any transition after `freeze()` - the freeze is an invariant of the store,
 * not caller discipline, so a late remote verdict can never interrupt a
 * session that has already authenticated (R9).
 */
function createGateStore() {
  let current: GateState = { status: 'resolving' };
  let frozen = false;
  const { subscribe, set: rawSet } = writable<GateState>(current);

  function set(next: GateState): void {
    if (frozen) return;
    current = next;
    rawSet(next);
  }

  return {
    subscribe,
    set,
    get current(): GateState {
      return current;
    },
    freeze(): void {
      frozen = true;
    },
    resetForTest(): void {
      frozen = false;
      current = { status: 'resolving' };
      rawSet(current);
    },
  };
}

const gate = createGateStore();

/** Readable gate state for the block-screen wrapper to render against. */
export const gateState: Readable<GateState> = { subscribe: gate.subscribe };

let remoteSettled = false;
let remoteWaiters: Array<() => void> = [];

function settleRemote(): void {
  remoteSettled = true;
  const waiters = remoteWaiters;
  remoteWaiters = [];
  for (const resolve of waiters) resolve();
}

/** Test-only: reset all module-level gate and remote-wait state. */
export function resetGateForTest(): void {
  gate.resetForTest();
  remoteSettled = false;
  remoteWaiters = [];
}

/**
 * The remote half of the gate. Never awaited by `resolveGateAtLaunch` - it
 * settles into `gate` whenever it resolves, which may be well after launch
 * routing has already happened. Fail-open on any rejection (R4): an
 * unreachable endpoint never blocks on its own.
 */
async function resolveRemoteVerdict(installedVersion: string): Promise<void> {
  try {
    const update = await getMemoizedUpdateCheck();
    if (!update) {
      // `check()` resolving null means the installed build is at or above
      // the offered version, which under R13's cap means it is also at or
      // above the minimum - compatible, with no manifest to read.
      settleRemote();
      return;
    }

    // Route into `updateStatus` regardless of whether this update ends up
    // blocking the gate - this is what makes `UpdateAvailablePanel` render a
    // live install action on the block screen (R8).
    updateStatus.setStatus('available', {
      currentVersion: installedVersion,
      availableVersion: update.version,
      downloadProgress: 0,
    });

    const minimumRawValue = update.rawJson['minimum_compatible_version'];
    const minimumRaw = typeof minimumRawValue === 'string' ? minimumRawValue : null;
    if (minimumRaw === null) {
      settleRemote();
      return;
    }

    // R13: a minimum above the version this same manifest offers is
    // ignored - a mistyped or tampered value must never block with no
    // update available to fix it.
    if (isInstalledBelowMinimum(update.version, minimumRaw)) {
      settleRemote();
      return;
    }

    if (isInstalledBelowMinimum(installedVersion, minimumRaw)) {
      gate.set({
        status: 'blocked',
        reason: 'minimum-version',
        installedVersion,
        requiredVersion: minimumRaw,
        unrecognizedCount: 0,
      });
    }
    settleRemote();
  } catch (err) {
    console.error('[update-gate] remote compatibility check failed:', err);
    settleRemote();
  }
}

/**
 * Resolves the gate at cold launch. The local storage-format probe is on
 * the critical path and settles `gate` by itself; the remote check starts
 * concurrently and is never awaited here, so launch routing never sits on
 * the network (KTD6).
 */
export async function resolveGateAtLaunch(): Promise<void> {
  const installedVersion = await resolveInstalledVersion();

  let storageBlocked = false;
  let unrecognizedCount = 0;
  try {
    const report = await getStorageCompatibility();
    storageBlocked = !report.allRecognized;
    unrecognizedCount = report.unrecognizedCount;
  } catch (err) {
    // A failed probe is not itself a version problem, matching the
    // backend's own read-failure policy - never block on it.
    console.error('[update-gate] storage compatibility probe failed:', err);
  }

  if (storageBlocked) {
    gate.set({
      status: 'blocked',
      reason: 'storage-format',
      installedVersion,
      requiredVersion: null,
      unrecognizedCount,
    });
  } else {
    gate.set({ status: 'clear' });
  }

  void resolveRemoteVerdict(installedVersion);
}

/**
 * Awaited as the first statement inside every authentication path's try
 * block, ahead of any backend call. Resolves immediately once the remote
 * verdict has settled; otherwise waits under a bounded timeout and treats
 * expiry as fail-open, matching R4. Freezes the gate before returning so a
 * late remote verdict cannot flip mid-auth (R9).
 */
export async function awaitGateBeforeAuth(timeoutMs = AUTH_AWAIT_TIMEOUT_MS): Promise<'clear' | 'blocked'> {
  if (!remoteSettled) {
    await new Promise<void>((resolve) => {
      remoteWaiters.push(resolve);
      setTimeout(resolve, timeoutMs);
    });
  }
  const verdict = gate.current.status === 'blocked' ? 'blocked' : 'clear';
  // Commit before returning so a late remote cannot flip mid-auth (R9).
  gate.freeze();
  return verdict;
}

/**
 * Marks the gate verdict final. Idempotent with the freeze inside
 * `awaitGateBeforeAuth`; still called on auth success so the success path
 * documents R9 even when the await already committed. A remote verdict
 * arriving after freeze is never applied.
 */
export function freezeGate(): void {
  gate.freeze();
}
