# LF-001 — EVM address auto-repair (wrong pubkey hash)

## Symptom (alpha / dev only)

- **EVM address** in Profile/settings did not match **MetaMask** after importing the exported EVM private key.
- Wallet summary could query balances for the **wrong** `0x` address while sends used the correct signer.

## Root cause

Legacy derivation used `keccak256(0x04 || x || y)` (65 bytes). Ethereum uses `keccak256(x || y)` only (64 bytes, no SEC1 `0x04` in the hash).

## What we shipped

- **Permanent:** `evm::address_from_evm_secret_32` / `derive_evm_from_nostr_secret` with canonical hash. User-facing: **[`docs/wallet/EVM_ADDRESS_DERIVATION.md`](../wallet/EVM_ADDRESS_DERIVATION.md)**.
- **Legacy only:** `db::repair_evm_address_if_needed` and call sites that rewrite `settings.evm_address` + `profiles.evm_address` when they disagree with the key-derived address.

## Code locations

- `src-tauri/src/db.rs` — `repair_evm_address_if_needed`, `get_evm_address`, `read_stored_evm_address`
- `src-tauri/src/wallet_ops.rs` — `get_wallet_summary`

## User-facing / relay impact

Repair updates **local** DB only. **Nostr profile** `evm_address` may stay wrong until the user republishes metadata.

## Removal checklist (before public v1)

- [ ] Decide: drop repair vs keep one release for migration.
- [ ] If dropping: remove `repair_evm_address_if_needed`; simplify `get_evm_address`; remove duplicate repair in `get_wallet_summary`.
- [ ] Keep canonical derivation in `evm.rs`; trim **EVM_ADDRESS_DERIVATION.md** legacy section if appropriate.
- [ ] Update **CATALOG.md**.
