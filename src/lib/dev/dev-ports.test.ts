import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  slugForBranch,
  deriveIndex,
  portsForIndex,
  resolvePortSet,
  readSandboxHandle,
  browserSafeIndex,
} from '../../../scripts/dev-ports.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('../../../scripts/dev-ports.mjs', import.meta.url));

function listen(port: number): Promise<net.Server> {
  const { promise, resolve, reject } = Promise.withResolvers<net.Server>();
  const server = net.createServer();
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => resolve(server));
  return promise;
}

function close(server: net.Server): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  server.close(() => resolve());
  return promise;
}

type PortSetResult = {
  index: number;
  derivedIndex: number;
  advanced: boolean;
  ports: { devServer: number; hmr: number; mcpBridge: number };
};

/** Runs the real CLI as its own OS process -- genuine cross-process concurrency. */
function runDevPortsCli(branch: string, claimDir: string): Promise<PortSetResult> {
  const { promise, resolve, reject } = Promise.withResolvers<PortSetResult>();
  const child = spawn(process.execPath, [SCRIPT_PATH, '--branch', branch, '--claim-dir', claimDir], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => (stdout += chunk));
  child.stderr.on('data', chunk => (stderr += chunk));
  child.on('error', reject);
  child.on('close', code => {
    if (code !== 0) {
      reject(new Error(`dev-ports.mjs --branch ${branch} exited ${code}: ${stderr}`));
      return;
    }
    try {
      resolve(JSON.parse(stdout.trim()));
    } catch {
      reject(new Error(`dev-ports.mjs --branch ${branch} produced unparseable output: ${stdout}`));
    }
  });
  return promise;
}

describe('dev-ports', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTempDir(prefix = 'pacto-dev-ports-test-'): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  describe('deriveIndex', () => {
    it('is stable across repeated derivations of the same branch', () => {
      const branch = 'feat/parallel-agent-sandboxes-wave-1';
      const first = deriveIndex(branch);
      const second = deriveIndex(branch);
      expect(first).toBe(second);
    });

    it('yields different, pinned indexes for two real branch names', () => {
      // Pinned so a change to the hash/mapping is caught, not just
      // self-consistency.
      expect(deriveIndex('feat/parallel-agent-sandboxes-wave-1')).toBe(12);
      expect(deriveIndex('fix/issue-237')).toBe(17);
    });

    it('main always maps to index 0', () => {
      expect(deriveIndex('main')).toBe(0);
    });

    it('is stable for a fixed slug regardless of platform (pinned cross-platform value)', () => {
      // FNV-1a 32-bit is pure arithmetic with no platform-dependent
      // rounding or locale sensitivity, so this value must hold on both
      // macOS and Linux CI runners.
      expect(deriveIndex('agent-worktree-a')).toBe(26);
    });

    it('derives without error for a branch name containing slashes and dots', () => {
      expect(() => deriveIndex('feature/dev.ports-v2/final')).not.toThrow();
      expect(slugForBranch('feature/dev.ports-v2/final')).toBe('feature-dev.ports-v2-final');
      expect(deriveIndex('feature/dev.ports-v2/final')).toBe(19);
    });
  });

  describe('portsForIndex', () => {
    it('main (index 0) yields today\'s exact port values', () => {
      expect(portsForIndex(0)).toEqual({ devServer: 1420, hmr: 1421, mcpBridge: 9223 });
    });

    it('spaces devServer/hmr by 10 and mcpBridge by 100 per index', () => {
      expect(portsForIndex(3)).toEqual({ devServer: 1450, hmr: 1451, mcpBridge: 9523 });
    });

    it('index 30 lands on the browser unsafe-port blocklist (devServer 1720)', () => {
      // Chromium refuses 1720 with ERR_UNSAFE_PORT and WebKit blocks the same
      // fetch-spec list, so a dev server bound there serves curl fine while
      // the webview renders a blank page.
      expect(portsForIndex(30)).toEqual({ devServer: 1720, hmr: 1721, mcpBridge: 12223 });
      expect(browserSafeIndex(30)).toBe(false);
      expect(browserSafeIndex(29)).toBe(true);
      expect(browserSafeIndex(31)).toBe(true);
      expect(browserSafeIndex(0)).toBe(true);
    });
  });

  describe('resolvePortSet', () => {
    it('main resolves to index 0 with today\'s exact ports, unprobed, and claims nothing', async () => {
      const claimDir = makeTempDir();
      const result = await resolvePortSet({ branch: 'main', probe: false, claimDir });
      expect(result).toEqual({
        index: 0,
        derivedIndex: 0,
        advanced: false,
        ports: { devServer: 1420, hmr: 1421, mcpBridge: 9223 },
      });
      // main never probes and never claims -- no claim directory is even
      // created for it.
      expect(fs.existsSync(claimDir) && fs.readdirSync(claimDir).length > 0).toBe(false);
    });

    it('claims the derived index untouched when its ports are free', async () => {
      const claimDir = makeTempDir();
      const branch = 'feat/parallel-agent-sandboxes-wave-1';
      const result = await resolvePortSet({ branch, probe: true, claimDir });
      expect(result.derivedIndex).toBe(12);
      expect(result.index).toBe(12);
      expect(result.advanced).toBe(false);
      expect(result.ports).toEqual(portsForIndex(12));
    });

    it('advances a branch deriving the browser-unsafe index 30, probed or not', async () => {
      // Find a real branch name that hashes onto the poisoned index. Bounded
      // so a hash or range change fails the assertion instead of hanging the
      // worker (a synchronous loop outlives vitest's testTimeout).
      let n = 0;
      while (n < 10_000 && deriveIndex(`unsafe-probe-${n}`) !== 30) n++;
      const branch = `unsafe-probe-${n}`;
      expect(deriveIndex(branch)).toBe(30);

      const unprobed = await resolvePortSet({ branch, probe: false });
      expect(unprobed.derivedIndex).toBe(30);
      expect(unprobed.index).toBe(31);
      expect(unprobed.advanced).toBe(true);

      const claimDir = makeTempDir();
      const probed = await resolvePortSet({ branch, probe: true, claimDir });
      expect(probed.index).not.toBe(30);
      expect(browserSafeIndex(probed.index)).toBe(true);
      // The unusable index must not be claimed on the way past.
      expect(fs.existsSync(path.join(claimDir, 'index-30.claim.json'))).toBe(false);
    });

    it('advances past an occupied derived index and reports advanced: true', async () => {
      const claimDir = makeTempDir();
      const branch = 'fix/issue-237';
      const derivedIndex = deriveIndex(branch);
      const derivedPorts = portsForIndex(derivedIndex);

      const blocker = await listen(derivedPorts.devServer);
      try {
        const result = await resolvePortSet({ branch, probe: true, claimDir });
        expect(result.derivedIndex).toBe(derivedIndex);
        expect(result.index).not.toBe(derivedIndex);
        expect(result.advanced).toBe(true);
        expect(result.ports).toEqual(portsForIndex(result.index));
      } finally {
        await close(blocker);
      }
    });

    it('throws naming the exhausted range when every candidate index is occupied', async () => {
      const claimDir = makeTempDir();
      const branch = 'agent-worktree-b'; // derives to index 10
      const maxIndex = 2; // shrink the range so occupying 1 and 2 exhausts it
      const blockers = await Promise.all(
        [1, 2].map(index => listen(portsForIndex(index).devServer))
      );
      try {
        await expect(resolvePortSet({ branch, probe: true, maxIndex, claimDir })).rejects.toThrow(
          /1\.\.=2/
        );
      } finally {
        await Promise.all(blockers.map(close));
      }
    });

    it('does not steal a live claim held by a different branch, and advances past it', async () => {
      const claimDir = makeTempDir();
      const branch = 'agent-worktree-a'; // derives to index 26
      const index = deriveIndex(branch);
      fs.mkdirSync(claimDir, { recursive: true });
      fs.writeFileSync(
        path.join(claimDir, `index-${index}.claim.json`),
        JSON.stringify({ pid: process.pid, branch: 'someone-elses-branch', resolvedAt: Date.now() })
      );

      const result = await resolvePortSet({ branch, probe: true, claimDir });
      expect(result.index).not.toBe(index);
      expect(result.advanced).toBe(true);
    });

    it('reclaims a stale claim left by a dead process instead of poisoning the index forever', async () => {
      const claimDir = makeTempDir();
      const branch = 'agent-worktree-a'; // derives to index 26
      const index = deriveIndex(branch);
      fs.mkdirSync(claimDir, { recursive: true });
      // A pid that cannot possibly be alive, recorded by a different branch,
      // with a grace window so short that "just resolved" cannot save it --
      // this is what a sandbox left behind by a SIGKILL (or a dev-world-
      // reclaim run, which only ever kills the app pid and never touches
      // this claim file) looks like well after the fact.
      fs.writeFileSync(
        path.join(claimDir, `index-${index}.claim.json`),
        JSON.stringify({
          pid: 999999999,
          branch: 'a-completely-different-branch',
          resolvedAt: Date.now() - 60_000,
        })
      );

      const result = await resolvePortSet({ branch, probe: true, claimDir, claimGraceMs: 1 });
      expect(result.index).toBe(index);
      expect(result.advanced).toBe(false);
      expect(result.ports).toEqual(portsForIndex(index));

      // The index is takeable again by yet another later run too -- the
      // claim was replaced, not permanently wedged.
      const claimAfter = JSON.parse(
        fs.readFileSync(path.join(claimDir, `index-${index}.claim.json`), 'utf8')
      );
      expect(claimAfter.pid).toBe(process.pid);
    });

    it(
      'never hands the same index to two concurrently-resolving sandboxes',
      async () => {
        const claimDir = makeTempDir();
        // Eight distinct branch names that really do hash-collide onto the
        // same starting index -- the exact "two launches racing the same
        // branch index" scenario from the bug report, just with eight
        // racers instead of two. If this ever stops being a real collision
        // (e.g. the hash changes), the assertion below catches it instead
        // of silently testing nothing.
        const branches = [
          'agent-worktree-collide-21',
          'agent-worktree-collide-59',
          'agent-worktree-collide-81',
          'agent-worktree-collide-95',
          'agent-worktree-collide-134',
          'agent-worktree-collide-142',
          'agent-worktree-collide-154',
          'agent-worktree-collide-178',
        ];
        const derived = new Set(branches.map(deriveIndex));
        expect(derived.size).toBe(1);

        // Real OS-process concurrency, not same-process Promise.all: each
        // branch resolves in its own `node dev-ports.mjs` invocation, just
        // like the Makefile spawns one per `make dev-sandbox` call.
        const results = await Promise.all(branches.map(branch => runDevPortsCli(branch, claimDir)));

        const indices = results.map(r => r.index);
        expect(new Set(indices).size).toBe(branches.length);
        for (const result of results) {
          expect(result.ports).toEqual(portsForIndex(result.index));
        }
      },
      30_000
    );
  });

  describe('readSandboxHandle', () => {
    it('returns null when no handle file exists', () => {
      const dir = makeTempDir();
      expect(readSandboxHandle(dir)).toBeNull();
    });

    it('round-trips a written handle', () => {
      const dir = makeTempDir();
      const handle = {
        version: 1,
        portIndex: 3,
        ports: { devServer: 1450, hmr: 1451, mcpBridge: 9523 },
        sandboxRoot: dir,
        relayEndpoints: ['wss://localhost:7001'],
        chainEndpoint: 'http://localhost:8545',
        manifestPath: null,
        npub: null,
        pid: 12345,
        updatedAt: '2026-08-10T00:00:00Z',
      };
      fs.writeFileSync(path.join(dir, 'sandbox-handle.json'), JSON.stringify(handle));

      expect(readSandboxHandle(dir)).toEqual(handle);
    });
  });
});
