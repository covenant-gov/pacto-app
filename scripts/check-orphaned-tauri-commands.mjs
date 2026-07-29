#!/usr/bin/env node
// Flags Tauri commands registered in `tauri::generate_handler![...]` that no
// frontend `invoke()` call ever references. rustc/clippy do not catch this:
// a command listed in `generate_handler!` counts as "used" from Rust's
// perspective even if the frontend never calls it, so a whole command +
// its backing loop/logic can ship dead with a clean `cargo build`.
//
// This is a heuristic text scan (regex over `invoke(...)` literals), not a
// full parse. It WILL mis-flag commands invoked only via dynamic command
// names, mobile-only code paths this scan doesn't reach, or npm-package
// internals. Triage each new hit by hand before concluding it's a real bug
// (see docs/solutions/workflow-issues/orphaned-relay-health-monitor-command.md).
//
// Ratchet, not a rewrite: `orphaned-tauri-commands-baseline.txt` grandfathers
// the commands that were already orphaned before this check existed. This
// script fails only on NEW orphans, so it catches the next `monitor_relay_
// connections`-style bug without blocking on unrelated existing debt.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const libRsPath = join(repoRoot, 'src-tauri/src/lib.rs');
const baselinePath = join(repoRoot, 'scripts/orphaned-tauri-commands-baseline.txt');

function extractRegisteredCommands(rustSource) {
  const match = rustSource.match(/tauri::generate_handler!\[([\s\S]*?)\]\)/);
  if (!match) {
    throw new Error('Could not find tauri::generate_handler![...] in src-tauri/src/lib.rs');
  }
  let body = match[1];
  body = body.replace(/^\s*#\[.*\]\s*$/gm, ''); // strip #[cfg(...)] attribute lines
  body = body.replace(/\/\/[^\n]*/g, ''); // strip line comments
  const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*(::[A-Za-z_][A-Za-z0-9_]*)*$/;
  const names = body
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && identifierPattern.test(s))
    .map((s) => s.split('::').pop());
  return new Set(names);
}

function walk(dir, out) {
  const skip = new Set(['node_modules', '.svelte-kit', 'dist', 'build']);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(ts|svelte|js)$/.test(entry.name)) out.push(p);
  }
}

function extractInvokedCommands(srcDir) {
  const files = [];
  walk(srcDir, files);
  const invoked = new Set();
  const pattern = /invoke(?:<[^>]*>)?\s*\(\s*['"]([a-zA-Z0-9_]+)['"]/g;
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    let m;
    while ((m = pattern.exec(content))) invoked.add(m[1]);
  }
  return invoked;
}

function readBaseline() {
  let raw;
  try {
    raw = readFileSync(baselinePath, 'utf8');
  } catch {
    return new Set();
  }
  return new Set(
    raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'))
  );
}

const registered = extractRegisteredCommands(readFileSync(libRsPath, 'utf8'));
const invoked = extractInvokedCommands(join(repoRoot, 'src'));
const baseline = readBaseline();

const orphaned = [...registered].filter((c) => !invoked.has(c)).sort();
const newOrphans = orphaned.filter((c) => !baseline.has(c));
const staleBaselineEntries = [...baseline].filter((c) => !orphaned.includes(c)).sort();

console.log(`Registered commands: ${registered.size}`);
console.log(`Orphaned (no frontend invoke() found): ${orphaned.length}`);
console.log(`Baselined (pre-existing, not gated): ${baseline.size}`);

if (staleBaselineEntries.length > 0) {
  console.log(
    `\nNote: ${staleBaselineEntries.length} baseline entries are no longer orphaned (now wired, or renamed/removed). Feel free to delete them from ${baselinePath}:`
  );
  for (const c of staleBaselineEntries) console.log(`  - ${c}`);
}

if (newOrphans.length === 0) {
  console.log('\nOK: no new orphaned Tauri commands.');
  process.exit(0);
}

console.error(
  `\nFAILED: ${newOrphans.length} Tauri command(s) are registered in generate_handler![...] but no frontend invoke() call references them:\n`
);
for (const c of newOrphans) console.error(`  - ${c}`);
console.error(
  `\nIf this command is genuinely wired only via a dynamic/indirect path this scan can't see, add it to ${baselinePath} with a one-line comment explaining why. Otherwise, add the missing invoke() call (see AGENTS.md > "Before adding a Tauri command").`
);
process.exit(1);
