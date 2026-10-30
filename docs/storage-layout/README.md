# Storage layout — contributor map

Local persistence is **per Nostr account (`npub`)**: one profile directory under the Tauri **app data** path, containing **`pacto.db`** (app SQLite) and **`mls/pacto-mls.db`** (MLS engine).

## Read next

| Doc | Contents |
|-----|----------|
| **[SQLITE_AND_FILES.md](./SQLITE_AND_FILES.md)** | Paths on disk, main tables, migrations, what is encrypted vs plaintext |
| **[ACCOUNT_LOGOUT_AND_ISOLATION.md](./ACCOUNT_LOGOUT_AND_ISOLATION.md)** | Logout, per-npub dirs, frontend scoping |
| **[MESSAGE_ENCRYPTION.md](./MESSAGE_ENCRYPTION.md)** | PIN-encrypted event content, `[Decryption failed]`, `ENCRYPTION_KEY` |

## Canonical code

| Concern | Location |
|---------|----------|
| Schema migrations | `src-tauri/src/migrations/` |
| Connection pool and account lifecycle | `src-tauri/src/account_manager.rs` |
| Stable database API and command exports | `src-tauri/src/db/mod.rs` |
| Profiles, settings, username claims, export audit | `src-tauri/src/db/accounts.rs` |
| Shared chat/user ID caches and resolution | `src-tauri/src/db/ids.rs` |
| Squad persistence and MLS announcement side effects | `src-tauri/src/db/squad.rs` |
| Squad/global sponsored fee ledgers | `src-tauri/src/db/sponsored_fees.rs` |
| App-side MLS metadata and reset-support persistence | `src-tauri/src/db/mls.rs` |
| Chat/event/message storage and materialization | `src-tauri/src/db/messaging.rs` |
| Event row shape / kinds | `src-tauri/src/stored_event.rs` |
| Profile row / Nostr profile merge | `src-tauri/src/profile.rs` |

## Related docs

- **MLS engine file:** [`../mls/ARCHITECTURE.md`](../mls/ARCHITECTURE.md)  
- **Legacy repair catalog:** [`../legacy-fixes/`](../legacy-fixes/)
