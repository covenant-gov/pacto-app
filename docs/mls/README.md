# MLS (Message Layer Security) — contributor map

Group messaging uses **nostr-mls** / **MDK** with **SQLite-backed** engine state, plus app tables in the main **`vector.db`** for group metadata and cursors.

## Read next

| Doc | Contents |
|-----|----------|
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | Engine path, tables, subscriptions, Tauri commands, threading model |
| **[VIRTUAL_CHANNEL_ROUTING_ADR.md](./VIRTUAL_CHANNEL_ROUTING_ADR.md)** | Normative virtual buckets (`announcements` / `inbox` / `polls`): rumor tag + JSON field + derivation (single-group refactor) |
| **[INVITES_AND_MEMBERSHIP.md](./INVITES_AND_MEMBERSHIP.md)** | Welcomes, Gift Wraps, `accept_mls_welcome`, commands |
| **[EVICTION_AND_LEAVE.md](./EVICTION_AND_LEAVE.md)** | Kick, leave, eviction cleanup, pending proposals |
| **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** | Missing member KeyPackages, `create_group_chat` skip behavior, logs |

## Canonical code

| Concern | Location |
|---------|----------|
| MLS service, welcomes, sends, engine wrapper | `src-tauri/src/mls.rs` |
| Live Kind 444 handling, `spawn_blocking`, comments on subscription flow | `src-tauri/src/lib.rs` |
| `mls_groups`, `mls_keypackages`, `mls_event_cursors` CRUD | `src-tauri/src/db.rs` (search `mls_`) |
| Chat type + MLS chat ids | `src-tauri/src/chat.rs` |
| Message send branch into MLS | `src-tauri/src/message.rs` |

## On-disk storage

- **Engine state:** `<app_data>/<npub>/mls/vector-mls.db` (see `MlsService::new_persistent` in `mls.rs`).
- **App metadata / cursors:** tables inside **`vector.db`** (same directory as profile DB). Details in **`docs/storage-layout/SQLITE_AND_FILES.md`**.

## Related docs

- **Wire + DM comparison:** [`../messaging/OVERVIEW.md`](../messaging/OVERVIEW.md)  
- **Nostr transport details:** [`../nostr/ARCHITECTURE.md`](../nostr/ARCHITECTURE.md)
