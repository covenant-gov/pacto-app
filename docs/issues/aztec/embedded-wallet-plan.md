# Aztec embedded wallet — implementation plan

Planning note for adding a **basic Aztec transfer** path to Pacto’s desktop app, alongside the existing embedded EVM wallet in the DM sidebar (WalletBar: balance, send, request). Governance and heavier on-chain flows remain on the Ethereum wallet.

**References**

- Tauri Node sidecar: https://v2.tauri.app/learn/sidecar-nodejs/
- Aztec developer overview: https://docs.aztec.network/developers/overview

---

## Product decisions (locked for this draft)

### MVP scope

- **In scope:** Public **or** private **token transfer** on Aztec from one wallet to another — minimal vertical slice demo’d in the same DM sidebar wallet area that already hosts EVM payment and request flows.
- **Out of scope (for MVP):** Governance and more complex Aztec transactions; those continue to be demonstrated on the Ethereum-based wallet.

### Key material and seed phrase

- **Intent:** Revisit wallet onboarding and derivation so an **Aztec identity can be tied to the same BIP-39 seed** already used for Ethereum embedded accounts and the Nostr account.
- **Engineering note:** Aztec uses account abstraction and multiple key roles (nullifier, incoming/outgoing viewing keys; signing depends on account contract design). The exact **derivation path / mapping from mnemonic → Aztec deployable account** must follow Aztec + Noir account docs and may require storing **additional** ciphertext or contract deployment metadata beyond a single “address string” like EVM.

### DM payloads and metadata (deferred)

- **Still to decide:** What may appear in structured DM types analogous to `wallet_tx_request` / `wallet_tx_announcement` for Aztec (e.g. how much address or transfer metadata is exposed peer-to-peer, and whether new wire types or extended v2 payloads are required).
- Track this before shipping user-visible Aztec request/announce flows so privacy expectations match product.

### Platforms

- **Pacto is desktop-only** (Tauri). There is no web build; mobile is not planned near-term (future possibility).

### Networks

- Target **real Alphanet or an official Aztec testnet** — **not** a local sandbox as the primary integration story for this MVP.

---

## Technical approach (summary)

### Why a Node sidecar

- Private execution and **proof generation** run in the **PXE** (Private Execution Environment), shipped via **Aztec.js** (TypeScript / Node-capable).
- Pacto’s core is **Rust (Tauri)** + **Svelte**. The WebView is not the preferred place to own all proving dependencies and lifecycle; a **bundled Node (or compiled sidecar)** process gives a stable home for `@aztec/*`, native/wasm proving backends, and PXE state.

### Recommended process model

- Prefer a **long-lived** sidecar (local loopback API) managed by Rust: start after unlock or first Aztec use, health checks, shutdown on app exit — avoid cold-starting PXE per transfer if latency is prohibitive.
- **Spike early:** Tauri’s tutorial uses short-lived **`pkg`** binaries; Aztec may need **bundled Node + `node_modules`** or another packaging strategy if native addons or filesystem layout break single-binary packaging.

### Layering (mirror EVM patterns)

| Concern | Direction |
|--------|-----------|
| UI | Svelte: WalletBar-adjacent flows; `isTauri()` guards; typed errors |
| Orchestration / policy | Rust: PIN/session gating, timeouts, redacted logs, when to talk to sidecar |
| Proving + PXE | Node sidecar: Aztec.js, proof generation, node connection to Alphanet/testnet |

Frontend should call **narrow Tauri commands** (similar to `get_wallet_summary` / `wallet_build_and_send_transaction`), not talk to the sidecar directly.

---

## Phased work

1. **Spike:** Run pinned `@aztec/*` in the intended packaged layout (pkg vs bundled Node); connect to Alphanet/testnet; one manual proof/transfer from a dev script.
2. **Plumbing:** `externalBin` / resources, shell or process management, capabilities, CI artifacts per target triple; Rust ↔ sidecar JSON protocol (versioned requests/errors).
3. **MVP vertical slice:** From DM wallet UI → Rust → PXE → broadcast/settle on chosen network → success/failure surfaced like EVM (toasts, modal states). DM announcement/request **after** the deferred schema decision.
4. **Hardening:** Crash recovery, upgrades, storage for PXE state if required, installer size and UX for long operations.

---

## Risks

- **Packaging:** Native modules or missing files in published packages may force bundled Node instead of `pkg`.
- **API drift:** Aztec alpha; pin versions and isolate the sidecar in its own `package.json`.
- **Performance:** Proof time and memory; UX must show progress and avoid blocking the shell unnecessarily.
- **Derivation:** Single-seed story is a product goal but must be validated against Aztec account deployment requirements.

---

## Relationship to existing docs

- Canonical shipped behavior and cross-links from code belong under `docs/wallet/` when implementation lands (see `docs/wallet/README.md`).
- This file lives under `ai-docs/aztec/` for planning; **`ai-docs/` may be gitignored** in this repo — confirm whether planners want it tracked.

---

*Last updated from stakeholder answers: MVP transfer-only in DM wallet; same-seed goal for Aztec; DM schema TBD; desktop-only; Alphanet/testnet non-local.*

---

## Development

Below: **phases** → **categories** → **issues** (actionable bodies of work) → **steps** (checklist). Copy any issue into your tracker as a single ticket; steps are the definition of done for implementation.

### Phase 0 — Spike and standards

**Category: Aztec runtime proof**

- **Issue: Prove Aztec.js + PXE in a desktop-style Node layout**
  1. Create a throwaway repo or `sidecar/` folder with pinned `@aztec/*` versions from official docs.
  2. Connect to **Alphanet or chosen testnet** (no local sandbox as primary).
  3. Run one minimal flow: sync PXE, compile or load required contracts/artifacts per docs, execute a transfer or tutorial transaction, observe proof + broadcast.
  4. Document exact Node major version, env vars, and RPC/node endpoints used.
  5. Record cold vs warm timings and resident memory; decide **long-lived vs per-invocation** sidecar.

- **Issue: Decide packaging strategy**
  1. Attempt `pkg` (or equivalent) single-binary packaging if desired.
  2. If native modules or missing assets fail, prototype **shipped Node binary + `node_modules` + entry script** under Tauri `resources` or `binaries`.
  3. Write a one-page decision: chosen layout, size estimate, CI implications.

**Category: Derivation and accounts**

- **Issue: Same-seed → Aztec account feasibility**
  1. Read current BIP-39 / BIP-44 usage for EVM and Nostr in codebase and `docs/wallet/`.
  2. Map Aztec account contract + key expectations to a derivation plan (paths, what is persisted, deployment registration).
  3. List gaps: e.g. extra DB columns, migration, first-run deploy step.

---

### Phase 1 — Sidecar service and Tauri integration

**Category: Node sidecar application**

- **Issue: Minimal HTTP or RPC server in Node**
  1. Implement loopback-only listener (e.g. `127.0.0.1`, ephemeral or config port).
  2. Add health endpoint or ping method for Rust supervisor.
  3. Add auth token or equivalent so only the local app can call the sidecar ( Rust generates token at startup).
  4. Stub handlers that return version and network config.

- **Issue: Versioned Rust ↔ Node protocol**
  1. Define JSON envelope: `id`, `method`, `params`, `error { code, message }`.
  2. Document methods needed for MVP (e.g. `pxe.init`, `wallet.sync`, `transfer.buildProveSend` — exact names to match Aztec APIs).
  3. Add request timeouts and size limits on the Rust client.

**Category: Tauri bundle and permissions**

- **Issue: Bundle sidecar with release builds**
  1. Add `bundle.externalBin` or resource paths in `tauri.conf.json` per [sidecar guide](https://v2.tauri.app/learn/sidecar-nodejs/).
  2. Produce per-target artifacts (macOS, Windows, Linux); align names with Tauri’s `target triple` convention.
  3. Add `tauri-plugin-shell` (or chosen spawn API) and capability entries for executing the sidecar only as intended.

- **Issue: Rust sidecar supervisor**
  1. Spawn process on first Aztec use or wallet unlock; store PID / child handle.
  2. Poll health; restart with backoff on failure; log without secrets.
  3. Kill child on app exit (and optionally on lock).

---

### Phase 2 — Wallet core (Rust + encrypted storage)

**Category: Persistence**

- **Issue: Aztec-related encrypted fields**
  1. Schema design for Aztec account identity, ciphertext blobs, and PXE-handoff material if needed.
  2. Migration from existing installs (nullable columns, lazy init).
  3. Align with same-seed decision: what is derived at runtime vs stored.

**Category: Commands**

- **Issue: `aztec_wallet_summary` (or equivalent)**
  1. Accept same gating patterns as EVM wallet commands (PIN/session).
  2. Forward to sidecar; normalize response for Svelte (`camelCase`, USD optional later).
  3. Return structured errors compatible with frontend parsing (mirror EVM JSON errors where possible).

- **Issue: `aztec_build_and_send_transfer` (or equivalent)**
  1. Validate amount, token id, recipient handle (address or alias from settings/DM layer).
  2. Ensure sidecar running; call prove+send pipeline with timeouts.
  3. Return tx identifier / receipt fields needed for UI and future announcements.

---

### Phase 3 — Svelte UI (DM WalletBar)

**Category: UX parity with EVM**

- **Issue: Aztec strip in WalletBar**
  1. Network/token selector for Aztec (reuse layout patterns from EVM where sensible).
  2. Balance load via new `invoke`; loading and error states consistent with EVM.
  3. Send modal: amount, confirm, in-flight lock, success toast — same accessibility patterns (focus trap, etc.).

- **Issue: TypeScript client module**
  1. Add `src/lib/wallet/aztec-backend.ts` (or similar): `invoke` wrappers, `parseAztecOpError`, Tauri-only guards.
  2. Optional: cache snapshot akin to `wallet-summary-cache` if UX needs instant paint.

**Category: Configuration**

- **Issue: Alphanet/testnet config surface**
  1. Env or compile-time config for node URL(s), chain id equivalents, and feature flag to hide Aztec until ready.
  2. Document in `docs/wallet/` (new Aztec chain doc) mirroring `CHAIN_CONFIG.md` style.

---

### Phase 4 — DM requests, announcements, and privacy

**Category: Wire format (blocked until product answers open questions)**

- **Issue: Schema decision**
  1. Resolve deferred questions: what appears in DMs for Aztec request/announce payloads.
  2. Add `docs/wallet/` schema doc and parsers/tests mirroring `dm-messages.ts` patterns.
  3. Implement Request / paid flow in UI only after schema is fixed.

- **Issue: Peer payout resolution**
  1. Define how recipient Aztec address is learned (`dm_peer_*` analog, profile field, or settings-only send).
  2. Implement resolution order and error codes matching EVM ergonomics.

---

### Phase 5 — Hardening and release

**Category: Quality**

- **Issue: Manual E2E checklist**
  1. Alphanet/testnet send, recipient verification on explorer or tooling Aztec provides.
  2. Failure cases: sidecar crash mid-proof, network loss, receipt timeout.

**Category: Packaging and CI**

- **Issue: Release pipeline**
  1. CI builds sidecar for all bundle targets before Tauri bundle.
  2. Smoke test: install artifact, unlock wallet, run one Aztec balance read.

**Category: Observability**

- **Issue: Safe logging**
  1. No mnemonic, keys, or raw proofs in logs; redact RPC URLs if they contain keys.
  2. Optional: metrics or breadcrumbs for proof duration in dev builds only.
