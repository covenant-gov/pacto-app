#!/usr/bin/env node
/**
 * Branch-hashed dev port set (U3). Pure ESM, no deps beyond node:net so the
 * mapping is identical and hand-reproducible on macOS and Linux.
 *
 * `main` always resolves to index 0 and today's exact ports (1420/1421/9223).
 * Every other branch derives an index from an FNV-1a 32-bit hash of its
 * slug, then probes real listeners before claiming it so two worktrees
 * landing on the same index never collide.
 */

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAIN_BRANCH = 'main';

// Index range is 0..=31: 0 is reserved for main, 1..31 for everyone else.
const MAX_INDEX = 31;

const BASE_DEV_SERVER = 1420;
const BASE_HMR = 1421;
// The MCP bridge plugin scans forward up to 100 ports from its base, so a
// tighter stride would let two sandboxes' bridges collide.
const BASE_MCP_BRIDGE = 9223;
const PORT_STRIDE = 10;
const BRIDGE_STRIDE = 100;

const HANDLE_FILE_NAME = 'sandbox-handle.json';

/**
 * Branch name -> filesystem/URL-safe slug.
 * @param {string} branch
 * @returns {string}
 */
export function slugForBranch(branch) {
  return String(branch).replace(/[^A-Za-z0-9_.-]/g, '-');
}

/** @param {string} str @returns {number} */
function fnv1a32(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic 0..=31 index for a branch name. `main` always maps to 0.
 * @param {string} branch
 * @returns {number}
 */
export function deriveIndex(branch) {
  if (branch === MAIN_BRANCH) return 0;
  const slug = slugForBranch(branch);
  return 1 + (fnv1a32(slug) % MAX_INDEX);
}

/**
 * Index -> the three ports a worktree needs.
 * @param {number} index
 * @returns {{ devServer: number, hmr: number, mcpBridge: number }}
 */
export function portsForIndex(index) {
  return {
    devServer: BASE_DEV_SERVER + index * PORT_STRIDE,
    hmr: BASE_HMR + index * PORT_STRIDE,
    mcpBridge: BASE_MCP_BRIDGE + index * BRIDGE_STRIDE,
  };
}

/** @param {number} port @returns {Promise<boolean>} */
function isPortFree(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

/** @param {{ devServer: number, hmr: number, mcpBridge: number }} ports @returns {Promise<boolean>} */
async function allPortsFree(ports) {
  const [devServer, hmr, mcpBridge] = await Promise.all([
    isPortFree(ports.devServer),
    isPortFree(ports.hmr),
    isPortFree(ports.mcpBridge),
  ]);
  return devServer && hmr && mcpBridge;
}

function defaultBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'detached';
  }
}

/**
 * Resolve the port set for a branch. Derives the index, then (unless
 * `probe: false`) binds real listeners to confirm every port is free,
 * advancing to the next index on occupancy. `main` never advances — its
 * ports are pinned so `make dev` on `main` keeps behaving exactly as today.
 *
 * @param {{ branch?: string, probe?: boolean, maxIndex?: number }} [options]
 * @returns {Promise<{ index: number, derivedIndex: number, advanced: boolean, ports: { devServer: number, hmr: number, mcpBridge: number } }>}
 */
export async function resolvePortSet({ branch, probe = true, maxIndex = MAX_INDEX } = {}) {
  const resolvedBranch = branch ?? defaultBranch();
  const derivedIndex = deriveIndex(resolvedBranch);

  if (!probe || resolvedBranch === MAIN_BRANCH) {
    return {
      index: derivedIndex,
      derivedIndex,
      advanced: false,
      ports: portsForIndex(derivedIndex),
    };
  }

  let index = derivedIndex > maxIndex ? 1 + ((derivedIndex - 1) % maxIndex) : derivedIndex;
  for (let attempts = 0; attempts <= maxIndex; attempts++) {
    const ports = portsForIndex(index);
    if (await allPortsFree(ports)) {
      return { index, derivedIndex, advanced: index !== derivedIndex, ports };
    }
    index = index >= maxIndex ? 1 : index + 1;
  }

  throw new Error(
    `dev-ports: every index in 1..=${maxIndex} is occupied (started from ${derivedIndex} for branch "${resolvedBranch}"); ` +
      `tried devServer ${BASE_DEV_SERVER + PORT_STRIDE}-${BASE_DEV_SERVER + PORT_STRIDE * maxIndex}, ` +
      `hmr ${BASE_HMR + PORT_STRIDE}-${BASE_HMR + PORT_STRIDE * maxIndex}, ` +
      `mcpBridge ${BASE_MCP_BRIDGE + BRIDGE_STRIDE}-${BASE_MCP_BRIDGE + BRIDGE_STRIDE * maxIndex}`
  );
}

/**
 * Parsed sandbox handle, or `null` when the sandbox root has none yet.
 * @param {string} sandboxRoot
 * @returns {Record<string, unknown> | null}
 */
export function readSandboxHandle(sandboxRoot) {
  try {
    const raw = fs.readFileSync(path.join(sandboxRoot, HANDLE_FILE_NAME), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function cli() {
  const args = process.argv.slice(2);
  const branchFlagIndex = args.indexOf('--branch');
  const branch = branchFlagIndex >= 0 ? args[branchFlagIndex + 1] : undefined;
  const probe = !args.includes('--no-probe');

  const result = await resolvePortSet({ branch, probe });

  if (args.includes('--export')) {
    console.log(`export PACTO_DEV_PORT_INDEX=${result.index}`);
    console.log(`export PACTO_DEV_PORT=${result.ports.devServer}`);
    console.log(`export PACTO_DEV_HMR_PORT=${result.ports.hmr}`);
    console.log(`export PACTO_MCP_BRIDGE_PORT=${result.ports.mcpBridge}`);
    return;
  }

  // Default to JSON even without --json; there is no other CLI output mode.
  console.log(JSON.stringify(result));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  cli().catch(err => {
    console.error(`dev-ports: ${err.message}`);
    process.exit(1);
  });
}
