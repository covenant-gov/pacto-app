---
date: 2026-07-15
topic: security-review-fixes
---

# Security Review Hardening

## Summary

Address four unresolved security-review findings by hardening local encryption and key-export behavior: replace the hard-coded Argon2 salt with a per-device random salt and migrate existing data; replace the client-side `sessionStorage` unlock flag with a backend session check; and move sensitive private-key export (EVM, Nostr nsec, and BIP-39 seed phrase) to a backend-mediated clipboard flow with a 90-second auto-clear, user confirmation, and audit logging.

## Problem Frame

A security review of Pacto's alpha codebase identified four issues that remain unresolved:

1. **Hard-coded Argon2 salt.** The key derivation function uses the same fixed salt for every device and account. Identical PINs produce identical keys, weakening local-at-rest encryption against pre-computation and rainbow-table attacks.
2. **Client-side session unlock flag.** The frontend stores a `pacto_session_unlocked` marker in `sessionStorage` and uses it to recover from partial unlocks or HMR. This is a client-side trust boundary that a script could manipulate.
3. **Plaintext key export.** The backend command that exports an EVM private key returns the raw hex key as a string to the webview, where it sits in JavaScript memory and is displayed on screen. The same pattern applies to Nostr nsec and BIP-39 seed phrase exports.
4. **Unresolved random-salt migration.** The code contains a TODO noting that a random on-disk salt should be created at first init, but no migration path has been implemented.

These issues are local-device security concerns. They do not affect the cryptographic protocols used for Nostr/MLS messaging or on-chain EVM operations, but they do affect how secrets are stored and exported on the user's own machine.

## Key Decisions

- **Migration strategy:** Existing accounts will be migrated to the new salt via in-place, per-row re-encryption on the user's first unlock after the change. The legacy hard-coded salt path remains available only until the migration completes, and is scheduled for removal in v0.5.0.
- **Salt storage:** The random salt is stored in the SQLite settings table (`key_derivation_salt`) with a `key_derivation_version` marker. It is treated as disposable local data alongside the database; the BIP-39 recovery phrase remains the portable cross-device backup.
- **Migration source of truth:** The `key_derivation_version` setting is the canonical source of truth. A value of `1` means the legacy hard-coded salt; `2` means the per-device random salt. The migration runs when the version is not `2` and the user successfully unlocks.
- **Migration failure handling:** Re-encryption happens one row at a time. If the migration is interrupted, the account remains recoverable because the legacy key is still known, and the migration retries from the beginning on the next unlock. After the migration completes successfully, the legacy path is strictly disabled for that account.
- **Session unlock flag:** Replace the frontend `sessionStorage` flag with a backend session check that reports whether the encryption key is still in memory. The frontend checks session state on startup, on app focus/resume, and before every sensitive command.
- **Session key lifecycle:** The encryption key is stored in a secret manager-backed container that supports zeroization and memory locking. The key is cleared automatically after a configurable idle timeout (default 15 minutes) or on logout. The backend session check is a UX guard, not a defense against memory extraction.
- **Sensitive key export channel:** Move EVM private-key, Nostr nsec, and BIP-39 seed-phrase exports to a backend-mediated clipboard flow. Rust writes the secret directly to the system clipboard and returns only metadata to the frontend; the secret never enters the webview JavaScript layer.
- **Clipboard hygiene:** Clear the clipboard automatically after 90 seconds, unconditionally. Display a user-visible confirmation modal warning that clipboard managers, OS clipboard history, and cross-device clipboard sync may still capture the secret.
- **Export gating:** Require explicit user confirmation and PIN re-entry before export. Apply exponential backoff to repeated export attempts.
- **Audit logging:** Log each export event with a timestamp, account/secret type, and account identifier in a per-account SQLite table.
- **Deferred work:** File-based export, clipboard-history exclusion, configurable clipboard timeout, and PIN policy changes are follow-up items, not part of this pass.
- **Out of scope for this document:** A standalone threat model document. The team accepts that the session check is a UX guard, not a memory-extraction defense, and that memory-hardening is tracked as follow-up work.

## Requirements

### Salt and key-derivation hardening

- **R1.** The backend uses a cryptographically random, per-device salt for Argon2 key derivation for new accounts.
- **R2.** The salt is stored in the account's SQLite settings table (`key_derivation_salt`) with a `key_derivation_version` marker (`1` for legacy hard-coded salt, `2` for random salt). The salt file is also written to disk with restricted filesystem permissions (0600 on Unix, protected on Windows) as a redundant cache.
- **R3.** Existing accounts created with the hard-coded salt can still be unlocked after the change.
- **R4.** On the first successful unlock after the change, an existing account is migrated: the backend validates the PIN by decrypting a sentinel value with the legacy key, then decrypts and re-encrypts each encrypted row with the new salt-derived key, one row per transaction.
- **R4a.** When the migration completes successfully, the backend emits a `migration_complete` event and the frontend shows a brief toast notification such as "Account security updated."
- **R5.** If the migration is interrupted, the account remains recoverable with the legacy salt path until the migration completes successfully. On the next unlock, the migration retries from the beginning.
- **R6.** After migration completes successfully, the backend strictly refuses to use the legacy hard-coded salt for that account. If the salt or version marker is missing or tampered with, the user must restore from their BIP-39 recovery phrase.
- **R7.** The legacy hard-coded salt path is deprecated and will be removed in v0.5.0.

### Session unlock state

- **R8.** The frontend no longer relies on a `sessionStorage` flag to determine whether the session is unlocked.
- **R9.** The frontend asks the backend for the current session state on startup, on app focus/resume, and before every sensitive command (e.g., sending a message, exporting a key, signing a transaction).
- **R10.** The backend reports the session as unlocked only when the encryption key is present in memory.
- **R11.** When the backend reports the session as not unlocked, the frontend drops its authenticated state and returns to the full-screen unlock screen.
- **R12.** The encryption key is stored in a secret-managed container that supports zeroization and memory locking (e.g., `zeroize` + `mlock` or equivalent). The key is cleared from memory on logout and on auto-lock.
- **R13.** The session auto-locks after a configurable idle timeout (default 15 minutes). The key is cleared from memory when auto-lock fires.

### EVM private-key export

- **R14.** The backend exposes EVM private-key export only through a command that returns metadata, not the raw key.
- **R15.** The backend requires PIN re-entry before exporting a key.
- **R16.** The backend applies exponential backoff to repeated export attempts from the same account.
- **R17.** The backend writes the exported key directly to the system clipboard from the native layer.
- **R18.** The backend clears the clipboard 90 seconds after the export, unconditionally.
- **R19.** The backend clears the clipboard on app shutdown or crash if the export timer is still active.
- **R20.** The frontend shows a confirmation modal before the backend writes the key. The modal warns that clipboard managers, OS clipboard history, and cross-device clipboard sync may still capture the key.
- **R21.** The frontend removes any code that currently receives or displays the raw EVM private key string.
- **R22.** The backend logs each export event with a timestamp, the exported account address, and the event type in a per-account SQLite table (`evm_key_export_log` or similar).
- **R23.** The export flow supports cancellation and error states: if the user cancels, the backend never touches the clipboard; if an error occurs, the backend logs the failure and does not leave the key in the clipboard.

### Nostr nsec and BIP-39 seed phrase export

- **R24.** Nostr nsec and BIP-39 seed phrase exports follow the same backend-mediated clipboard flow as EVM private-key exports (R14–R23).
- **R25.** The frontend removes any code that currently receives or displays the raw nsec or seed phrase string.

## Key Flows

### F1. First unlock after the salt migration

- **Trigger:** A user launches Pacto after the salt-hardening update and enters their PIN to unlock an existing account.
- **Steps:**
  1. The backend reads `key_derivation_version` from the SQLite settings table. If the version is `2`, the account is already migrated; proceed with normal unlock.
  2. If the version is not `2`, the backend derives the legacy key using the hard-coded salt.
  3. The backend validates the PIN by decrypting a sentinel value with the legacy key.
  4. The backend generates a new random salt, derives the new key, and persists the salt and `version=2` marker.
  5. The backend processes each encrypted row: if it can be decrypted with the new key, it is already migrated; otherwise it is decrypted with the legacy key and re-encrypted with the new key, one row per transaction.
  6. The backend validates the sentinel value again with the new key and marks the migration complete.
- **Outcome:** Subsequent unlocks use the new salt-derived key. The legacy path is no longer available for this account.
- **Failure:** If the migration is interrupted, the version remains `1` and the retry continues from the beginning on the next successful unlock.

### F2. Sensitive private-key export

- **Trigger:** A user selects "Export private key" for an EVM account, Nostr nsec, or BIP-39 seed phrase in settings.
- **Steps:**
  1. The frontend shows a confirmation modal that explains the clipboard risk and warns about clipboard managers, history, and cross-device sync.
  2. The user confirms and enters their PIN.
  3. The frontend sends the account ID / export type to the backend export command.
  4. The backend validates the PIN and checks the export backoff state.
  5. The backend logs the export attempt.
  6. The backend writes the secret to the system clipboard.
  7. The backend starts a 90-second timer to clear the clipboard.
  8. The frontend shows "Copied to clipboard. It will be cleared in 90 seconds."
- **Cancellation:** If the user cancels before step 6, the backend does not write to the clipboard.
- **Error:** If any step fails, the backend logs the failure and ensures the clipboard is not left with the secret.
- **Outcome:** The secret is available on the clipboard for 90 seconds, but never enters the webview.

### F3. Session drop on stale state

- **Trigger:** The frontend believes the session is unlocked, but the backend no longer has the encryption key in memory.
- **Steps:**
  1. The frontend checks session state (on startup, focus/resume, or before a sensitive command).
  2. The backend reports `not unlocked`.
  3. The frontend navigates to the full-screen unlock screen.
- **Outcome:** The user must re-enter their PIN to continue.

## Acceptance Examples

### AE1. New account uses a random salt

- **Given:** A user creates a new account after the change.
- **When:** The account is created and the PIN is set.
- **Then:** A random salt is generated, stored in SQLite with `version=2`, and the encryption key is derived from that salt.

### AE2. Existing account unlocks after the change

- **Given:** An account was created before the salt change.
- **When:** The user unlocks with the correct PIN.
- **Then:** The account unlocks successfully, and the migration to the new salt runs transparently one row at a time.

### AE3. Clipboard clears after 90 seconds

- **Given:** A user has exported a sensitive key to the clipboard.
- **When:** 90 seconds pass.
- **Then:** The backend clears the clipboard.

### AE4. Stale frontend session is dropped

- **Given:** The frontend is open but the backend no longer has the encryption key in memory.
- **When:** The frontend checks session state.
- **Then:** The backend reports not unlocked, and the frontend returns to the full-screen unlock screen.

### AE5. Sensitive features require migration

- **Given:** An account has not yet migrated to the new salt.
- **When:** The user attempts to export a key or create a new squad.
- **Then:** The backend requires the user to unlock and complete the migration first.

## Scope Boundaries

- **In scope:** Argon2 salt hardening and migration; backend session check; auto-lock; memory hardening for the encryption key; backend-mediated clipboard export for EVM, nsec, and seed phrase; export audit logging; export confirmation and backoff.
- **Deferred for later:** File-based export of private keys; exclusion from OS clipboard history; configurable clipboard timeout; PIN policy changes (length, complexity); migration telemetry; standalone threat model document.
- **Outside this product's identity:** Independent third-party security audit; multi-device database portability beyond the BIP-39 recovery phrase; changing the encryption algorithm from ChaCha20-Poly1305.

## Dependencies / Assumptions

- Tauri v2's clipboard plugin exposes `writeText` and `clear` APIs.
- The existing Argon2 and ChaCha20-Poly1305 libraries remain in use.
- The `zeroize` crate (or equivalent) is available for clearing sensitive buffers from memory.
- Memory locking (`mlock` or platform equivalent) is available on desktop targets; mobile behavior may degrade gracefully.
- Users are expected to back up their BIP-39 recovery phrase; the salt and local database are not portable.
- The migration runs only when the user successfully unlocks after the update.
- The legacy hard-coded salt path is removed in v0.5.0; all accounts created before that version must have migrated by then.

## Outstanding Questions

- None. All review findings have been resolved or deferred to later work per the Scope Boundaries.

## Sources / Research

- Current Argon2 implementation and hard-coded salt: `src-tauri/src/crypto.rs`
- Current session unlock flag: `src/stores/auth.ts`
- Current EVM key export command: `src-tauri/src/evm/evm_accounts.rs` and `src/components/settings/EvmAccountKeyExportModal.svelte`
- 1Password support: copied items are automatically removed from the clipboard after a configurable timeout (default ~90 seconds).
- Tauri v2 clipboard plugin: `tauri-plugin-clipboard-manager` exposes `writeText`, `readText`, and `clear`.
- There is no reliable cross-platform API to exclude clipboard text from OS clipboard history or third-party clipboard managers.
