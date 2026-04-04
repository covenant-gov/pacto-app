# ISSUE 02 — Aztec key material from seed, encrypted storage, Settings UX, export, faucet verification

## Goal

Let an authenticated user **derive or initialize Aztec key material from their existing BIP-39 seed**, **persist it encrypted** in local storage, and **export** the Aztec **secret key** (and related export bundle) from Settings after PIN unlock — without re-deriving the secret from the mnemonic on every session solely for export.

This issue builds on **ISSUE 01** (sidecar can run Aztec/Noir-related code paths where required). It does **not** need the full DM transfer UI (ISSUE 03).

Useful context from the stakeholder plan (not replicated): same-seed direction, encrypted fields, Rust gating, and sidecar for heavy lifting — see [embedded-wallet-plan.md](https://github.com/covenant-gov/pacto-app/blob/feat/aztec-wallet/docs/issues/aztec/embedded-wallet-plan.md).

## Product requirements

### Key generation and storage

1. **Generate** an Aztec key pair (or the Aztec-specific secrets required by the chosen account model) **tied only to the user’s existing seed phrase** — following Aztec’s current account and signing expectations (Schnorr / embedded wallet patterns as per official docs at integration).
2. **Persist ciphertext + metadata** to **local SQLite/files** using the same security patterns as existing wallet material (`docs/storage-layout/`, `docs/wallet/HD_DERIVATION_V1.md`, `MESSAGE_ENCRYPTION.md` as relevant).
3. **Sidecar role**: derivation or contract-interaction steps that are awkward in Rust/WebView may run in the **Node sidecar** (ISSUE 01), but the **canonical secret for export** must be **stored encrypted** after first successful creation so that:
   - Export does **not** depend on “always re-derive from mnemonic” for the Aztec private/secret key.
   - Future formats (e.g. backup file) can decrypt **from storage + PIN** consistently.

### PIN and export

1. **Decrypt for export** with the user’s **PIN** / session policy aligned with EVM export flows in Settings.
2. **Settings → Wallet** (`WalletView` / Profile wallet tab): add an **Aztec section below the existing EVM section**:
   - Primary action: **Generate Aztec key pair** (or “Initialize Aztec wallet”) — may **start the sidecar** as needed; show clear loading and error states.
   - After success: show address (and optional short status); link or copy helpers as appropriate.
3. **Settings export area** (alongside seed phrase, EVM keys, Nostr key): after a key pair exists, allow revealing **Aztec secret key** through the same **export / danger zone** conventions as other sensitive material (confirmations, copy affordances, no logging).

### Faucet verification (required for “done”)

Prove the generated material works with real devnet mechanics:

1. Use the [Aztec Faucet (Nethermind)](https://aztec-faucet.nethermind.io/) — Fee Juice / devnet flows as documented there.
2. The faucet flow may expect a **curl command using the Aztec secret key**; implementation must therefore support the user **accessing their secret key** (export path) for testing and for power users.
3. Document in `docs/wallet/` the exact curl or CLI steps used in QA (no secrets in repo; placeholders only).

## Engineering notes

- **Derivation vs stored blob**: If Aztec requires deployment registration or extra ciphertext beyond a single scalar, schema design should allow migrations (nullable columns, lazy init). Align with `docs/wallet/` when the Aztec account model is fixed.
- **Sidecar start/stop**: Key generation must not leave the sidecar running indefinitely; prefer explicit session or supervisor rules from ISSUE 01.
- **No secrets in logs**: redact RPC URLs with keys; never log mnemonic, PIN, or raw Aztec secret.

## Acceptance criteria

- [ ] User can create Aztec key material from **seed-only** linkage (no separate mnemonic) and see confirmation in Settings.
- [ ] Persisted ciphertext survives app restart; **export** decrypts with **PIN** and shows Aztec secret for manual faucet/curl testing.
- [ ] Export surface lists **seed phrase, EVM keys, Nostr key, Aztec secret** in one coherent UX (Aztec appears only after initialization).
- [ ] Manual QA checklist step: receive funds or Fee Juice from [aztec-faucet.nethermind.io](https://aztec-faucet.nethermind.io/) using documented curl + secret key path.
- [ ] Storage and encryption documented under `docs/wallet/` or `docs/storage-layout/` as appropriate.

## References

- [embedded-wallet-plan.md](https://github.com/covenant-gov/pacto-app/blob/feat/aztec-wallet/docs/issues/aztec/embedded-wallet-plan.md) — phases on persistence, commands, same-seed feasibility
- [Aztec Faucet](https://aztec-faucet.nethermind.io/)
- `docs/wallet/README.md`, `docs/wallet/HD_DERIVATION_V1.md`, `docs/storage-layout/SQLITE_AND_FILES.md`
