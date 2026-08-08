# SQLite and on-disk layout

## Per-account directory

For a given **`npub`** (full `npub1…` string):

| Path (under Tauri `app_data_dir`) | Role |
|-----------------------------------|------|
| `<npub>/` | Profile directory — `account_manager::get_profile_directory` |
| `<npub>/pacto.db` | Primary app database — `get_database_path` |
| `<npub>/mls/` | MLS directory — `get_mls_directory` |
| `<npub>/mls/vector-mls.db` | MDK engine database (see `docs/mls/ARCHITECTURE.md`) |
| `<npub>/mls.archive.<unix-seconds>/` | A complete pre-upgrade MLS store set (`vector-mls.db`, `-wal`, and `-shm` together), retained for seven days |

Account discovery scans **`npub1*`** subfolders and validates stored keys — see **`list_accounts`** in `account_manager.rs`.

**Legacy filename migration:** `pacto.db` was named `vector.db` before Pacto forked from the upstream Vector project. `account_manager::migrate_legacy_databases` runs once per app launch, before any other database or profile access, and renames each profile's `vector.db` (plus any live `-wal`/`-shm` companions) to `pacto.db` in place. It is idempotent and safe to interrupt: WAL/SHM companions move before the main file, so a crash mid-migration just leaves `vector.db` as the source of truth for the next launch to retry.

## `pacto.db` schema (source of truth)

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
| **mls_legacy_admins** | Last-known admin npubs harvested before a legacy MLS reset; unique by `(group_id, admin_npub)` and intentionally independent of `mls_groups` foreign keys |
| **mls_keypackages** | Key package cache |
| **mls_event_cursors** | Sync cursors per group |
| **squad_safe** | Squad/network id → Safe address |
| **squad_infra** | On-chain deploy pointers (`pacto_gov`, sponsor, Safe, …) + `provider_payload` |
| **squad_member_evm** / **squad_member_evm_account** | Roster address / local signing-account binding per parent |
| **squad_tracked_tokens** | Squad-shared ERC-20 watchlist for Treasury Safe balance UI (MLS announce sync) |

Indexes and foreign keys are defined next to each table in the migration files.

## Encryption vs plaintext

`account_manager.rs` documents intent: **message content and secrets** are stored encrypted where noted; **profiles and indexing metadata** are plaintext for performance and search. Exact encrypt/decrypt paths live in **`crypto.rs`** and call sites in **`db.rs`** / **`lib.rs`**. The app database remains an unkeyed SQLite file even though the binary now links SQLCipher; its file format and hot-WAL behavior remain compatible.

The active MLS database is SQLCipher-encrypted with a key domain-separated from the unlocked account session key. The shipped native stack is **SQLCipher 4.6.1 Community**, **SQLite 3.46.1**, `openssl-src` **300.6.1+3.6.3**, and `openssl-sys` **0.9.117**. These libraries are vendored into application releases and must be matched against future security advisories explicitly.

## MLS legacy reset

`mls_store_reset.rs` runs before MDK opens `vector-mls.db`. It classifies the old V100–V104 migration series as legacy; MDK 0.8.0 V1–V5 stores are current. For a legacy store it harvests known group admins and pending welcome wrapper ids, commits those rows and reset settings to `pacto.db`, atomically moves the whole `mls/` directory to a timestamped sibling, and only then writes the completion marker. Missing files and interrupted runs are safe to re-enter, and reset work is serialized per account.

The pending wrapper ids are removed from `discarded_giftwraps` and retained in a durable exact-refetch queue, because the normal forward sync window may no longer include an old invitation. Lost group ids remain in a settings value until a welcome restores that group; while listed, participant synchronization does not replace the surviving chat roster with an empty fresh-engine roster.

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
