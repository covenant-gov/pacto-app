#!/usr/bin/env node
/**
 * Phase 2 real-Tauri end-to-end harness.
 *
 * Runs the Tauri debug binary with an isolated sandbox directory, starts the
 * Hypothesi MCP server, and executes the e2e spec via MCP tools. Artifacts
 * (screenshots, Rust logs, webview console logs) are saved under
 * test-results/tauri-e2e/<run-id>/.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const sandboxRoot = path.join(repoRoot, 'test_sandbox', runId);
const resultsDir = path.join(repoRoot, 'test-results', 'tauri-e2e', runId);

const MCP_BRIDGE_PORT = 9223;

function log(...args) {
  console.log(`[run-e2e-tauri]`, ...args);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForPort(port, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => {
          socket.destroy();
          resolve();
        });
        socket.on('error', reject);
        setTimeout(() => {
          socket.destroy();
          reject(new Error('timeout'));
        }, 1000);
      });
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`MCP bridge port ${port} did not become ready within ${timeoutMs}ms`);
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

  const env = {
    ...process.env,
    PACTO_TEST_SANDBOX_ROOT: sandboxRoot,
    PACTO_ALLOW_TEST_AUTH: '1',
  };

  const frontendDist = path.join(repoRoot, 'build');
  if (!existsSync(frontendDist)) {
    throw new Error(`Frontend build not found at ${frontendDist}. Run 'pnpm build' first.`);
  }

  log('launching Tauri binary', binaryPath);
  const tauri = spawn(binaryPath, [], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const tauriLogs = { out: [], err: [] };
  tauri.stdout.on('data', d => tauriLogs.out.push(d.toString()));
  tauri.stderr.on('data', d => tauriLogs.err.push(d.toString()));

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
    log('waiting for MCP bridge on port', MCP_BRIDGE_PORT);
    await waitForPort(MCP_BRIDGE_PORT);

    log('starting Hypothesi MCP server');
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', '@hypothesi/tauri-mcp-server'],
      env,
    });
    client = new Client({ name: 'pacto-e2e', version: '0.1.0' });
    await client.connect(transport);

    log('starting driver session');
    const sessionResult = await callTool(client, 'driver_session', { action: 'start', port: MCP_BRIDGE_PORT });
    log('driver_session result:', sessionResult);

    // Give the webview a moment to load before driving it. The MCP server will
    // wait for the webview to be ready, but a short pause helps on slower hosts.
    log('waiting for webview load');
    await sleep(3000);

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
