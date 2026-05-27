# LF-001 — EVM address auto-repair (wrong pubkey hash)

## Symptom (alpha / dev only)

- **EVM address** in Profile/settings did not match **MetaMask** after importing the exported EVM private key.
- Wallet summary could query balances for the **wrong** `0x` address while sends used the correct signer.

## Root cause

Legacy derivation used `keccak256(0x04 || x || y)` (65 bytes). Ethereum uses `keccak256(x || y)` only (64 bytes, no SEC1 `0x04` in the hash).

## What we shipped

- **Permanent:** `evm::address_from_evm_secret_32` and nostr-linked derivation used via `derive_evm_hex_from_nostr_secret` (canonical hash, no `0x04` in keccak input). User-facing: **[`docs/wallet/HD_DERIVATION_V1.md`](../wallet/HD_DERIVATION_V1.md)** (address hash rule + legacy notes).
- **Legacy only:** `db::repair_evm_address_if_needed` rewrites **`settings.evm_address`** (active signer) when it disagrees with the decrypted key-derived address (**`set_wallet_signing_evm_address`**). Mine **`profiles.evm_address`** / Kind 0 update on a separate republish path.

## Code locations

- `src-tauri/src/db.rs` — `repair_evm_address_if_needed`, `get_evm_address`, `read_stored_evm_address`
- `src-tauri/src/wallet_ops.rs` — `get_wallet_summary`

## User-facing / relay impact

Repair updates **local `settings.evm_address`** only. **Kind 0** `evm_address` for *mine* updates when the user runs **`update_profile`** or **`republish_kind0_metadata_with_wallet_default`** (default-shared merge).

## Removal checklist (before public v1)

- [ ] Decide: drop repair vs keep one release for migration.
- [ ] If dropping: remove `repair_evm_address_if_needed`; simplify `get_evm_address`; remove duplicate repair in `get_wallet_summary`.
- [ ] Keep canonical derivation in `evm.rs`; legacy notes stay in **HD_DERIVATION_V1.md**.
- [ ] Update **CATALOG.md**.
