# Repository Guidelines

## Project Overview

Pacto is a private, censorship-resistant community organizing platform with no KYC. It is a **Tauri v2 desktop application**: a **SvelteKit/Svelte 5** frontend (used in legacy store mode) bundled as a static SPA, backed by a **Rust** crate in `src-tauri/src/`.

- **Communications** run over Nostr: E2EE direct messages (NIP-17 gift wraps) and metadata-protected **MLS group messaging**.
- **Governance and finance** run over EVM chains via an embedded wallet derived from the same BIP-39 seed.
- The product has **not shipped a public alpha**; the codebase is optimized for clear, minimal paths rather than legacy compatibility.

## Architecture & Data Flow

```
┌─────────────────────────────────────┐
│  SvelteKit SPA (src/)               │
│  - stores, lib/*, components/*      │
│  - invoke + listen to Tauri backend  │
└──────────────┬──────────────────────┘
               │ Tauri webview
┌──────────────▼──────────────────────┐
│  Rust backend (src-tauri/src/)        │
│  - Nostr/MLS, SQLite, EVM, media     │
└──────────────┬──────────────────────┘
               │ Nostr relays / RPCs
```

### Frontend
- `src/routes/+page.svelte` is the single root container that mounts the navbars, Commons, DMs, Squads, wallet sidebar, and modals.
- `src/routes/+layout.ts` disables SSR; `svelte.config.js` uses `adapter-static` with `fallback: "index.html"` so Tauri loads the app as a SPA.
- All heavy work (crypto, Nostr relay logic, EVM signing, SQLite) is delegated to the Rust backend via `invoke` in `src/lib/api/*`.
- `src/lib/app/tauri-subscriptions.ts` is the single event listener bridge for backend → UI events (`message_new`, `mls_message_new`, `profile_update`, etc.).

### Backend
- `src-tauri/src/main.rs` calls `pacto_lib::run()`.
- `src-tauri/src/lib.rs` bootstraps the Tauri app and registers every command in `tauri::generate_handler![...]`.
- Global mutable state lives in `lazy_static!` / `once_cell::OnceCell` globals (`STATE`, `NOSTR_CLIENT`, `MNEMONIC_SEED`, `TAURI_APP`, `ENCRYPTION_KEY`). There is no DI framework; modules access these globals directly.

### Messaging data flow
1. Nostr events arrive via `nostr-sdk` over `TRUSTED_RELAYS` and custom relays.
2. NIP-17 gift wraps or MLS messages are unwrapped into `RumorEvent`.
3. `rumor::process_rumor` (protocol-agnostic) emits `RumorProcessingResult` (text, attachment, reaction, edit, poll, typing, unknown).
4. Results are persisted as flat `StoredEvent` rows in per-account SQLite (`db.rs`) and materialized into `Message`/`Chat`.
5. The frontend is updated via `AppHandle::emit` events (`message_update`, `chat_update`, `profile_update`, etc.).

### EVM data flow
1. `wallet_chain_config` loads `src/lib/wallet/wallet-assets.json` at compile time; `pacto_chain_config` loads `src/lib/evm/pacto-protocol-addresses.json`.
2. `wallet_rpc_providers` builds operator-provider URLs from `ALCHEMY_RPC_KEY`, falling back to public RPCs.
3. `evm_accounts` resolves phrase-derived (`bip44_v1`) and imported keys, enforcing `squad` vs `advanced` purpose.
4. `rpc::signer` loads the appropriate `PrivateKeySigner` + `EthereumWallet`; `rpc::provider` connects via `alloy` and sends/confirms transactions.
5. Contract bindings under `evm/contracts/` use `alloy::sol!` and are called from deploy/read/governance modules.
6. Deployment results are persisted in the `squad_infra` table and announced over MLS as `governance_updated` events.

### State management
- **Frontend:** Svelte `writable`/`derived` stores, auto-subscribed with `$`. A barrel store `src/stores/app.ts` re-exports domain slices. Persistence is **npub-scoped** via `persistenceKey(prefix)` in `src/stores/persistence-context.ts`.
- **Backend:** `tokio::sync::Mutex<ChatState>` for runtime chat state, `std::sync::RwLock`/`Mutex` for the Nostr client and mnemonic, and `OnceCell` for one-time inits.

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `src/` | SvelteKit/Svelte frontend source (routes, stores, lib, components, styles). |
| `src/routes/` | Single route (`+page.svelte`) plus layout; adapter-static SPA fallback. |
| `src/stores/` | Svelte writable/derived stores for auth, DMs, squads, MLS chat, navigation, persistence, theme. |
| `src/lib/` | Side-effect modules and typed Tauri wrappers: `api/*`, `app/*`, `wallet/*`, `squad/*`, `governance/*`, `dashboard/*`, `mls/*`, `dm/*`, `utils/*`. |
| `src/components/` | Svelte UI components grouped by domain: `auth/`, `dm/`, `channel/`, `parent/`, `wallet/`, `ui/`, `layout/`. |
| `src-tauri/` | Tauri v2 Rust backend and app configuration. |
| `src-tauri/src/` | Rust crate source. |
| `src-tauri/src/evm/` | EVM wallet, key derivation, RPC, contract bindings, governance deployments. |
| `src-tauri/src/evm/contracts/` | `alloy::sol!` bindings for `pacto_gov`, `pacto_sponsor`, `safe`, `erc20`, `hats`. |
| `static/` | Static assets, including twemoji SVGs. |
| `docs/` | Authoritative tracked docs for architecture, wallet, MLS, storage, build, governance. |
| `.cursor/rules/` | Editor-enforced project policies: brief comments, no legacy shims, no issue IDs, no Cursor attribution, no unrequested deletions. |
| `.github/workflows/` | `main.yaml` — Tauri cross-platform release builds on push to `main`. |

## Development Commands

```bash
# Install dependencies
pnpm install

# Frontend-only dev server (port 1420)
pnpm dev

# Full desktop app with hot reload
pnpm tauri:dev

# Production frontend build
pnpm build

# Production Tauri bundle for current host
pnpm tauri:build

# Type check Svelte/TypeScript
pnpm check
pnpm check:watch

# Frontend unit tests
pnpm test
pnpm test:watch

# Frontend tests with coverage report served on port 7357
pnpm test:coverage:serve

# Rust backend tests
cd src-tauri && cargo test
```

## Code Conventions & Common Patterns

### Frontend
- **Svelte style:** Svelte 5 is installed, but the codebase uses **legacy Svelte 4 patterns** (`writable`/`derived`, `$` auto-subscriptions, `$:` reactive statements). Do **not** introduce `$state`/`$derived` runes unless migrating the whole project.
- **Backend calls:** Use `import { invoke } from '@tauri-apps/api/core'` and type as `invoke<T>('command_name', { arg1, arg2 })`. Command names are `snake_case`; payload keys are `camelCase` and converted by Tauri v2.
- **State:** One store file per domain. Re-export from `src/stores/app.ts` when cross-cutting. Reset stores in `beforeEach`/`afterEach` in tests.
- **Persistence:** Any new `localStorage` key must be npub-scoped via `persistenceKey(prefix)` from `src/stores/persistence-context.ts`. Call `loadAccountState(npub)` after login and `clearAccountState(npub)` on logout.
- **Error handling:** Use `getInvokeErrorMessage` / `friendlyMessage` from `src/lib/utils/tauri-errors.ts` to extract user-facing messages from Tauri rejections.
- **Naming:** TypeScript camelCase; backend commands snake_case; DTO types often end in `Dto`.
- **Async patterns:** Fire-and-forget async work is prefixed with `void`. Debug logging uses `dmLog`/`dmError` from `src/lib/utils/dm-debug.ts`.

### Backend
- **Commands:** Expose functions to the frontend with `#[tauri::command]` and add them to the `generate_handler!` list in `src-tauri/src/lib.rs`. Most return `Result<T, String>`.
- **State:** Access globals via `crate::STATE`, `crate::TAURI_APP`, `crate::get_nostr_client()`. Avoid holding synchronous locks across await points.
- **Database:** One SQLite database per account at `<app_data_dir>/<npub>/vector.db`. `src-tauri/src/db.rs` defines the schema. `account_manager` provides a pooled connection that must be returned with `return_db_connection`.
- **Error handling:** String errors for most commands. EVM wallet code uses `wallet_err_json` / `wallet_err_json_with_tx_hash` to return structured `{ code, message, txHash? }`. Always call `wallet_security::redact_urls_in_text` before surfacing RPC errors/logs.
- **Crypto:** `crypto::internal_encrypt`/`internal_decrypt` use ChaCha20-Poly1305 with an Argon2id-derived key cached in `ENCRYPTION_KEY`. Attachments use AES-256-GCM.
- **EVM:** Respect signer purpose (`squad` vs `advanced`). Treasury/deploy paths require phrase-derived `bip44_v1` signers, not imported keys. Contract addresses belong in `src/lib/evm/pacto-protocol-addresses.json`, not `.env` or comments.
- **MLS:** The `mdk` engine is not `Send` across awaits; keep engine usage in non-await scopes or use `Arc<MDK>` carefully. Use `TRUSTED_RELAYS` for keypackage and MLS events.

### Cross-cutting
- **Comments:** Keep them brief and behavior-focused. Point to `docs/` for architecture and operator setup. Never add tracker IDs, spec section markers (`§7`), or checklist breadcrumbs in source.
- **Greenfield:** No public alpha yet. Prefer breaking changes and delete obsolete paths rather than adding compatibility shims or dual-read branches.
- **Public addresses:** Protocol/factory/proxy addresses belong in tracked JSON (e.g., `src/lib/evm/pacto-protocol-addresses.json`), not in `.env.example` or `.env`.
- **Attribution:** Never add `Co-authored-by:` Cursor lines or Cursor-branded attribution blocks.

## Important Files

| File | Purpose |
|------|---------|
| `package.json` | Frontend scripts and dependencies (Tauri API/plugins, viem, SvelteKit, Vitest, Vite). |
| `pnpm-workspace.yaml` | pnpm workspace definition (single-root, build allowances only). |
| `vite.config.ts` | Vite + Vitest config; port 1420, HMR on 1421 with `TAURI_DEV_HOST`, `envPrefix: ['VITE_', 'ALCHEMY_']`. |
| `svelte.config.js` | Static adapter with SPA fallback to `index.html`. |
| `tsconfig.json` | Extends `.svelte-kit/tsconfig.json`; strict mode; bundler module resolution. |
| `.env.example` | Operator secrets template: `ALCHEMY_RPC_KEY`, `POCKET_RPC_KEY`, `VITE_WALLET_RPC_DOCS_URL`. |
| `src-tauri/Cargo.toml` | Rust crate manifest; Tauri 2.9, nostr-sdk, mdk, alloy, rusqlite, whisper. |
| `src-tauri/tauri.conf.json` | Tauri app config: dev/build hooks, window, updater, bundle. |
| `src-tauri/src/main.rs` | Binary entry point. |
| `src-tauri/src/lib.rs` | App bootstrap, global state, and the single `invoke_handler` registry. |
| `src-tauri/src/db.rs` | Per-account SQLite schema and persistence. |
| `src-tauri/src/account_manager.rs` | Account lifecycle and DB connection pool. |
| `src-tauri/src/mls.rs` | MLS group creation, keypackages, welcome processing. |
| `src-tauri/src/message.rs` | Message domain model; send/edit/react commands. |
| `src-tauri/src/chat.rs` | Chat domain model and mark-as-read. |
| `src-tauri/src/rumor.rs` | Protocol-agnostic rumor processor. |
| `src-tauri/src/stored_event.rs` | Flat event storage schema and builder. |
| `src-tauri/src/evm/mod.rs` | EVM module root; re-exports key derivation. |
| `src-tauri/src/evm/wallet_ops.rs` | Wallet summary, native balance, send transactions. |
| `src-tauri/src/evm/rpc/` | Provider, signer, call helpers, structured errors. |
| `src-tauri/src/evm/contracts/` | Alloy bindings for pacto_gov, pacto_sponsor, safe, erc20, hats. |
| `src/lib/wallet/wallet-assets.json` | Compile-time wallet chain/asset config shared with frontend. |
| `src/lib/evm/pacto-protocol-addresses.json` | Compile-time protocol address book shared with frontend. |
| `src/lib/api/nostr.ts` | Typed wrappers for Nostr/MLS/DM commands. |
| `src/lib/app/tauri-subscriptions.ts` | Central backend → UI event listener wiring. |
| `src/stores/auth.ts` | Auth state, login/create/import/unlock/logout. |
| `src/stores/persistence.ts` | Loads npub-scoped account state from `localStorage`. |
| `docs/README.md` | Docs index and navigation hub. |
| `.cursor/rules/*.mdc` | Editor-enforced project policies. |
| `.github/workflows/main.yaml` | Cross-platform Tauri release CI. |

## Runtime/Tooling Preferences

- **Package manager:** pnpm (v9 in CI; workspace is single-root with build allowances in `pnpm-workspace.yaml`).
- **Frontend runtime:** Node.js LTS; Vite dev server; SvelteKit static adapter SPA mode.
- **Backend runtime:** Rust stable toolchain; Tauri v2; tokio async runtime.
- **Type checking:** `svelte-check` via `pnpm check`. No ESLint/Prettier config is present in the repo.
- **Build orchestration:** Tauri CLI owns the loop: it runs `pnpm dev`/`pnpm build` first, then compiles the Rust backend, and the webview loads the static frontend.
- **Environment variables:** Vite exposes only `VITE_*` and `ALCHEMY_*` to the client via `envPrefix`. The Rust backend reads `ALCHEMY_RPC_KEY` and others directly from the process environment.
- **Platform-specific deps:** Linux needs WebKit2GTK 4.1, Vulkan, ALSA, appindicator; macOS needs Xcode CLT, cmake, llvm, openssl; Windows needs VS Build Tools, LLVM, WebView2, Vulkan. See `docs/build/{ubuntuGuide,macGuide,windowsGuide}.md`.
- **Whisper feature:** Enabled by default. Metal on macOS, Vulkan on Windows/Linux, excluded on Android. Feature-gated in `Cargo.toml`.
- **MCP bridge:** `tauri-plugin-mcp-bridge` is included in debug builds only; release builds exclude it.
- **CI:** `.github/workflows/main.yaml` publishes macOS (arm64 + x86_64), Ubuntu, and Windows bundles on every push to `main`. Requires `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` for the updater.

## Testing & QA

- **Frontend tests:** Vitest 3 with `environment: 'node'` and `include: ['src/**/*.test.ts']`. Tests are co-located with source code and exercise pure functions, Svelte stores, and Tauri command shapes. No component rendering or DOM tests are present.
- **Backend tests:** Standard `cargo test` in `src-tauri`. Tests are co-located in `#[cfg(test)]` modules inside source files. They use in-memory SQLite and deterministic golden vectors.
- **Common test patterns:**
  - Mock Tauri `invoke` with `vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))`.
  - Mock `localStorage`/`sessionStorage` with `vi.stubGlobal` / `vi.unstubAllGlobals`.
  - Reset Svelte stores in `beforeEach`/`afterEach`.
  - Rust DB tests create `rusqlite::Connection::open_in_memory()` and execute the minimal schema DDL inline.
- **Coverage:** `@vitest/coverage-v8` is available via `pnpm test:coverage:serve`; no configured thresholds.
- **Quality gates:** The `main.yaml` workflow only builds and publishes releases; it does **not** run `pnpm test` or `cargo test`. Local verification is the current safety net.
- **Manual QA:** `docs/wallet/MANUAL_E2E_CHECKLIST.md` and `docs/wallet/OPERATOR_SMOKE.md`.
- **Security posture:** `docs/audits/README.md` states there is no independent third-party audit; treat wallet/key-handling code as alpha-grade.

## AI Assistant Notes

- **Start every investigation at `docs/README.md`** and the relevant domain index before opening source files. If docs and code disagree, trust the code and update the doc.
- **Before adding a Tauri command:** implement it in the appropriate backend module, add `#[tauri::command]`, register it in `src-tauri/src/lib.rs`, and add a typed wrapper in `src/lib/api/<domain>.ts`.
- **Before adding an environment variable:** verify whether it is consumed by Vite (must start with `VITE_` or `ALCHEMY_`) or by Rust (read directly from `std::env`). Public protocol addresses never go in `.env`.
- **Before changing SQLite schema:** check inline DDL in any Rust test that uses `open_in_memory()`.
- **Before modifying the build or CI:** the Tauri action is the release path; changes to `vite.config.ts` or `src-tauri/tauri.conf.json` can break the desktop bundle or the updater.
- **Greenfield posture:** do not preserve legacy layouts, old wire formats, or dual-read paths unless explicitly asked. Alpha-only repair code in `docs/legacy-fixes/` should be removed before public beta.
- **Do not delete or narrow `.cursor/rules/`** unless the user explicitly asked to remove or replace a policy.
- **`install.sh` at the repo root installs an external CLI (`pacto-bot-api`)**, not the Pacto desktop app; do not use it for local desktop setup.
