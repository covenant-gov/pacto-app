# AI testing log sanitization audit

**Date:** 2026-07-21  
**Scope:** Phase 2 real-Tauri harness (`scripts/run-e2e-tauri.mjs`, `e2e-tauri/message-send.spec.mjs`, and related Rust debug commands).

## Posture

The Phase 2 harness captures Rust stdout/stderr, webview console logs, and screenshots
into `test-results/tauri-e2e/<run-id>/`. These artifacts may be archived on CI or
reviewed by agents, so they must not contain mnemonics, PINs, or private keys.

## Findings

- `test_login_fixture` (gated by `#[cfg(debug_assertions)]` and `PACTO_ALLOW_TEST_AUTH=1`)
  generates a fresh Nostr keypair. It does **not** log the secret key, mnemonic, or PIN.
  The returned payload only exposes the public `npub`.
- The existing `debug_hot_reload_sync` returns the full in-memory `ChatState`, which
  contains `Profile` objects but no private key material.
- The wrapper script logs command success/failure and saves raw stdout/stderr from the
  Tauri process. No secrets are emitted by the harness itself.
- No obvious logging of mnemonics, PINs, or `nsec` values was found in the reviewed
  commands in `src-tauri/src/lib.rs`.

## Gaps / follow-up

- Rust `println!` / `eprintln!` elsewhere in the backend may still leak sensitive
  values under debug logging. Before enabling a combined merged-log mode, each
  `println!`-style log line that touches keys, seeds, or PINs should be reviewed.
- Screenshots could inadvertently show a secret if the UI renders one. The current
  test fixture avoids PIN entry, so this is not a concern for the Phase 2 spec.

## Verdict

Phase 2 merged logging is safe for the current fixture-auth path, but a dedicated
pass is required before any broad merged-logging feature is enabled.
