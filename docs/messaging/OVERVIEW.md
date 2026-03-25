# Messaging overview — DM vs MLS groups

Pacto uses one **unified chat model** (`Chat` / `ChatType` in `src-tauri/src/chat.rs`). What differs is **how events arrive on the wire** and **what string identifies the conversation**.

---

## 1. NIPs and kinds (summary)

| Layer | DMs (private) | MLS groups |
|-------|----------------|------------|
| **Wire transport** | **NIP-59** — Kind **1059** (`GiftWrap`), encrypted to recipient pubkey | Kind **444** (`MlsGroupMessage`); group = **`h` tag** (wire group id, hex) |
| **Inner payload** | NIP-17-style **rumors**: Kind **14** (text), **15** (files), **7** (reactions), **30078** (typing), … | Same rumor kinds after MLS decryption |
| **Invites** | Kind **443** (`MlsWelcome`) **inside** a Gift Wrap (1059) | Same — welcome is not a normal DM rumor path |

**Conversation id**

- **DM:** the other user’s **npub** (`npub1…`).
- **MLS:** **group_id** (hex from `h` tag); does **not** start with `npub1`.

**Rule of thumb:** `receiver` / `chatId` for sends and listeners is **npub** for DM and **group_id** for MLS.

---

## 2. Backend differentiation

### Chat identity

- **`ChatType::DirectMessage`** — chat `id` = other user’s npub.
- **`ChatType::MlsGroup`** — chat `id` = `group_id` (hex).

Helpers: `Chat::is_mls_group()`, `Chat::new_dm`, `Chat::new_mls_group`.

### Sending (`src-tauri/src/message.rs`)

Entry points include **`message`** (text), **`file_message`**, **`voice_message`**, etc. The **`receiver`** argument is either an **npub** or a **group_id**.

1. If a chat already exists for `receiver`, use **`chat.is_mls_group()`**.
2. Else **`receiver.starts_with("npub1")` → DM**, otherwise treat as MLS group.

- **DM:** `state.add_message_to_participant(&receiver, msg)` → rumor → **Gift Wrap** → publish.
- **MLS:** `state.create_or_get_mls_group_chat` + `add_message_to_chat` → **`crate::mls::send_mls_message`** → Kind **444**.

### Receiving (`src-tauri/src/lib.rs`)

1. **Gift Wrap (1059)** — unwrap; if inner **MlsWelcome (443)** → MLS engine (e.g. `process_welcome`), emit **`mls_invite_received`**; else **DM rumor** → **`process_rumor`** with `ConversationType::DirectMessage` → **`message_new`** (`chat_id` = npub).

2. **MlsGroupMessage (444)** — read **`h`** → membership via **`db::load_mls_groups`** → MDK **`process_message`** on a **blocking thread** → **`process_rumor`** with `MlsGroup` → **`mls_message_new`** (`group_id`).

### Sync

- **DM:** `fetch_messages` loads Gift Wraps; **`handle_event`** fills state + DB.
- **MLS:** after DM sync / init, **`sync_mls_groups_now`** (per-group cursors, Kind 444 history).

### In-memory state

**`STATE`** (`ChatState` in `lib.rs`): DMs keyed by npub; MLS by `group_id`. Durable rows in SQLite — see **`docs/storage-layout/`**.

---

## 3. App flows (concise)

### DM

1. Open chat: use **npub** as id; load via `get_message_views` / event cache with **`chatId: npub`**.
2. Send: **`invoke('message', { receiver: npub, content, repliedTo })`** (plus file/voice commands as needed).
3. Receive: listen **`message_new`** — `payload.chat_id` is npub.

### MLS group

1. List/open: **`list_mls_groups`**, chats from **`init_finished`** with `chat_type` MLS; **`list_pending_mls_welcomes`** for invites.
2. Accept: **`accept_mls_welcome`** with **inner welcome id** from `SimpleWelcome.id` (not `wrapper_event_id`).
3. Send: **`invoke('message', { receiver: group_id, … })`**.
4. Receive: **`mls_message_new`** — `payload.group_id` matches chat id.

---

## 4. Events and commands (quick reference)

| Purpose | Event / command |
|--------|------------------|
| DM new message | **`message_new`** — `{ message, chat_id }` (`chat_id` = npub) |
| Group new message | **`mls_message_new`** — `{ group_id, message }` |
| Send text | **`message`** — `receiver` = npub or `group_id` |
| Init payload | **`init_finished`** — `{ profiles, chats }` |
| Background sync | **`fetch_messages`** — Gift Wraps; triggers MLS sync when appropriate |
| MLS invite | **`mls_invite_received`** — refresh **`list_pending_mls_welcomes`** |
| Typing | **`typing-update`** — `conversation_id` is npub or `group_id` |
| Reaction | **`react_to_message`** — `chatId` = npub or `group_id` |

Exact payload shapes: grep `emit(` / command names in `lib.rs` and `message.rs`.

---

## 5. Summary table

| | DM | MLS group |
|--|----|------------|
| **Kind on wire** | 1059 (Gift Wrap) | 444; 443 inside 1059 for welcomes |
| **Conversation / chat id** | npub | group_id (hex) |
| **Emit** | `message_new` | `mls_message_new` |
| **`chat_type`** | `DirectMessage` | `MlsGroup` |

---

## 6. Pulling from relays (DM)

Historical sync uses filters such as **`pubkey(self).kind(GiftWrap).since…`**; each event goes through **`handle_event`** → unwrap → DM or welcome branch. Dedup uses DB + **`wrapper_event_id`** where applicable. Details in `lib.rs` and `db.rs` (`save_event`, message existence checks).

---

*Consolidated from internal design notes; aligned with Pacto command names (`message`, not legacy `send_message`).*
