#!/usr/bin/env node
/**
 * Phase 2 real-Tauri end-to-end harness.
 *
 * Runs the Tauri debug binary with an isolated sandbox directory, starts the
 * Hypothesi MCP server, and executes the e2e spec via MCP tools. Artifacts
 * (screenshots, Rust logs, webview console logs) are saved under
 * test-results/tauri-e2e/<run-id>/.
 *
 * A `cargo build` debug binary always has tauri's `dev` cfg set, so its webview
 * loads the compiled-in `build.devUrl` and ignores `frontendDist`. The harness
 * therefore serves the static build on that URL's port itself; that port is
 * baked into the binary and cannot be derived per run.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolvePortSet, readSandboxHandle } from './dev-ports.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const sandboxRoot = path.join(repoRoot, 'test_sandbox', runId);
const resultsDir = path.join(repoRoot, 'test-results', 'tauri-e2e', runId);

function log(...args) {
  console.log(`[run-e2e-tauri]`, ...args);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let tauriLogs = { out: [], err: [] };
let tauriExit = null;

async function waitForPort(port, timeoutMs = 30000) {
  const start = Date.now();
  let lastError = 'no attempt made';
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => {
          socket.destroy();
          resolve();
        });
        socket.on('error', err => {
          lastError = err.message;
          reject(err);
        });
        setTimeout(() => {
          socket.destroy();
          reject(new Error('timeout'));
        }, 1000);
      });
      return;
    } catch {
      if (tauriExit) {
        log('last MCP bridge port probe error:', lastError);
        log('tauri stderr tail:', tauriLogs.err.slice(-10).join(''));
        log('tauri stdout tail:', tauriLogs.out.slice(-10).join(''));
        log('tauri process state:', tauriExit);
        throw new Error(
          `Tauri process exited before MCP bridge port ${port} was ready: ${JSON.stringify(tauriExit)}`,
        );
      }
      await sleep(250);
    }
  }
  log('last MCP bridge port probe error:', lastError);
  log('tauri stderr tail:', tauriLogs.err.slice(-10).join(''));
  log('tauri stdout tail:', tauriLogs.out.slice(-10).join(''));
  throw new Error(`MCP bridge port ${port} did not become ready within ${timeoutMs}ms`);
}

async function waitForSandboxHandle(root, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const handle = readSandboxHandle(root);
    if (handle) return handle;
    if (tauriExit) {
      log('tauri stderr tail:', tauriLogs.err.slice(-10).join(''));
      log('tauri stdout tail:', tauriLogs.out.slice(-10).join(''));
      log('tauri process state:', tauriExit);
      throw new Error(
        `Tauri process exited before writing a sandbox handle: ${JSON.stringify(tauriExit)}`,
      );
    }
    await sleep(250);
  }
  log('tauri stderr tail:', tauriLogs.err.slice(-10).join(''));
  log('tauri stdout tail:', tauriLogs.out.slice(-10).join(''));
  log('tauri process state:', tauriExit ?? 'still running (no exit/error observed)');
  throw new Error(`sandbox handle at ${root} did not appear within ${timeoutMs}ms`);
}

/** Port of the `build.devUrl` compiled into the debug binary. */
function devUrlPort() {
  const conf = JSON.parse(readFileSync(path.join(repoRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  return Number(new URL(conf.build.devUrl).port || 80);
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

/** SPA-fallback static server over `distDir`. Resolves `null` if the port is already served. */
async function startFrontendServer(distDir, port) {
  const alreadyServed = await new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 500);
  });
  if (alreadyServed) {
    log(`frontend port ${port} already served; reusing it`);
    return null;
  }

  const server = http.createServer((req, res) => {
    const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let filePath = path.join(distDir, requested);
    if (!filePath.startsWith(distDir) || !existsSync(filePath) || requested.endsWith('/')) {
      filePath = path.join(distDir, 'index.html');
    }
    try {
      const body = readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  log(`serving ${distDir} on http://localhost:${port}`);
  return server;
}

function saveArtifact(name, data) {
  const filePath = path.join(resultsDir, name);
  writeFileSync(filePath, data);
  log(`artifact saved: ${filePath}`);
  return filePath;
}

async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.find(c => c.type === 'text')?.text;
  if (!text) return null;
  // The MCP server appends a "\n\n[Executed in window: ...]" footer to
  // webview_execute_js results. Strip it before trying JSON so callers get
  // the real payload.
  const payload = text.split('\n\n[Executed in window:')[0];
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

async function main() {
  mkdirSync(sandboxRoot, { recursive: true });
  mkdirSync(resultsDir, { recursive: true });

  const binaryName = process.platform === 'win32' ? 'pacto.exe' : 'pacto';
  const defaultBinaryPath = path.join(repoRoot, 'src-tauri', 'target', 'debug', binaryName);
  const binaryPath = process.env.PACTO_TAURI_BINARY || defaultBinaryPath;
  if (!existsSync(binaryPath)) {
    throw new Error(`Debug binary not found at ${binaryPath}. Run 'cargo build' in src-tauri or set PACTO_TAURI_BINARY.`);
  }

  const portSet = await resolvePortSet({ branch: runId, probe: true });
  log('resolved port set', portSet);

  const env = {
    ...process.env,
    PACTO_TEST_SANDBOX_ROOT: sandboxRoot,
    PACTO_ALLOW_TEST_AUTH: '1',
    PACTO_DEV_PORT_INDEX: String(portSet.index),
    PACTO_DEV_PORT: String(portSet.ports.devServer),
    PACTO_DEV_HMR_PORT: String(portSet.ports.hmr),
    PACTO_MCP_BRIDGE_PORT: String(portSet.ports.mcpBridge),
    // These must be set in the parent before spawn: GTK/WebKitGTK constructors
    // run at .so load, before Rust `run()` can call set_var.
    NO_AT_BRIDGE: '1',
    GDK_BACKEND: 'x11',
    LIBGL_ALWAYS_SOFTWARE: '1',
    WEBKIT_DISABLE_DMABUF_RENDERER: '1',
    WEBKIT_DISABLE_COMPOSITING_MODE: '1',
  };

  const frontendDist = path.join(repoRoot, 'build');
  if (!existsSync(frontendDist)) {
    throw new Error(`Frontend build not found at ${frontendDist}. Run 'pnpm build' first.`);
  }

  const frontendServer = await startFrontendServer(frontendDist, devUrlPort());

  log('launching Tauri binary', binaryPath);
  const tauri = spawn(binaryPath, [], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  tauri.stdout.on('data', d => tauriLogs.out.push(d.toString()));
  tauri.stderr.on('data', d => tauriLogs.err.push(d.toString()));
  tauri.on('exit', (code, signal) => {
    tauriExit = { code, signal };
    log('tauri process exited', tauriExit);
  });
  tauri.on('error', err => {
    tauriExit = { spawnError: err.message };
    log('tauri process spawn error:', err.message);
  });

  const cleanup = async (exitCode = 1) => {
    log('cleaning up...');
    if (client) {
      try {
        await callTool(client, 'driver_session', { action: 'stop' }).catch(() => {});
      } catch {
        // ignore
      }
    }
    tauri.kill('SIGTERM');
    await sleep(1000);
    if (!tauri.killed) tauri.kill('SIGKILL');
    if (frontendServer) frontendServer.close();

    try {
      saveArtifact('tauri-stdout.log', tauriLogs.out.join(''));
      saveArtifact('tauri-stderr.log', tauriLogs.err.join(''));
    } catch (e) {
      log('failed to save logs:', e.message);
    }

    try {
      rmSync(sandboxRoot, { recursive: true, force: true });
      log('sandbox removed:', sandboxRoot);
    } catch (e) {
      log('failed to remove sandbox:', e.message);
    }

    process.exit(exitCode);
  };

  process.on('SIGINT', () => cleanup(1));
  process.on('SIGTERM', () => cleanup(1));

  let client;
  try {
    log('waiting for sandbox handle at', sandboxRoot);
    const handle = await waitForSandboxHandle(sandboxRoot);
    const bridgePort = handle.ports.mcpBridge;
    log('sandbox handle ready; MCP bridge bound at', bridgePort);
    await waitForPort(bridgePort);

    log('starting Hypothesi MCP server');
    // Use the lockfile-pinned local install. `npx -y` can resolve a different
    // published version than CI's pnpm install.
    const mcpServerEntry = path.join(
      repoRoot,
      'node_modules',
      '@hypothesi',
      'tauri-mcp-server',
      'dist',
      'index.js',
    );
    if (!existsSync(mcpServerEntry)) {
      throw new Error(
        `Hypothesi MCP server not found at ${mcpServerEntry}. Run 'pnpm install' first.`,
      );
    }
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [mcpServerEntry],
      env,
    });
    client = new Client({ name: 'pacto-e2e', version: '0.1.0' });
    await client.connect(transport);

    log('starting driver session');
    const sessionResult = await callTool(client, 'driver_session', { action: 'start', port: bridgePort });
    log('driver_session result:', sessionResult);

    const statusResult = await callTool(client, 'driver_session', { action: 'status' });
    log('driver_session status:', statusResult);
    if (!statusResult?.connected) {
      throw new Error(`MCP driver session did not connect; status=${JSON.stringify(statusResult)}`);
    }

    // Wait until the webview has loaded the Tauri IPC bridge.
    log('waiting for webview __TAURI__');
    const tauriReadyDeadline = Date.now() + 30_000;
    let tauriReady = false;
    while (Date.now() < tauriReadyDeadline) {
      try {
        const probe = await callTool(client, 'webview_execute_js', {
          script: '(() => !!(window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke))()',
          windowId: 'main',
        });
        const ready =
          probe === true ||
          probe?.data === true ||
          (typeof probe === 'object' && probe?.success !== false && probe?.data === true);
        if (ready) {
          tauriReady = true;
          break;
        }
      } catch {
        // webview may not be ready yet
      }
      await sleep(250);
    }
    if (!tauriReady) {
      throw new Error('webview __TAURI__.core.invoke was not ready within 30s');
    }
    log('webview __TAURI__ ready');

    const specPath = path.join(repoRoot, 'e2e-tauri', 'message-send.spec.mjs');
    if (!existsSync(specPath)) {
      throw new Error(`Spec not found: ${specPath}`);
    }
    const { run } = await import(specPath);
    if (typeof run !== 'function') {
      throw new Error(`Spec must export a run function`);
    }

    await run({
      callTool: (name, args) => callTool(client, name, args),
      saveArtifact,
      sandboxRoot,
    });

    log('spec passed');
    await cleanup(0);
  } catch (error) {
    log('error:', error.message);
    console.error(error);
    await cleanup(1);
  }
}

main().catch(error => {
  log('fatal error:', error.message);
  console.error(error);
  process.exit(1);
});
