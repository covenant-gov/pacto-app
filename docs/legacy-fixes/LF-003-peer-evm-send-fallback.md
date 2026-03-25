# LF-003 — Peer send: optional `profiles.evm_address` fallback

## Symptom (alpha / dev only)

- Older builds learned a contact’s payout address from **Kind 0** metadata and stored it on the **`profiles`** row for that npub.
- New builds use **`dm_peer_evm`** after a private **wallet_peer_info_* exchange** in the DM and **no longer** publish or ingest `evm_address` on Kind 0.

Users who never complete the new exchange might still **send** successfully if their DB still has a legacy **`profiles.evm_address`** for the peer.

## Root cause

Send resolution was extended to prefer **`dm_peer_evm`** but keep a **second lookup** so alpha installs with only profile-shaped data are not bricked before they re-exchange in DMs.

## What we shipped

- **Permanent (keep after v1):** `dm_peer_evm` table; `get_dm_peer_evm_stored` first in `wallet_build_and_send_transaction`; DM wire types in `dm-messages.ts`; no Kind 0 `evm_address` in `profile.rs` publish/parse.
- **Legacy only (candidate to remove):** If `dm_peer_evm` is empty, **`get_profile_evm_address(peer_npub)`** is still consulted for the recipient address (may reflect pre-privacy Kind 0 sync or manual DB state).

## Code locations

- `src-tauri/src/wallet_ops.rs` — `wallet_build_and_send_transaction` (peer resolution order)
- `src-tauri/src/db.rs` — `get_profile_evm_address`, `get_dm_peer_evm_stored`
- `ai-docs/wallet/PEER_EVM_ADDRESS_SYNC_AND_OBSERVABILITY.md` — full flow and removal discussion

## User-facing / relay impact

Fallback reads **local SQLite only**. It does **not** reintroduce public relay publishing of peer addresses.

## Removal checklist (before public v1)

- [ ] Confirm greenfield users never rely on peer rows in `profiles` for payout (only `dm_peer_evm` or explicit exchange).
- [ ] Optionally migrate legacy peer `profiles.evm_address` into `dm_peer_evm` once, then clear peer columns—or require one-time re-exchange.
- [ ] Remove the `get_profile_evm_address` branch from send resolution; tighten `MISSING_PEER_EVM_ADDRESS` UX to the DM exchange only.
- [ ] Update **`docs/wallet/`** if any copy still implies Kind 0 holds peer payout addresses.
- [ ] Update **CATALOG.md** (mark removed or delete row).
