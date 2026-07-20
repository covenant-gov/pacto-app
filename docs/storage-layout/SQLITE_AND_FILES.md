# SQLite and on-disk layout

## Per-account directory

For a given **`npub`** (full `npub1…` string):

| Path (under Tauri `app_data_dir`) | Role |
|-----------------------------------|------|
| `<npub>/` | Profile directory — `account_manager::get_profile_directory` |
| `<npub>/vector.db` | Primary app database — `get_database_path` |
| `<npub>/mls/` | MLS directory — `get_mls_directory` |
| `<npub>/mls/vector-mls.db` | MDK engine database (see `docs/mls/ARCHITECTURE.md`) |

Account discovery scans **`npub1*`** subfolders and validates stored keys — see **`list_accounts`** in `account_manager.rs`.

## `vector.db` schema (source of truth)

The **authoritative schema and migration history** lives in **`src-tauri/src/migrations/`** as ordered refinery migration files (`V1__initial_schema.sql`, `V2__messages_wrapper_event_id.sql`, …). **`init_profile_database`** and **`get_db_connection`** run the refinery migration runner on every database open, so new accounts start at the latest version and existing accounts are migrated automatically.

Old accounts are detected by the absence of `refinery_schema_history` and the presence of `settings`; on first refinery run they are **baselined** by stamping the full migration history without re-running the migrations.

### Core tables (conceptual)

| Table | Role |
|-------|------|
| **profiles** | Contacts / users: npub, names, avatar URLs, **`evm_address`**, cached paths, … |
| **chats** | Conversation metadata: `chat_identifier` (npub or hex group id), `chat_type`, participants JSON, … |
| **messages** | Legacy/parallel message storage (encrypted content field); migration history references it |
| **events** | **Primary** flat storage for Nostr-shaped events (kind, content, tags JSON, chat_id, pending/failed flags, `wrapper_event_id`, …) |
| **settings** | Key-value (`pkey`, `evm_pkey`, `evm_address`, …) |
| **mls_groups** | MLS group metadata for the app (wire id, engine id, eviction) |
| **mls_keypackages** | Key package cache |
| **mls_event_cursors** | Sync cursors per group |
| **squad_safe** | Squad/network id → Safe address |
| **squad_infra** | On-chain deploy pointers (`pacto_gov`, sponsor, Safe, …) + `provider_payload` |
| **squad_member_evm** / **squad_member_evm_account** | Roster address / local signing-account binding per parent |
| **squad_tracked_tokens** | Squad-shared ERC-20 watchlist for Treasury Safe balance UI (MLS announce sync) |

Indexes and foreign keys are defined next to each table in the migration files.

## Encryption vs plaintext

`account_manager.rs` documents intent: **message content and secrets** are stored encrypted where noted; **profiles and indexing metadata** are plaintext for performance and search. Exact encrypt/decrypt paths live in **`crypto.rs`** and call sites in **`db.rs`** / **`lib.rs`**.

## `db.rs` usage pattern

Most Tauri **`#[command]`** database entry points are implemented in **`db.rs`**: get/return connection via **`account_manager::get_db_connection`** / **`return_db_connection`**, parameterized SQL, map rows to structs used by the UI.

When adding a column or table:

1. Add a new numbered migration file under **`src-tauri/src/migrations/`** (`V{next}__{description}.sql` for schema changes, or a `.rs` migration if the transformation requires generated SQL).
2. The refinery runner will apply it automatically on the next app start/unlock.

## Frontend / other storage

Browser **localStorage** and in-memory stores can still hold account-specific UI state; see **[ACCOUNT_LOGOUT_AND_ISOLATION.md](./ACCOUNT_LOGOUT_AND_ISOLATION.md)** for how that interacts with backend per-npub isolation.

## Naming note

Comments in Rust sometimes say **“Vector”** database; the shipped app name is **Pacto** — same files and paths.

## See also

- **[ACCOUNT_LOGOUT_AND_ISOLATION.md](./ACCOUNT_LOGOUT_AND_ISOLATION.md)** — what logout deletes, multi-account, frontend keys  
- **[MESSAGE_ENCRYPTION.md](./MESSAGE_ENCRYPTION.md)** — PIN-encrypted `events.content` and decryption failures
