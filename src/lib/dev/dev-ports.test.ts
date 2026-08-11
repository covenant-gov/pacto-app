import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  slugForBranch,
  deriveIndex,
  portsForIndex,
  resolvePortSet,
  readSandboxHandle,
} from '../../../scripts/dev-ports.mjs';

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

describe('dev-ports', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

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
  });

  describe('resolvePortSet', () => {
    it('main resolves to index 0 with today\'s exact ports, unprobed', async () => {
      const result = await resolvePortSet({ branch: 'main', probe: false });
      expect(result).toEqual({
        index: 0,
        derivedIndex: 0,
        advanced: false,
        ports: { devServer: 1420, hmr: 1421, mcpBridge: 9223 },
      });
    });

    it('claims the derived index untouched when its ports are free', async () => {
      const branch = 'feat/parallel-agent-sandboxes-wave-1';
      const result = await resolvePortSet({ branch, probe: true });
      expect(result.derivedIndex).toBe(12);
      expect(result.index).toBe(12);
      expect(result.advanced).toBe(false);
      expect(result.ports).toEqual(portsForIndex(12));
    });

    it('advances past an occupied derived index and reports advanced: true', async () => {
      const branch = 'fix/issue-237';
      const derivedIndex = deriveIndex(branch);
      const derivedPorts = portsForIndex(derivedIndex);

      const blocker = await listen(derivedPorts.devServer);
      try {
        const result = await resolvePortSet({ branch, probe: true });
        expect(result.derivedIndex).toBe(derivedIndex);
        expect(result.index).not.toBe(derivedIndex);
        expect(result.advanced).toBe(true);
        expect(result.ports).toEqual(portsForIndex(result.index));
      } finally {
        await close(blocker);
      }
    });

    it('throws naming the exhausted range when every candidate index is occupied', async () => {
      const branch = 'agent-worktree-b'; // derives to index 10
      const maxIndex = 2; // shrink the range so occupying 1 and 2 exhausts it
      const blockers = await Promise.all(
        [1, 2].map(index => listen(portsForIndex(index).devServer))
      );
      try {
        await expect(resolvePortSet({ branch, probe: true, maxIndex })).rejects.toThrow(/1\.\.=2/);
      } finally {
        await Promise.all(blockers.map(close));
      }
    });
  });

  describe('readSandboxHandle', () => {
    function makeTempDir(): string {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pacto-dev-ports-test-'));
      tempDirs.push(dir);
      return dir;
    }

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
