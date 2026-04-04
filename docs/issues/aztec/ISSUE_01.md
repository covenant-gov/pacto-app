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

## Acceptance criteria

- [ ] Sidecar is built and bundled for **at least one** desktop target used in development (document other targets as follow-ups).
- [ ] Rust can **spawn**, **health-check**, and **terminate** the sidecar.
- [ ] Frontend does **not** talk to the sidecar directly; it goes through **Tauri commands** only.
- [ ] Automated tests cover start/stop and basic failure modes without crashing the host app.
- [ ] `docs/wallet/` updated with a short “Aztec sidecar runtime” note linking here and the Tauri guide.

## References

- [Node.js as a sidecar (Tauri)](https://v2.tauri.app/learn/sidecar-nodejs/)
- [Aztec embedded wallet — implementation plan](https://github.com/covenant-gov/pacto-app/blob/feat/aztec-wallet/docs/issues/aztec/embedded-wallet-plan.md) (process model and layering only)
