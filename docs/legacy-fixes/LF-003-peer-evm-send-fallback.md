# LF-003 — Peer send: `dm_peer_evm` first, then `profiles.evm_address`

## Behavior

`wallet_build_and_send_transaction` resolves the **peer’s payout `0x` address** (DM / WalletBar send) in this order:

1. **`dm_peer_evm`** — set after a successful **`wallet_peer_info_*`** exchange in the DM (preferred; pairwise, explicit).
2. **`profiles.evm_address`** for that peer — may be populated when the app syncs the contact’s **Kind 0** metadata from relays, **or** from older local state. Used as a **secondary** source so sends still work when the user has not completed a fresh exchange.

## Kind 0 and EVM (current design)

- **Your profile (mine):** Kind 0 JSON **may** include an **`evm_address`** field for the **default-shared** EVM account (`settings.default_shared_evm_account_id` → `evm_accounts`). This is **opt-in visibility** on relays; it can differ from the **active signing** address in **`settings.evm_address`**.
- **Peers:** If a peer publishes `evm_address` on Kind 0, fetching their profile can fill **`profiles.evm_address`**. DM **send** still **prefers** `dm_peer_evm` when present.

So: **pairwise exchange** remains the primary, privacy-minded path for **knowing** you have the peer’s chosen payout address for **this** relationship; the **`profiles`** fallback covers relay-visible metadata and legacy-shaped DB rows.

## Removal checklist (before public v1)

- [ ] Confirm product is comfortable removing **`get_profile_evm_address`** fallback (send **only** after `wallet_peer_info_*`), or keep it as long as peers may expose address on Kind 0.
- [ ] If removing fallback: migrate or document UX for **`MISSING_PEER_EVM_ADDRESS`** (steer to **Request wallet information**).
- [ ] Update **`docs/wallet/MANUAL_E2E_CHECKLIST.md`** and **`docs/legacy-fixes/CATALOG.md`** when behavior changes.

## Code locations

- `src-tauri/src/wallet_ops.rs` — `resolve_peer_send_address` order
- `src-tauri/src/db.rs` — `get_dm_peer_evm_stored`, `get_profile_evm_address`, `set_dm_peer_evm_address`
- `ai-docs/wallet/PEER_EVM_ADDRESS_SYNC_AND_OBSERVABILITY.md` — flow and observability notes
- `src-tauri/src/profile.rs` — Kind 0 publish includes merged **`evm_address`** for **self**; `from_metadata` can read **`evm_address`** from Kind 0 JSON for **any** profile
