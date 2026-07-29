---
title: Relay health-check loop never started because monitor_relay_connections was never invoked from the frontend
date: 2026-07-29
category: docs/solutions/logic-errors
module: nostr-relay-health-monitor
problem_type: logic_error
component: development_workflow
symptoms:
  - "Every relay in Settings > Nostr > relay detail panel shows 'Not yet checked' permanently, even after minutes of uptime and successful message sync."
  - "RelayMetrics.ping_ms and RelayMetrics.last_check stay None/null forever; hasRelayHealthData(metrics) is always false."
root_cause: missing_workflow_step
resolution_type: code_fix
severity: medium
tags: [tauri, invoke, dead-code, relay-health, generate_handler, planning-verification, ci-ratchet]
---

# Relay health-check loop never started because monitor_relay_connections was never invoked from the frontend

## Problem

The Settings > Nostr relay detail panel (built on branch `feat/relay-health-detail`) always rendered "Not yet checked" for every relay, no matter how long the app had been running. The panel's data source — `RelayMetrics.ping_ms` / `last_check` — was correctly read via `get_relay_metrics`, but the backend loop that was supposed to populate those fields never ran.

## Symptoms

- `hasRelayHealthData(metrics)` (`src/lib/api/relays.ts`) always returned `false` for every relay, in every session, indefinitely — not just "not yet" but never.
- No `warn`/`error` relay logs appeared either, since the health-check probe itself never fired.

## What Didn't Work

Nothing was "tried and failed" here — the bug was invisible to every existing gate:

- `cargo build` / `cargo clippy`: clean. `monitor_relay_connections` (`src-tauri/src/lib.rs`) is referenced inside the `tauri::generate_handler![...]` macro, so from Rust's perspective the function **is** used — `#[warn(dead_code)]` never fires on a registered Tauri command, even if no IPC caller exists.
- `cargo test` / `pnpm test`: no test exercised the startup call graph (i.e. "does anything actually call `invoke('monitor_relay_connections')`?").
- Code review of the relay-health-detail PR: the plan's own Key Technical Decision (KTD5 in `docs/plans/2026-07-27-001-feature-relay-health-detail-plan.md`) asserted "No subscription to `relay_status_change`/`relay_health_check` is added" — correctly scoping the new UI to *read* existing metrics, but this was written on the unverified assumption that the health-check loop was already running. It wasn't, and had never been: `git log --all -S"monitor_relay_connections" -- src` returns zero hits, ever, in this repo's history. The command was dead from the commit that introduced it (`923f026`), which predates this branch entirely.

## Solution

Added the missing frontend call, following the same fire-and-forget pattern as the other post-connect calls in the same function:

```ts
// src/lib/api/relays.ts
export async function monitorRelayConnections(): Promise<boolean> {
  return invoke<boolean>('monitor_relay_connections');
}

// src/lib/app/post-login-sync.ts, inside runPostLoginNetworkSync()
monitorRelayConnections().catch((e) => console.error('monitor_relay_connections failed:', e));
```

Called right after `apiConnect()` in `runPostLoginNetworkSync` — the same lifecycle point relay connections get established. The backend's own `MONITOR_STARTED` `AtomicBool` guard (`src-tauri/src/lib.rs`, inside `monitor_relay_connections`) already makes repeated calls safe, so no new dedup logic was needed on the frontend.

## Why This Works

`monitor_relay_connections` was always correctly implemented: it subscribes to `MonitorNotification::StatusChanged` for real-time relay status, and spawns a health-check loop (60s startup delay, then every 15s) that pings each `Connected` relay and writes `ping_ms`/`last_check` via `update_relay_metrics`. The only thing missing was a caller. Rust's unused-code detection can't see across the Tauri IPC boundary — a `#[tauri::command]` fn registered in `generate_handler!` is "used" as far as the compiler is concerned regardless of whether any `invoke()` call in `src/` ever references its command string.

## Prevention

- **`scripts/check-orphaned-tauri-commands.mjs`** (new, wired into `pnpm check:tauri-commands` and the `lint` job in `.github/workflows/ci.yaml`): scans `generate_handler![...]` for registered command names and `src/**/*.{ts,svelte,js}` for `invoke('command_name', ...)` call sites; fails when a command has zero frontend callers. It's a **ratchet**, not a backlog fixer — `scripts/orphaned-tauri-commands-baseline.txt` grandfathers 72 pre-existing orphaned commands discovered during this audit (most are likely genuinely dead, same as this one, but weren't triaged individually). The check only fails on *new* orphans, so it catches the next `monitor_relay_connections`-shaped bug without blocking on unrelated debt.
- **AGENTS.md > "Before adding a Tauri command"**: now requires the frontend wrapper be "actually called from a store, component, or startup hook," not just written, and points at the new script.
- **AGENTS.md > new bullet**: "Before treating an existing-but-idle backend command or loop as 'already running,' verify it, don't assume it" — `grep -rn "invoke(.*'<command_name>'" src/`. This is the specific process gap that let KTD5 assert something false without evidence: a plan's "already happens" claim about existing system behavior needs a grep/read citation, the same way a code-behavior claim in documentation does.

## Related Issues

- `docs/plans/2026-07-27-001-feature-relay-health-detail-plan.md` — the plan whose KTD5 assumption exposed this gap (the plan itself is fine; the underlying assumption was never true).
