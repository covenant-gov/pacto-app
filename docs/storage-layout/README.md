# Storage layout — contributor map

Local persistence is **per Nostr account (`npub`)**: one profile directory under the Tauri **app data** path, containing **`vector.db`** (app SQLite) and **`mls/vector-mls.db`** (MLS engine).

## Read next

| Doc | Contents |
|-----|----------|
| **[SQLITE_AND_FILES.md](./SQLITE_AND_FILES.md)** | Paths on disk, main tables, migrations, what is encrypted vs plaintext |
| **[ACCOUNT_LOGOUT_AND_ISOLATION.md](./ACCOUNT_LOGOUT_AND_ISOLATION.md)** | Logout, per-npub dirs, frontend scoping |
| **[MESSAGE_ENCRYPTION.md](./MESSAGE_ENCRYPTION.md)** | PIN-encrypted event content, `[Decryption failed]`, `ENCRYPTION_KEY` |

## Canonical code

| Concern | Location |
|---------|----------|
| Schema string + `init_profile_database`, `run_migrations` | `src-tauri/src/account_manager.rs` |
| Connection pool, most queries and commands | `src-tauri/src/db.rs` |
| Event row shape / kinds | `src-tauri/src/stored_event.rs` |
| Profile row / Nostr profile merge | `src-tauri/src/profile.rs` |

## Related docs

- **MLS engine file:** [`../mls/ARCHITECTURE.md`](../mls/ARCHITECTURE.md)  
- **Legacy repair catalog:** [`../legacy-fixes/`](../legacy-fixes/)
