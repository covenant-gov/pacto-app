#!/usr/bin/env node
/**
 * Branch-hashed dev port set (U3). Pure ESM, no deps beyond node: builtins so
 * the mapping is identical and hand-reproducible on macOS and Linux.
 *
 * `main` always resolves to index 0 and today's exact ports (1420/1421/9223).
 * Every other branch derives an index from an FNV-1a 32-bit hash of its
 * slug, then atomically claims it (see claimIndex below) and probes real
 * listeners before returning it, so two worktrees landing on the same index
 * never collide -- even when they resolve at the same instant and neither
 * has bound a socket yet.
 */

import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
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

// Shared across every worktree on this machine so two agents in two
// worktrees -- which is the whole point -- coordinate through the same
// claim set even though their sandbox roots live in different directories.
const DEFAULT_CLAIM_DIR = path.join(os.tmpdir(), 'pacto-dev-ports-claims');

// How long a claim is honored after being written even if the process that
// wrote it has already exited. See isClaimStale for why this exists: the
// process that resolves a port set is almost always short-lived (the
// Makefile's `node dev-ports.mjs --export` invocation prints its exports
// and exits in milliseconds) and exits long before the app it kicks off
// finishes compiling and actually binds a socket. 180s mirrors
// dev-world.sh's own PACTO_DEV_WORLD_APP_TIMEOUT default -- the
// orchestrator's own idea of how long a launch reasonably takes to bind and
// come up -- so a claim survives at least as long as a launch the
// orchestrator itself would still consider "in flight".
const DEFAULT_CLAIM_GRACE_MS = 180_000;

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

/** @param {string} claimDir @param {number} index @returns {string} */
function claimPath(claimDir, index) {
  return path.join(claimDir, `index-${index}.claim.json`);
}

/** @param {unknown} pid @returns {boolean} */
function isPidAlive(pid) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the pid exists but is owned by someone else -- still alive.
    return /** @type {NodeJS.ErrnoException} */ (err).code === 'EPERM';
  }
}

/**
 * True when a claim record on disk no longer reflects a real, in-flight
 * owner and the index can be handed to someone else.
 *
 * The recorded pid is whichever process called resolvePortSet. For the
 * common path -- the Makefile's `node dev-ports.mjs --export` -- that
 * process prints its exports and exits within milliseconds, long before the
 * `pnpm tauri dev` it kicked off finishes compiling and actually binds the
 * ports. So "is that pid alive" is not a usable *immediate* staleness
 * signal on that path: it would go stale within milliseconds of every
 * legitimate launch, right when the claim matters most. It only pays off
 * for a caller that itself stays alive for the sandbox's whole lifetime
 * (e.g. an in-process script that resolves ports and then awaits the app it
 * spawned) -- for that caller pid liveness is exact and never times out.
 *
 * So a claim is stale only when *both* signals say so: the recorded pid is
 * not alive, and the claim is older than the grace window that covers the
 * resolve -> bind gap for the short-lived-resolver path. Once an app has
 * really bound its ports, occupancy is re-verified for real by
 * allPortsFree()'s live socket probe regardless of what this file says, so
 * an over-eager reclaim here can never hand out a port that's genuinely in
 * use -- worst case it churns the claim file and the probe sends the taker
 * to the next index instead.
 *
 * @param {{ pid?: number, resolvedAt?: number }} record
 * @param {number} graceMs
 * @returns {boolean}
 */
function isClaimStale(record, graceMs) {
  if (isPidAlive(record.pid)) return false;
  const age = Date.now() - Number(record.resolvedAt);
  return !(Number.isFinite(age) && age >= 0 && age < graceMs);
}

/** @param {string} filePath @returns {Record<string, unknown> | null} */
function readClaim(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    // Missing, unreadable, or mid-write from a racing claimant.
    return null;
  }
}

/** @param {number} ms */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Re-read a claim that raced with a concurrent writer. An empty/partial
 * file is not "free to steal" -- unlinking it while the winner still holds
 * an open fd hands the same index to two processes.
 *
 * @param {string} filePath
 * @returns {Record<string, unknown> | null}
 */
function readClaimSettled(filePath) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const existing = readClaim(filePath);
    if (existing) return existing;
    try {
      fs.accessSync(filePath);
    } catch {
      return null; // gone between EEXIST and now
    }
    sleepSync(2);
  }
  return null;
}

/** @param {string} filePath @param {Record<string, unknown>} record */
function writeClaimExclusive(filePath, record) {
  // O_EXCL is what makes this atomic: of any number of processes racing to
  // create the same path, the OS guarantees exactly one open() succeeds.
  const fd = fs.openSync(filePath, 'wx');
  try {
    fs.writeSync(fd, JSON.stringify(record));
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Atomically claim `index` for the current process. Returns true iff this
 * call now owns the claim file for that index.
 *
 * A claim always succeeds when it doesn't exist yet, or when the existing
 * claim already belongs to this same branch -- re-resolving your own branch
 * (e.g. dev-world.sh's retry-on-dead-stream loop, which waits for the old
 * app to actually die and then calls `make dev-sandbox` a second time) must
 * reclaim its own deterministic index immediately, not sit out the grace
 * window, or a same-branch restart would silently jump to a different port
 * set. A claim held by a *different* branch is only taken over once
 * isClaimStale says so.
 *
 * @param {string} claimDir
 * @param {number} index
 * @param {string} branch
 * @param {number} graceMs
 * @returns {boolean}
 */
function claimIndex(claimDir, index, branch, graceMs) {
  fs.mkdirSync(claimDir, { recursive: true });
  const target = claimPath(claimDir, index);
  const record = { pid: process.pid, branch, resolvedAt: Date.now() };

  try {
    writeClaimExclusive(target, record);
    return true;
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'EEXIST') throw err;
  }

  const existing = readClaimSettled(target);
  if (!existing) {
    // Unreadable while the path still exists usually means a concurrent
    // winner is mid-write -- never unlink that. Only reclaim when the file
    // is old enough that a live writer cannot still be finishing.
    try {
      const st = fs.statSync(target);
      if (Date.now() - st.mtimeMs < graceMs) return false;
    } catch {
      /* already gone -- try create below */
    }
  } else {
    const ownedBySameBranch = existing.branch === branch;
    if (!ownedBySameBranch && !isClaimStale(existing, graceMs)) {
      return false; // live claim held by a different branch
    }
  }

  // Stale, ours, or an aged unreadable husk. Unlink is best-effort -- the
  // exclusive create decides the single winner.
  try {
    fs.unlinkSync(target);
  } catch {
    /* already gone */
  }

  try {
    writeClaimExclusive(target, record);
    return true;
  } catch (err) {
    // someone else won the takeover race
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'EEXIST') return false;
    throw err;
  }
}

/** @param {string} claimDir @param {number} index */
function releaseClaim(claimDir, index) {
  try {
    fs.unlinkSync(claimPath(claimDir, index));
  } catch {
    /* already gone */
  }
}

// Ports browsers refuse outright: the WHATWG fetch bad-port list (Chromium's
// ERR_UNSAFE_PORT, same list in WebKit), so a dev server bound to one serves
// curl fine while the webview silently renders a blank page. An index whose
// ports land here is unusable regardless of what the OS says about occupancy.
// With this file's bases and strides the only in-range hit is index 30
// (devServer 1720 -- H.323). Only the spec entries at or above this file's
// lowest derivable port (1420) are listed; extend downward if a base ever
// drops below that.
const UNSAFE_BROWSER_PORTS = new Set([
  1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6679, 6697, 10080,
]);

/**
 * True when every port this index derives is one a browser engine will
 * actually fetch from.
 * @param {number} index
 * @returns {boolean}
 */
export function browserSafeIndex(index) {
  const ports = portsForIndex(index);
  return (
    !UNSAFE_BROWSER_PORTS.has(ports.devServer) &&
    !UNSAFE_BROWSER_PORTS.has(ports.hmr) &&
    !UNSAFE_BROWSER_PORTS.has(ports.mcpBridge)
  );
}

/**
 * Resolve the port set for a branch. Derives the index, then skips any index
 * whose ports a browser refuses to fetch from, then (unless `probe: false`)
 * atomically claims it and confirms with real listeners that it's actually
 * free, advancing to the next index when any check fails. `main` never
 * advances -- its ports are pinned (and browser-safe by construction) so
 * `make dev` on `main` keeps behaving exactly as today.
 *
 * @param {{ branch?: string, probe?: boolean, maxIndex?: number, claimDir?: string, claimGraceMs?: number }} [options]
 * @returns {Promise<{ index: number, derivedIndex: number, advanced: boolean, ports: { devServer: number, hmr: number, mcpBridge: number } }>}
 */
export async function resolvePortSet({
  branch,
  probe = true,
  maxIndex = MAX_INDEX,
  claimDir = DEFAULT_CLAIM_DIR,
  claimGraceMs = DEFAULT_CLAIM_GRACE_MS,
} = {}) {
  const resolvedBranch = branch ?? defaultBranch();
  const derivedIndex = deriveIndex(resolvedBranch);

  if (!probe || resolvedBranch === MAIN_BRANCH) {
    let index = derivedIndex;
    if (resolvedBranch !== MAIN_BRANCH) {
      let attempts = 0;
      for (; !browserSafeIndex(index) && attempts <= maxIndex; attempts++) {
        index = index >= maxIndex ? 1 : index + 1;
      }
      if (!browserSafeIndex(index)) {
        throw new Error(
          `every port index from 1 to ${maxIndex} derives a browser-refused port; ` +
            `check UNSAFE_BROWSER_PORTS against the port bases and strides`
        );
      }
    }
    return {
      index,
      derivedIndex,
      advanced: index !== derivedIndex,
      ports: portsForIndex(index),
    };
  }

  let index = derivedIndex > maxIndex ? 1 + ((derivedIndex - 1) % maxIndex) : derivedIndex;
  for (let attempts = 0; attempts <= maxIndex; attempts++) {
    if (!browserSafeIndex(index)) {
      index = index >= maxIndex ? 1 : index + 1;
      continue;
    }
    const ports = portsForIndex(index);
    if (claimIndex(claimDir, index, resolvedBranch, claimGraceMs)) {
      if (await allPortsFree(ports)) {
        return { index, derivedIndex, advanced: index !== derivedIndex, ports };
      }
      // Something outside the claim system already holds these sockets
      // (or a prior, unmanaged run left them bound) -- we don't actually
      // own this index, so don't leave a phantom claim behind.
      releaseClaim(claimDir, index);
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
  const claimDirFlagIndex = args.indexOf('--claim-dir');
  const claimDir = claimDirFlagIndex >= 0 ? args[claimDirFlagIndex + 1] : undefined;

  const result = await resolvePortSet({ branch, probe, ...(claimDir ? { claimDir } : {}) });

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
