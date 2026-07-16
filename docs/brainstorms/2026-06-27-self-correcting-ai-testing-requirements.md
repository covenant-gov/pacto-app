# Self-Correcting AI Testing Architecture for Pacto

> Requirements brief for an autonomous coding-agent feedback loop in a Tauri desktop app.
> Prepared: 2026-06-27.

## Problem

Pacto is a Tauri 2 desktop app (SvelteKit 2 + Svelte 5 frontend, Rust backend). Coding agents cannot verify their own work when it touches the presentation layer or the OS filesystem because:

- The app requires a PIN to unlock a private key stored on disk; even basic UI flows depend on real filesystem state.
- Browser-only test tools (Playwright/Cypress against a static build) cannot exercise the real Rust backend or assert on real OS mutations.
- There is no end-to-end harness today; `pnpm test` runs only Vitest unit tests in a Node environment.

The result is a human-in-the-loop bottleneck: an agent changes code, a developer manually runs the app, and regressions are caught late.

## Goal

Give coding agents a deterministic, automated feedback loop that can:

1. Build and run the real Pacto binary (or a browser-runnable presentation build).
2. Execute tests against it without human intervention.
3. Capture failures, logs, and screenshots in a structured format the agent can parse.
4. Tear down and reset all state between trial runs so filesystem mutations are isolated.

## Scope

### In scope

- Phase 1: Fast UX preview harness — a browser-runnable Svelte build with a mocked backend, driven by a test runner, for cheap layout/click-through/ screenshot feedback.
- Phase 2: Real-Tauri E2E harness — runs the actual debug binary via WebdriverIO + embedded WebDriver, with a sandboxed filesystem, for real OS-side-effect verification.
- Structured test output (WDIO JSON / JUnit XML) and unified Rust + webview console logging for AI parsing.
- Sandbox setup/teardown so each agent run starts from a clean profile directory.
- One documented end-to-end spec per phase as proof the loop works.

### Out of scope

- Replacing unit tests or backend-specific Rust tests.
- Running real Nostr relays, MLS crypto, or on-chain transactions in the browser build.
- Mobile testing.
- Production notarization, code signing, or distribution as part of the test harness.
- A fully autonomous retry/replan loop in the AI (this doc defines the feedback artifact; the retry policy is planning/implementation work).

## Non-goals

- Public web deployment of Pacto.
- Mocking the entire Rust backend at full fidelity in the browser build.
- Running every test in the slow real-Tauri harness.

## Actors

- **Coding agent:** reads a plan, edits code, runs the test harness, parses failures, and self-corrects.
- **Developer (today):** reviews agent output; may also run the harness locally.
- **CI:** runs the fast harness on PRs; may run the real-Tauri harness on request or nightly.

## Phase 1: Fast UX Preview Harness

### Purpose

Give the agent cheap, fast feedback on presentation-layer changes: layout, navigation, button clicks, screenshots. This does not verify filesystem behavior or real Rust commands.

### Mechanism

Build on the browser-runnable mocked-backend approach described below:

- Add a Vite build mode that emits a static SPA (`pnpm build:agent`).
- Replace direct `invoke()` and `listen()` calls with a runtime shim that routes to typed mock handlers when `window.__TAURI__` is absent.
- Provide mock handlers for auth, shell, dashboard, and wallet commands; return fixtures that let the UI render representative states.
- Complete existing `isTauri()` fallbacks for clipboard, file picker, notifications, external URLs, and image file URLs.
- Add a Playwright suite under `e2e/` with at least one spec that logs in and captures a screenshot.

### Success criteria

- `pnpm build:agent` produces a browser-runnable static SPA.
- `pnpm exec playwright test` runs at least one spec against the agent build locally and in CI.
- The suite captures at least one screenshot automatically.
- Adding a new mocked command requires editing one registry file and one fixture.
- Production Tauri build is unaffected.

## Phase 2: Real-Tauri E2E Harness with Filesystem Sandbox

### Purpose

Verify real OS mutations: PIN unlock, SQLite writes, attachment downloads, key storage, profile creation. This is the only harness that can assert on-disk side effects.

### Stack

- **App target:** Tauri debug binary.
- **WebDriver server:** `tauri-plugin-wdio-webdriver` compiled into debug builds via `#[cfg(debug_assertions)]`, following the plugin's conditional-compilation pattern already used by `tauri_plugin_mcp_bridge` in `src-tauri/src/lib.rs:6152-6156`.
- **Test runner:** WebdriverIO.
- **Sandbox:** a temporary directory per run that overrides the profile/data paths the Rust backend uses.

### Sandbox mechanism

Use a Rust-side override. Introduce a small helper that wraps Tauri `app_data_dir()` / `app_local_data_dir()` resolution and, when `PACTO_TEST_SANDBOX_ROOT` is set, returns a path under that root instead of the real platform directory. Apply the helper at every existing call site in the backend (e.g. `account_manager.rs`, `image_cache.rs`, `whisper.rs`, `audio.rs`, `lib.rs`).

Requirements for the helper:
- Only active when a test-specific env var is present, so production behavior is unchanged.
- Panic or return an error if any resolved path falls outside the sandbox root, so a leak fails the test immediately rather than corrupting developer data.
- Works identically on macOS, Linux, and Windows.

This makes isolation hold by construction. A thin launcher script still creates `./test_sandbox/<run-id>/` and sets the env var, but the safety invariant lives in Rust.

### Setup / teardown

- **Setup:** create `./test_sandbox/<run-id>/`, optionally seed it with a known profile/DB fixture, launch the Tauri binary with `PACTO_TEST_SANDBOX_ROOT` set.
- **Teardown:** kill the Tauri process, archive or delete the sandbox directory. Each agent trial run gets a fresh sandbox.
- **Auth shortcut:** use a debug-only command (extend `debug_hot_reload_sync` at `src-tauri/src/lib.rs:3982` or add a new `#[cfg(debug_assertions)]` command) that jumps the app straight into the authenticated shell when the test harness requests it. Tests that specifically exercise PIN entry must type it through the UI.

### Log aggregation for AI diagnosis

The agent must receive one structured stream it can parse:

- **WDIO output:** JSON reporter or JUnit XML with per-test status, stack traces, and assertion messages.
- **Rust backend logs:** route `println!` / `eprintln!` and `log::` output to a file or stdout with timestamps and a consistent target prefix.
- **Webview console logs:** capture Chromium/WebKit console messages via the WebDriver session and merge them with Rust logs.
- **Result format:** one JSON document per test run containing `tests[]`, `logs[]`, `screenshots[]`, and a top-level `passed` boolean.

### Success criteria

- A single CLI command builds the debug binary and runs one WDIO spec.
- The first spec creates an account (or uses the auth shortcut), opens a chat, sends a text message, and asserts the message appears in the UI and is persisted in the sandboxed SQLite database.
- Each run uses an isolated sandbox directory and cleans it up afterward.
- The merged log artifact is machine-parseable and includes Rust + webview entries.
- The harness runs on macOS (the primary dev platform) and is portable to Linux/Windows.
- A single real-Tauri spec completes in under 3 minutes on a typical development machine.

## Success Criteria (overall)

1. An agent can run a presentation-layer test in under two minutes for fast feedback.
2. An agent can run a real-Tauri filesystem test with deterministic sandbox reset in under three minutes.
3. Test failures include enough structured context (DOM snapshot, screenshot, command log, Rust log) that the agent can localize the bug without human help most of the time.
4. Adding a new test does not require modifying production code paths.
5. CI can run the fast harness on every PR and the real-Tauri harness on request or nightly.


## Dependencies and Assumptions

- `tauri-plugin-wdio-webdriver` is maintained and supports macOS automation in debug builds.
- The Tauri debug binary can be built headlessly/automatically by the harness.
- Path overrides in Rust do not break Tauri's own plugin internals (window state, updater, single-instance).
- The team accepts a mocked-backend browser build as a separate test target, not a public deployment.

## Risks

- **Embedded WebDriver maturity:** the plugin may have platform-specific gaps or require forked patches.
- **Sandbox leakage:** if any Rust module bypasses the override and writes to the real `app_data_dir`, tests could corrupt developer data.
- **Flakiness from real async behavior:** relay connections, profile sync, and MLS crypto may introduce timing issues.
- **Maintenance burden of mocks:** the browser build's mock registry can drift from the real backend; it must be treated as a test artifact, not documentation.

## Security Considerations

The harness intentionally adds remote-control and authentication-bypass capabilities, but only to debug builds. Treat these as production-adjacent risks and apply defense in depth.

### Debug-only gates

- The embedded WebDriver server and the test-only auth shortcut must be gated by `#[cfg(debug_assertions)]`.
- Add a runtime env-var gate (`PACTO_ALLOW_TEST_AUTH=1`) for the auth shortcut so a debug binary alone is not enough to bypass PIN entry.
- Add a CI step that verifies the release binary does not contain WebDriver or test-auth symbols.
- Never notarize or distribute a debug build.

### Network exposure

- The embedded WebDriver server must bind to `127.0.0.1` only.
- Require a one-time token or port-file handshake generated by the test launcher; reject sessions without it.

### Sandbox escape

- Reject `PACTO_TEST_SANDBOX_ROOT` values that contain `..` or resolve outside a known `./test_sandbox/` prefix.
- CI must run the real-Tauri harness in an ephemeral environment so a sandbox escape cannot touch persistent host state.

### Log and screenshot leakage

- Mnemonics, private keys, PINs, and message content must never be emitted by Rust `println!` / `eprintln!` or webview `console.log` before enabling merged AI logging.
- Audit existing logging before the first merged-log run.
- Store logs and screenshots from test runs with restricted permissions and delete them after teardown unless explicitly archived.

## Open Questions for Planning

1. Build a standalone CLI orchestrator that humans and AI agents both invoke to run tests. The same CLI should support a `--loop` / agent mode with structured output and a human-readable mode for developers.

## Related Documents

- `docs/storage-layout/SQLITE_AND_FILES.md` — per-account storage layout.
- `docs/wallet/MANUAL_E2E_CHECKLIST.md` — manual testnet smoke checklist.
