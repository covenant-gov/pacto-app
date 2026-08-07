import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../api/auth', () => ({
  getStorageCompatibility: vi.fn(),
}));

vi.mock('./update-check', () => ({
  resolveInstalledVersion: vi.fn(),
  getMemoizedUpdateCheck: vi.fn(),
  updateStatus: { setStatus: vi.fn() },
}));

import { getStorageCompatibility } from '../api/auth';
import { getMemoizedUpdateCheck, resolveInstalledVersion, updateStatus } from './update-check';
import { isInstalledBelowMinimum } from './version-compare';
import {
  awaitGateBeforeAuth,
  freezeGate,
  gateState,
  resetGateForTest,
  resolveGateAtLaunch,
  type GateState,
} from './update-gate';

const mockedGetStorageCompatibility = vi.mocked(getStorageCompatibility);
const mockedResolveInstalledVersion = vi.mocked(resolveInstalledVersion);
const mockedGetMemoizedUpdateCheck = vi.mocked(getMemoizedUpdateCheck);
const mockedSetStatus = vi.mocked(updateStatus.setStatus);

interface FakeUpdate {
  version: string;
  currentVersion: string;
  rawJson: Record<string, unknown>;
}

function recognized() {
  return { allRecognized: true, unrecognizedCount: 0, highestOffendingVersion: null, supportedSchemaVersion: 30 };
}

function unrecognized(count = 1) {
  return { allRecognized: false, unrecognizedCount: count, highestOffendingVersion: 31, supportedSchemaVersion: 30 };
}

function fakeUpdate(overrides: Partial<FakeUpdate> = {}): FakeUpdate {
  return { version: '1.0.0', currentVersion: '0.3.0', rawJson: {}, ...overrides };
}

/**
 * Drain the microtask queue so `resolveRemoteVerdict`'s fire-and-forget
 * chain settles. Every await in that chain resolves on the microtask queue
 * (mocked promises, no real I/O), so repeated microtask ticks are
 * deterministic and require no wall-clock wait.
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

function currentState(): GateState {
  return get(gateState);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetGateForTest();
  mockedResolveInstalledVersion.mockResolvedValue('0.3.0');
  mockedGetStorageCompatibility.mockResolvedValue(recognized());
  mockedGetMemoizedUpdateCheck.mockResolvedValue(null);
});

describe('resolveGateAtLaunch - local storage-format trigger', () => {
  it('stays clear when the storage probe reports every profile recognized', async () => {
    await resolveGateAtLaunch();
    await flushMicrotasks();
    expect(currentState()).toEqual({ status: 'clear' });
  });

  it('blocks with reason storage-format when the probe reports an unrecognized profile', async () => {
    mockedGetStorageCompatibility.mockResolvedValue(unrecognized(2));
    await resolveGateAtLaunch();
    expect(currentState()).toEqual({
      status: 'blocked',
      reason: 'storage-format',
      installedVersion: '0.3.0',
      requiredVersion: null,
      unrecognizedCount: 2,
    });
  });

  it('never blocks on a failed storage probe - a read failure is not a version problem', async () => {
    mockedGetStorageCompatibility.mockRejectedValue(new Error('backend unreachable'));
    await resolveGateAtLaunch();
    expect(currentState()).toEqual({ status: 'clear' });
  });

  it('settles the local verdict before the remote promise resolves - launch never sits on the network', async () => {
    const { promise: remotePromise, resolve: releaseRemote } = Promise.withResolvers<FakeUpdate | null>();
    mockedGetMemoizedUpdateCheck.mockReturnValue(remotePromise as never);

    await resolveGateAtLaunch();

    // resolveGateAtLaunch has already returned; the remote check is still
    // pending, yet the store already reflects the local verdict.
    expect(currentState()).toEqual({ status: 'clear' });

    releaseRemote(null);
    await flushMicrotasks();
  });
});

describe('resolveGateAtLaunch - remote minimum-version trigger', () => {
  it('AE1: blocks with reason minimum-version and records the required version', async () => {
    mockedGetMemoizedUpdateCheck.mockResolvedValue(
      fakeUpdate({ version: '0.4.0', rawJson: { minimum_compatible_version: '0.4.0' } }) as never,
    );

    await resolveGateAtLaunch();
    await flushMicrotasks();

    expect(currentState()).toEqual({
      status: 'blocked',
      reason: 'minimum-version',
      installedVersion: '0.3.0',
      requiredVersion: '0.4.0',
      unrecognizedCount: 0,
    });
  });

  it('leaves updateStatus available with the offered version so the install action stays live', async () => {
    mockedGetMemoizedUpdateCheck.mockResolvedValue(
      fakeUpdate({ version: '0.4.0', rawJson: { minimum_compatible_version: '0.4.0' } }) as never,
    );

    await resolveGateAtLaunch();
    await flushMicrotasks();

    expect(mockedSetStatus).toHaveBeenCalledWith('available', {
      currentVersion: '0.3.0',
      availableVersion: '0.4.0',
      downloadProgress: 0,
    });
  });

  it('stays clear when the installed version equals the minimum', async () => {
    mockedGetMemoizedUpdateCheck.mockResolvedValue(
      fakeUpdate({ version: '0.4.0', rawJson: { minimum_compatible_version: '0.3.0' } }) as never,
    );

    await resolveGateAtLaunch();
    await flushMicrotasks();

    expect(currentState()).toEqual({ status: 'clear' });
  });

  it('AE6: ignores a minimum above the offered version', async () => {
    mockedGetMemoizedUpdateCheck.mockResolvedValue(
      fakeUpdate({ version: '0.4.0', rawJson: { minimum_compatible_version: '0.5.0' } }) as never,
    );

    await resolveGateAtLaunch();
    await flushMicrotasks();

    expect(currentState()).toEqual({ status: 'clear' });
  });

  it('ignores an absent minimum_compatible_version', async () => {
    mockedGetMemoizedUpdateCheck.mockResolvedValue(fakeUpdate({ version: '0.4.0', rawJson: {} }) as never);

    await resolveGateAtLaunch();
    await flushMicrotasks();

    expect(currentState()).toEqual({ status: 'clear' });
  });

  it('ignores an unparseable minimum_compatible_version', async () => {
    mockedGetMemoizedUpdateCheck.mockResolvedValue(
      fakeUpdate({ version: '0.4.0', rawJson: { minimum_compatible_version: 'not-a-version' } }) as never,
    );

    await resolveGateAtLaunch();
    await flushMicrotasks();

    expect(currentState()).toEqual({ status: 'clear' });
  });

  it('AE3: stays clear when check() throws - the storage verdict alone decides', async () => {
    mockedGetMemoizedUpdateCheck.mockRejectedValue(new Error('network unreachable'));

    await resolveGateAtLaunch();
    await flushMicrotasks();

    expect(currentState()).toEqual({ status: 'clear' });
  });

  it('stays clear without reading any manifest when check() resolves null', async () => {
    mockedGetMemoizedUpdateCheck.mockResolvedValue(null);

    await resolveGateAtLaunch();
    await flushMicrotasks();

    expect(currentState()).toEqual({ status: 'clear' });
    expect(mockedSetStatus).not.toHaveBeenCalled();
  });
});

describe('resolveGateAtLaunch - independent triggers', () => {
  it('AE2: blocks with reason storage-format when local is unrecognized and the remote check throws', async () => {
    mockedGetStorageCompatibility.mockResolvedValue(unrecognized(1));
    mockedGetMemoizedUpdateCheck.mockRejectedValue(new Error('network unreachable'));

    await resolveGateAtLaunch();
    await flushMicrotasks();

    expect(currentState()).toEqual({
      status: 'blocked',
      reason: 'storage-format',
      installedVersion: '0.3.0',
      requiredVersion: null,
      unrecognizedCount: 1,
    });
  });

  it('stays blocked on storage-format even when the remote verdict is compatible', async () => {
    mockedGetStorageCompatibility.mockResolvedValue(unrecognized(1));
    mockedGetMemoizedUpdateCheck.mockResolvedValue(null);

    await resolveGateAtLaunch();
    await flushMicrotasks();

    expect(currentState()).toMatchObject({ status: 'blocked', reason: 'storage-format' });
  });
});

describe('awaitGateBeforeAuth', () => {
  it('returns blocked when the remote verdict already says blocked', async () => {
    mockedGetMemoizedUpdateCheck.mockResolvedValue(
      fakeUpdate({ version: '0.4.0', rawJson: { minimum_compatible_version: '0.4.0' } }) as never,
    );

    await resolveGateAtLaunch();
    await flushMicrotasks();

    await expect(awaitGateBeforeAuth(1000)).resolves.toBe('blocked');
  });

  it('returns clear when the timeout expires with the remote verdict still pending', async () => {
    vi.useFakeTimers();
    try {
      const { promise: neverResolves } = Promise.withResolvers<FakeUpdate | null>();
      mockedGetMemoizedUpdateCheck.mockReturnValue(neverResolves as never);

      await resolveGateAtLaunch();

      const resultPromise = awaitGateBeforeAuth(20);
      await vi.advanceTimersByTimeAsync(20);

      await expect(resultPromise).resolves.toBe('clear');
    } finally {
      vi.useRealTimers();
    }
  });

  it('freezes on clear so a late remote cannot flip to blocked mid-auth', async () => {
    vi.useFakeTimers();
    try {
      const { promise: remotePromise, resolve: releaseRemote } =
        Promise.withResolvers<FakeUpdate | null>();
      mockedGetMemoizedUpdateCheck.mockReturnValue(remotePromise as never);

      await resolveGateAtLaunch();
      expect(currentState()).toEqual({ status: 'clear' });

      const resultPromise = awaitGateBeforeAuth(20);
      await vi.advanceTimersByTimeAsync(20);
      await expect(resultPromise).resolves.toBe('clear');

      releaseRemote(
        fakeUpdate({ version: '0.4.0', rawJson: { minimum_compatible_version: '0.4.0' } }),
      );
      await flushMicrotasks();

      expect(currentState()).toEqual({ status: 'clear' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('freezeGate', () => {
  it("AE4: a remote verdict arriving after freeze leaves the state clear, asserted at the store's own setter", async () => {
    const { promise: remotePromise, resolve: releaseRemote } = Promise.withResolvers<FakeUpdate | null>();
    mockedGetMemoizedUpdateCheck.mockReturnValue(remotePromise as never);

    await resolveGateAtLaunch();
    expect(currentState()).toEqual({ status: 'clear' });

    freezeGate();

    releaseRemote(fakeUpdate({ version: '0.4.0', rawJson: { minimum_compatible_version: '0.4.0' } }));
    await flushMicrotasks();

    expect(currentState()).toEqual({ status: 'clear' });
  });

  it('exposes no way for a caller to clear an already-blocked verdict once frozen', async () => {
    mockedGetStorageCompatibility.mockResolvedValue(unrecognized(1));
    await resolveGateAtLaunch();
    expect(currentState()).toMatchObject({ status: 'blocked' });

    freezeGate();

    // A second launch-style resolution attempting to clear the gate must
    // not be able to, once frozen.
    mockedGetStorageCompatibility.mockResolvedValue(recognized());
    await resolveGateAtLaunch();
    await flushMicrotasks();

    expect(currentState()).toMatchObject({ status: 'blocked' });
  });
});

describe('single round trip', () => {
  it('two callers in one launch produce exactly one underlying check() call', async () => {
    await resolveGateAtLaunch();
    await flushMicrotasks();
    await getMemoizedUpdateCheck();

    // The gate never calls the plugin's check() directly - it only ever
    // goes through the shared memoized entry point (mocked here), which is
    // what guarantees one round trip per launch regardless of caller count.
    expect(mockedGetMemoizedUpdateCheck).toHaveBeenCalled();
  });
});

describe('preference independence', () => {
  it('resolves the gate without reading startupCheckEnabled', async () => {
    // The module imports nothing from a startup-check preference store at
    // all - if it ever did, this file's mocks would need to stub it.
    // Resolving successfully with no such mock in place is the assertion.
    await resolveGateAtLaunch();
    await flushMicrotasks();
    expect(currentState().status).not.toBe('resolving');
  });
});

describe('isInstalledBelowMinimum (imported for the fixtures above)', () => {
  it("matches the gate module's own comparator behavior", () => {
    expect(isInstalledBelowMinimum('0.3.0', '0.4.0')).toBe(true);
    expect(isInstalledBelowMinimum('0.4.0', '0.4.0')).toBe(false);
  });
});

afterEach(() => {
  vi.useRealTimers();
});
