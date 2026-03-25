# Nostr — contributor map

Pacto uses **Nostr** for transport (relays), **NIP-59 gift wraps** for DMs, and **MLS-related kinds** (e.g. 443/444) for groups. Inner payloads are often **rumors** processed by a shared pipeline.

## Read next

| Doc | Contents |
|-----|----------|
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | Kinds, subscriptions, main Rust modules, frontend touchpoints |

## Canonical code (quick links)

| Concern | Location |
|---------|----------|
| Nostr client, subscriptions, `handle_event`, sync | `src-tauri/src/lib.rs` |
| DM / MLS send routing | `src-tauri/src/message.rs` |
| Unwrapped rumor handling | `src-tauri/src/rumor.rs` |
| Stored Nostr-shaped rows | `src-tauri/src/stored_event.rs`, `src-tauri/src/db.rs` (events) |
| Profile / metadata parsing | `src-tauri/src/profile.rs`, `profile_sync.rs` |
| Frontend API helpers | `src/lib/api/nostr.ts`, auth/crypto invoke wrappers |

## Related docs

- **DM vs MLS (full product flow):** [`../messaging/OVERVIEW.md`](../messaging/OVERVIEW.md)  
- **Wallet messages in DMs:** [`../wallet/DM_WALLET_MESSAGE_SCHEMA.md`](../wallet/DM_WALLET_MESSAGE_SCHEMA.md)  
- **MLS on the wire + engine:** [`../mls/ARCHITECTURE.md`](../mls/ARCHITECTURE.md), [`../mls/INVITES_AND_MEMBERSHIP.md`](../mls/INVITES_AND_MEMBERSHIP.md)
