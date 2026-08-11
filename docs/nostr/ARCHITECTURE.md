# Nostr architecture (Pacto)

High-level map of how Nostr is used in this codebase. For **DM vs MLS** commands, events, and sync, see **[`../messaging/OVERVIEW.md`](../messaging/OVERVIEW.md)**.

## Dependency line

The backend uses `nostr-sdk` **0.44.1**, `nostr-blossom` **0.44.0**, and resolves the core `nostr` crate at **0.44.7**. MDK 0.8.0 uses the same line, so Cargo no longer carries the former git-pinned 0.43 graph.

Construction and inspection of Nostr tags go through `src-tauri/src/nostr_tags.rs`; event signing and Nostr JSON conversion go through `src-tauri/src/nostr_sign.rs`. These app-local seams bound the next protocol-library API migration instead of spreading it through messaging call sites.

## Transport and kinds (summary)

| Path | Wire | Inner (after decrypt / MLS process) |
|------|------|-------------------------------------|
| **DM** | **Kind 1059** — Gift Wrap (NIP-59), addressed to the recipient | Rumors: **14** (text), **15** (files), **7** (reactions), **30078** (typing), etc. |
| **MLS invite** | **Kind 443** (`MlsWelcome`) **inside** a Gift Wrap | Handed to the MLS engine; not processed as a normal DM rumor |
| **MLS group traffic** | **Kind 444** (`MlsGroupMessage`), **`h` tag** = wire group id | Same rumor kinds as DMs once decrypted by MDK |

Conversation identity:

- **DM:** `chat_identifier` / UI `chat_id` is the other user’s **npub** (`npub1…`).
- **MLS group:** `chat_id` is the **group id** (hex string from the `h` tag); it does **not** start with `npub1`.

`ChatType` in `src-tauri/src/chat.rs` distinguishes `DirectMessage` vs `MlsGroup`.

## Backend flow

### Sending (`message.rs`)

- Entry: **`message`** (text), **`file_message`**, **`voice_message`**, etc. **`receiver`** is either an **npub** (DM) or **group id** (MLS).
- If a chat exists, **`chat.is_mls_group()`** selects the branch; otherwise **`receiver.starts_with("npub1")`** implies DM.
- **DM:** build rumor → **Gift Wrap** to peer pubkey → publish via Nostr client.
- **MLS:** build the same rumor kinds → **`crate::mls::send_mls_message`** → Kind **444** on the wire.

### Receiving (`lib.rs`)

Two live subscription paths (see also the long comment block near **`list_group_cursors`** in `lib.rs`):

1. **Gift Wrap (1059)** — unwrap; if inner is **MlsWelcome (443)** → MLS engine + `mls_invite_received`; else **DM rumor** → `process_rumor` with `ConversationType::DirectMessage`, storage keyed by **npub**, emit **`message_new`**.
2. **MlsGroupMessage (444)** — read `h` tag; verify membership via **`db::load_mls_groups`**; process with MLS engine on a **blocking thread**; **`process_rumor`** with `ConversationType::MlsGroup`; emit **`mls_message_new`**.

### Sync

- **DM:** fetch gift wraps for self, **`handle_event`** (unwrap + paths above).
- **MLS:** after DM sync / init, **`sync_mls_groups_now`** and per-group cursor sync (`mls.sync_group_since_cursor` pattern) for Kind **444** history.

### State

- In-memory chat state: **`STATE`** (`ChatState` in `lib.rs`) — DMs keyed by npub, MLS groups by `group_id`.
- Durable history: SQLite **`events`** table (and related chat/profile rows); see **`docs/storage-layout/`**.

## Relays and trust

Debug builds resolve the trusted relay set at runtime (production default, or a
`PACTO_TRUSTED_RELAYS` override) through **`trusted_relays::trusted_relays()`**
in `src-tauri/src/trusted_relays.rs`; nothing outside that module can see the
raw list. When changing relay behavior, grep for `trusted_relays::`, `add_relay`,
and subscription filters. The local dev stack's relay is `wss://localhost:7001`
(Caddy TLS). Reaching it takes two things, and a missing either looks the same:
the local CA installed in the OS trust store (`mkcert -install`, or
`caddy trust` when Caddy's internal CA is in use), **and** a build carrying the
`local-relay-tls` feature. Without the feature the relay websocket validates
only against the Mozilla roots compiled into the binary and never reads the OS
trust store, so the connection fails with `UnknownIssuer` even when `openssl`
and `curl` accept the same endpoint. The `make dev*` targets pass the feature;
release builds never do, since it would widen relay trust to every CA the host
trusts.

## Frontend

- Listens for Tauri events such as **`message_new`**, **`mls_message_new`**, **`mls_invite_received`**, init/sync completion payloads.
- Uses **`invoke`** for commands registered in `lib.rs` (fetch messages, send, profile operations, MLS commands).

## Files not to confuse

- **`src/lib/api/nostr.ts`** — thin API surface from the web layer to Tauri, not the Rust Nostr implementation.
- **`stored_event.rs`** — helpers for kind/content/tags shape used when persisting or displaying protocol-aligned data.
