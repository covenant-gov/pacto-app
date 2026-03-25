# MLS architecture (Pacto)

## Stack

- **Crate path:** `mdk_core`, `mdk_sqlite_storage` — MDK engine with **`MdkSqliteStorage`**.
- **Facade:** **`MlsService`** in `src-tauri/src/mls.rs` — creates a persistent engine at:

  `get_mls_directory(...)/vector-mls.db`

  (per **npub**, under the app data profile folder — see `account_manager.rs`).

## Two storage layers

1. **MDK SQLite (`vector-mls.db`)** — cryptographic MLS state (groups, epochs, etc.) managed by the engine. Do not hand-edit.
2. **App SQLite (`vector.db`)** — plaintext-ish metadata the UI and sync logic need:
   - **`mls_groups`** — `group_id`, `engine_group_id`, name, eviction flag, timestamps, …
   - **`mls_keypackages`** — cached key packages for members/devices
   - **`mls_event_cursors`** — last seen Nostr event per group for backfill

Decrypted **application messages** are integrated into the same **chat/message model** as DMs (see module docs at top of `mls.rs`: unified chat storage, not a separate MLS-only messages table for UX persistence).

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
