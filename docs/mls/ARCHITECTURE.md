# MLS architecture (Pacto)

## Stack

- **Crates:** `mdk-core`, `mdk-sqlite-storage`, and `mdk-storage-traits` **0.8.0** from crates.io, using the `nostr` **0.44.7** line. The old git revision is no longer part of the dependency graph.
- **Facade:** **`MlsService`** in `src-tauri/src/mls.rs` — creates a persistent engine at:

  `get_mls_directory(...)/pacto-mls.db`

  (per **npub**, under the app data profile folder — see `account_manager.rs`).

## Two storage layers

1. **MDK SQLite (`pacto-mls.db`)** — cryptographic MLS state (groups, epochs, etc.) managed by the engine. Do not hand-edit.
2. **App SQLite (`pacto.db`)** — plaintext-ish metadata the UI and sync logic need:
   - **`mls_groups`** — `group_id`, `engine_group_id`, name, eviction flag, timestamps, …
   - **`mls_keypackages`** — cached key packages for members/devices
   - **`mls_event_cursors`** — last seen Nostr event per group for backfill

Decrypted **application messages** are integrated into the same **chat/message model** as DMs (see module docs at top of `mls.rs`: unified chat storage, not a separate MLS-only messages table for UX persistence).

## Store encryption and upgrades

`pacto-mls.db` is SQLCipher-encrypted. `MlsService` derives a distinct 32-byte store key from the unlocked account session key with the `pacto/mls-store/v1` domain separator; MDK never receives the app database's plaintext key material.

Before MDK 0.8.0 opens the store, `mls_store_reset.rs` reads the MDK refinery history directly. Stores from the old V100–V104 series are harvested and the entire `<npub>/mls/` directory—database, WAL, and SHM together—is moved to `<npub>/mls.archive.<timestamp>/`. A fresh encrypted store is then created. Archive directories are removed after seven days.

Seven-day retention bounds disk exposure; it does **not** revoke credentials. Until an upgraded admin restores a member (remove-then-re-add advances the epoch past the archived leaf), or members abandon an unrecovered/re-created old channel, anyone who obtains the archive can still participate as that member on the live group. Sole-admin squads never get that revoke path and must re-create, then stop using the old channel.

Unknown MDK schema versions outside **1–5** (current) and **≥100** (legacy) fail closed: the app refuses to open or archive the store rather than guessing.

The app keeps message history, chat names, and participant lists in `pacto.db`, so those remain visible. Cryptographic group state does not migrate: affected channels show the last admins recorded on the device until a new welcome restores the group. Pending legacy welcomes are re-fetched by exact wrapper event id, and the device publishes a fresh KeyPackage before it can be restored. Multi-admin rollout must leave one admin on the pre-upgrade build until others are restored. Harvest records `mls_store_reset_at` as a KeyPackage creation-time floor when no prior keypackage reference exists for a member.

### Optional real legacy fixture

CI covers reset with synthetic V100/V104 SQLite fixtures. To exercise a copied pre-upgrade `mls/` directory (including hot WAL):

```bash
export MLS_LEGACY_FIXTURE=/path/to/copied/mls   # contains a pre-rename mls store copy named vector-mls.db (+ optional -wal/-shm)
cd src-tauri && cargo test --lib mls_store_reset::tests::real_legacy_store_copy_archives_with_hot_wal_and_fresh_store_opens -- --ignored --exact
```

Or: `./scripts/run-mls-legacy-fixture-test.sh` (no-ops with exit 0 when `MLS_LEGACY_FIXTURE` is unset).

## Nostr interaction

- **Invites:** **Kind 443** (`MlsWelcome`) arrives **inside a Gift Wrap (1059)**; `lib.rs` unwrap path hands it to the engine and may emit **`mls_invite_received`**.
- **Group messages:** **Kind 444** (`MlsGroupMessage`), **`h` tag** = wire group id. Subscription handler checks membership via **`db::load_mls_groups`**, then runs engine **`process_message`** on a **blocking thread** (engine is not `Send` — see below).

## Threading / async (`lib.rs`)

All **MDK engine** use from async Tauri commands should go through **`tokio::task::spawn_blocking`** (or equivalent) so engine references do not cross `.await` points. The large comment block before **`list_group_cursors`** documents subscription behavior, deduplication keys (`inner_event_id`, `wrapper_event_id`), and privacy/logging expectations.

## Sending

From `message.rs`, MLS sends go through **`crate::mls::send_mls_message`** (and related helpers in `mls.rs`), building the same inner rumor types as DMs, then publishing **444** with the correct group reference.

## Leaving / eviction / errors

Operational behavior and known edge cases (e.g. **pending proposals**, engine state vs local metadata):

- **[EVICTION_AND_LEAVE.md](./EVICTION_AND_LEAVE.md)**  
- **[INVITES_AND_MEMBERSHIP.md](./INVITES_AND_MEMBERSHIP.md)**  
- Logout / multi-account / frontend scoping: **[`../storage-layout/ACCOUNT_LOGOUT_AND_ISOLATION.md`](../storage-layout/ACCOUNT_LOGOUT_AND_ISOLATION.md)**

## Finding Tauri commands

Grep `src-tauri/src/lib.rs` for `mls_`, `list_pending_mls`, `sync_mls`, `leave_group`, `accept_mls`, etc. Register commands in the same file’s `invoke_handler`.
