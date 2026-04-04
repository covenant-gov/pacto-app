# ISSUE 01 — Node sidecar for Aztec.js / PXE

## Goal

Ship a **bundled Node (or Node-compiled) process** as a Tauri **sidecar** so the desktop app can load **Aztec TypeScript libraries** and run a **PXE** (Private Execution Environment) without putting that stack in the WebView.

This issue prioritizes **sidecar plumbing, packaging, lifecycle, and automated tests**. Deep Aztec protocol work belongs in later issues; here we only need enough Aztec surface to prove the process can start, answer health checks, and shut down cleanly.

## Background

- Tauri’s official pattern: compile or bundle a Node app, register it under `bundle.externalBin`, grant **shell** (or equivalent) permissions, spawn via `Command.sidecar`, optional stdin/stdout or a loopback server. See the [Node.js as a sidecar](https://v2.tauri.app/learn/sidecar-nodejs/) guide.
- The stakeholder plan for the broader wallet direction (not replicated here) is summarized in [embedded-wallet-plan.md](https://github.com/covenant-gov/pacto-app/blob/feat/aztec-wallet/docs/issues/aztec/embedded-wallet-plan.md): long-lived sidecar on loopback, Rust orchestration, narrow `invoke` surface to the UI.

## Out of scope for this issue

- Final Aztec account derivation from the user’s BIP-39 seed (covered in ISSUE 02).
- DM WalletBar EVM/Aztec mode and transfers (ISSUE 03).

## Requirements

### Packaging

1. Add a **dedicated package** (e.g. `sidecar/aztec-pxe/` or `src-tauri/sidecar-app/`) with its own `package.json`, **pinned** `@aztec/*` versions.
2. Register artifacts in Tauri:
   - `tauri.conf.json` → `bundle.externalBin` (or resources layout if single-binary `pkg` is not viable).
   - Per-target binaries following Tauri’s **target triple** naming (`binaries/<name>-<triple>`).
3. **Capabilities**: allow **only** the intended sidecar entry (see shell plugin / execute scopes in repo conventions under `src-tauri/capabilities/`).

Prefer starting from the short-lived **`pkg`** flow in the Tauri tutorial; if native addons or missing assets break that, document a fallback (**bundled Node binary + `node_modules` + entry script** under resources). Record the decision in `docs/wallet/` when implementation lands (see `docs/wallet/README.md`).

### Process model

1. **Start on demand** (e.g. first Aztec-related `invoke`, or explicit warm-up command).
2. **Stop** without leaving zombie processes or wedging the Tauri app (signal on app exit, optional stop on wallet lock if product agrees).
3. **Health**: loopback ping or version endpoint so Rust can confirm readiness before forwarding work.
4. **Auth**: shared secret or token generated at runtime so only the local app can call the sidecar (stakeholder plan suggests Rust-generated token).

### Rust ↔ sidecar protocol

- Define a small **versioned JSON** contract (`id`, `method`, `params`, structured errors). Initial methods can be stubs: `health`, `version`, and optionally `pxe.init` no-op until Aztec wiring exists.
- **Timeouts and payload size limits** on the Rust client.

### Testing (mandatory)

Automated tests should demonstrate that the app **does not regress** when the sidecar misbehaves:

1. **Happy path**: start sidecar (or invoke wrapper), health succeeds, stop completes; app remains responsive.
2. **Double start**: idempotent or cleanly rejected — no crash, no duplicate listeners on the same port.
3. **Stop while idle / stop during “long” op**: simulate or use a stub slow handler; ensure shutdown does not panic Rust or leave the UI stuck.
4. **Restart after failure**: exit sidecar with non-zero; supervisor can start again with backoff (even if stubbed in tests).
5. Where feasible, **CI** builds or downloads the sidecar artifact for the runner’s target; skip or gate tests when the binary is missing, with a clear message.

Tests may live under `src-tauri` (Rust integration tests) and/or a small script invoked from `npm test` / CI; choose what fits the existing Pacto layout.

## Phased execution

Each phase below is a natural **git commit** (or small stack of commits) so reviewers can follow incremental diffs. At the end of a phase, **run any tests listed** before merging or opening the next phase; add new tests in the same phase when the behavior is introduced.

### Phase 1 — Sidecar package skeleton

1. Create the sidecar directory (e.g. `sidecar/aztec-pxe/`) with `package.json`, pinned dependencies (minimal `@aztec/*` first, or a pure stub with no Aztec imports until health/version work end-to-end).
2. Implement `index` (or `main`) that parses argv or env, binds **loopback only** (`127.0.0.1`), and exposes **health** + **version** (HTTP or stdin/stdout JSON line—pick one and document it).
3. Add npm scripts: `dev` (run with node), `build` (produce the artifact your packaging strategy needs).
4. **Verify**: `npm run dev` (or equivalent) responds to health locally; no Tauri yet.

**Tests (recommended):** unit or script that starts the process, hits health, exits (optional in CI if binary not bundled yet).

**Commit:** sidecar package + README in sidecar folder describing how to run.

### Phase 2 — Binary layout and Tauri bundle wiring

1. Add a build step that outputs the sidecar with the **correct Tauri naming**: `src-tauri/binaries/<name>-<target-triple>[.exe]` (see [Tauri sidecar guide](https://v2.tauri.app/learn/sidecar-nodejs/) for host tuple).
2. Set `bundle.externalBin` in `tauri.conf.json` to that basename.
3. Document in `docs/wallet/` (stub section is fine) the **exact** binary name and how devs obtain the missing triple locally.

**Tests:** none mandatory yet beyond manual `ls src-tauri/binaries`; optional script that fails CI if expected file missing for current host.

**Commit:** `tauri.conf.json`, binaries path, build script, doc note.

### Phase 3 — Capabilities and shell permissions

1. Update `src-tauri/capabilities/default.json` (or scoped capability) with **minimal** `shell:allow-execute` (or current plugin equivalent) for the sidecar only—**no** broad `args: true` beyond what is required.
2. Confirm **dev** and **release** capability sets match how the app ships.

**Tests:** manual `tauri dev` smoke: app launches; no permission errors when spawning is wired (Phase 4).

**Commit:** capabilities only.

### Phase 4 — Rust supervisor: spawn, health, stop

1. Add a small Rust module (e.g. `sidecar_supervisor` or `aztec_sidecar`) that: spawns the sidecar via Tauri’s shell/sidecar API, waits for health, stores child handle / port token.
2. Implement **stop** on demand and register **cleanup on app exit** (and document behavior if the app is force-killed).
3. Generate a **runtime auth token** (or shared secret file in temp) and pass it to the sidecar env; reject requests without it on the HTTP server (if HTTP).

**Tests:** Rust `#[test]` or integration test using `cargo test` that mocks or uses a **stub** sidecar if the real binary is not in CI (feature-gate or `#[ignore]` with instructions).

**Commit:** Rust supervisor + internal API; no UI.

### Phase 5 — Tauri commands (frontend contract)

1. Expose narrow commands, e.g. `aztec_sidecar_start`, `aztec_sidecar_stop`, `aztec_sidecar_health` (names illustrative).
2. Implement **idempotent start**: second call returns OK without duplicate listener.
3. Enforce **timeouts** on health and on JSON-RPC calls.
4. Wire **no** direct frontend → sidecar URL; frontend calls **only** `invoke`.

**Tests:** extend integration tests or add tests that call the command layer (may require Tauri test harness if available; otherwise document manual checklist and keep Rust unit tests for supervisor logic).

**Commit:** commands + error types.

### Phase 6 — Failure modes and automated regression tests

1. Implement or stub a **slow** handler to test stop-during-work (supervisor must not panic).
2. Simulate **crash** (kill child) and verify **restart** with backoff works.
3. Add CI job step: build sidecar for runner host, then run tests; **skip with clear log** if binary absent.

**Tests:** this phase is primarily **test additions**; all scenarios from “Testing (mandatory)” above should be covered or explicitly deferred with rationale in `docs/wallet/`.

**Commit:** tests + any supervisor fixes.

### Phase 7 — Documentation and handoff

1. Finalize `docs/wallet/` “Aztec sidecar runtime”: architecture diagram or bullet list (start/stop, ports, token, commands).
2. Link this issue and the Tauri guide.

**Tests:** none.

**Commit:** docs only.

## Acceptance criteria

- [ ] Sidecar is built and bundled for **at least one** desktop target used in development (document other targets as follow-ups).
- [ ] Rust can **spawn**, **health-check**, and **terminate** the sidecar.
- [ ] Frontend does **not** talk to the sidecar directly; it goes through **Tauri commands** only.
- [ ] Automated tests cover start/stop and basic failure modes without crashing the host app.
- [ ] `docs/wallet/` updated with a short “Aztec sidecar runtime” note linking here and the Tauri guide.

## References

- [Node.js as a sidecar (Tauri)](https://v2.tauri.app/learn/sidecar-nodejs/)
- [Aztec embedded wallet — implementation plan](https://github.com/covenant-gov/pacto-app/blob/feat/aztec-wallet/docs/issues/aztec/embedded-wallet-plan.md) (process model and layering only)
