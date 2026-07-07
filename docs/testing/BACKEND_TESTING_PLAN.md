# Backend Testing Plan — Raising Rust Coverage Past 80%

**Status:** coverage exercise complete for frontend; backend coverage currently **13.45%** lines and needs a phased effort to reach 80%.

**Date:** 2026-07-05

## What we accomplished in this session

- Frontend coverage went from ~45% to **87.26%** statements, **83.66%** branches, **90.21%** functions, **87.26%** lines, all above the 80% threshold in `vite.config.ts`.
- 114 frontend test files / 1,053 tests pass (`pnpm test`).
- Backend unit tests increased from 62 to **153** passing, focused on pure/helper functions.
- Backend line coverage improved from **7.29%** to **13.45%**.

## Why backend coverage is still far from 80%

The Rust backend (`src-tauri/src/`) is built around global mutable state and Tauri runtime objects:

- `lazy_static!` / `OnceCell` globals: `STATE`, `NOSTR_CLIENT`, `MNEMONIC_SEED`, `TAURI_APP`, `ENCRYPTION_KEY`.
- No dependency-injection framework; modules reach for these globals directly.
- Most Tauri commands do relay I/O, SQLite writes, filesystem calls, or crypto with `AppHandle` and `Runtime` generics.
- Integration tests that exercise real commands would need a running Tauri app, an in-memory SQLite, or a heavy harness to mock `AppHandle`, `Emitter`, and `Manager`.

That makes a single-session jump to 80% backend coverage impractical. The remaining surface is mostly command handlers and glue that needs an integration harness, not more pure-function tests.

## Coverage snapshot after this session

| Metric | Value |
|--------|-------|
| Lines | 13.45% |
| Functions | 12.74% |
| Regions | 16.35% |

Well-covered target files from the unit-test pass:

| File | Line coverage |
|------|---------------|
| `src-tauri/src/stored_event.rs` | 100% |
| `src-tauri/src/util.rs` | 91.35% |
| `src-tauri/src/crypto.rs` | 95.21% |
| `src-tauri/src/squad_catalog.rs` | 90.22% |
| `src-tauri/src/evm/wallet_security.rs` | 97.59% |
| `src-tauri/src/evm/wallet_chain_config.rs` | 93.26% |
| `src-tauri/src/evm/pacto_chain_config.rs` | 93.66% |
| `src-tauri/src/evm/contract_call_params.rs` | 98.31% |
| `src-tauri/src/evm/rpc/address.rs` | 97.73% |

Files that remain hard to cover without an integration harness:

| File | Coverage | Reason |
|------|----------|--------|
| `src-tauri/src/db.rs` | low | `AppHandle`/`Runtime` generics on every public function; schema is already tested implicitly by most integration paths. |
| `src-tauri/src/mls.rs` | low | Needs `MDK` engine and `AppHandle`; engine is not `Send` across awaits. |
| `src-tauri/src/message.rs` | low | Commands wrap DB + NIP-17 unwrap + global state. |
| `src-tauri/src/chat.rs` | low | Commands wrap DB + global `TAURI_APP`. |
| `src-tauri/src/rumor.rs` | low | Needs real/faked Nostr events and MLS keys. |
| `src-tauri/src/evm/wallet_ops.rs` | low | Requires signer derivation and RPC. |
| `src-tauri/src/evm/safe_deploy.rs` | low | On-chain deployment; testnet integration test. |
| `src-tauri/src/evm/provider.rs` / `signer.rs` | low | Requires real RPC keys or mock provider. |
| `src-tauri/src/net.rs` | low | Network I/O. |
| `src-tauri/src/blossom.rs` | low | Network I/O; `upload_blob` is currently unused. |

## Recommended phased approach

### Phase 1 — Stable harness for command-level tests

**Goal:** Run Tauri commands without a live desktop app or relay.

- Introduce a lightweight `TestAppHandle` for `AppHandle::emit` and `Manager` traits, or use `tauri::test` mocks if available in Tauri 2.
- Refactor a small number of commands to accept `app: &AppHandle` explicitly so they can be exercised with the mock handle in tests.
- Provide an in-memory SQLite connection factory and a `clear_test_db` helper.
- Add a `cfg(test)` helper that can set/reset `ENCRYPTION_KEY` with a deterministic key.

### Phase 2 — Extract and test protocol handlers

**Goal:** Cover the rumor/message/chat pipeline without touching the network.

- Split `rumor::process_rumor` into pure functions that accept a `RumorEvent` and return a `RumorProcessingResult`, with a thin async wrapper for the command.
- Test the pure functions with golden vectors (text, attachment, reaction, edit, poll, typing, unknown).
- Add a `MockNostrClient` that returns pre-canned events and verifies published events.

### Phase 3 — EVM integration tests against a local anvil node

**Goal:** Cover deploy, send, and treasury flows.

- Use `anvil` (Foundry) as a local node in tests.
- Load a deterministic mnemonic for test accounts.
- Test the full flow: derive signer → deploy Safe → deploy PactoGov → create proposal → vote → execute.
- Mark these tests with `#[ignore]` and run them in a dedicated CI job because they need an RPC node.

### Phase 4 — MLS smoke tests with test vectors

**Goal:** Cover keypackage, welcome, and group message flows.

- Keep the `MDK` engine usage in non-await scopes or wrap an `Arc<Mutex<MDK>>`.
- Generate MLS test vectors offline and store them in `src-tauri/src/mls_test_vectors/`.
- Test welcome processing, group creation, and message decryption using the vectors.

### Phase 5 — Continuous coverage gating

- Add `cargo-llvm-cov` or `cargo-tarpaulin` to CI.
- Set a baseline threshold and ratchet it up as coverage improves.
- Exclude generated contract bindings and UI event strings from coverage.

## Quick commands to run coverage

```bash
# Frontend
cd /Users/opselite/src/covenant-gov/pacto-app
pnpm test:coverage

# Backend
cd src-tauri
cargo llvm-cov --lib --summary-only
```

## Frontend acceptance tests

End-to-end / screenshot acceptance tests are intentionally out of scope for now because the project does not have a Playwright or Puppeteer harness for the Tauri webview. When that changes, the priority acceptance scenarios would be:

1. Create account → login → view DM list.
2. Create a squad → open a channel → send a message.
3. Send a wallet transaction and see confirmation toast.
4. Create a governance proposal and vote.

## Acceptance criteria for this session

- [x] Frontend coverage exceeds 80% on all four metrics.
- [x] All frontend tests pass (`pnpm test`).
- [x] Backend unit tests pass (`cargo test --lib`).
- [x] Backend coverage measured and documented.
- [x] Frontend acceptance-test gap documented with a skip reason.
- [x] Backend phased plan documented (this file).
