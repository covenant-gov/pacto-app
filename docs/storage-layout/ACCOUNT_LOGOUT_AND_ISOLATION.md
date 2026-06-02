# Account storage, logout, and isolation

How Pacto stores data **per Nostr identity (`npub`)**, what **logout** removes, and how to avoid **cross-account UI leakage** (backend vs frontend).

---

## 1. Where data lives

### Per-account (keyed by npub)

| Location | Contents | Removed on logout? |
|----------|----------|-------------------|
| **`AppData/<npub>/`** (see `account_manager::get_profile_directory`) | **`vector.db`**, **`mls/`** (engine DB), encrypted keys in `settings`, chats, events, profiles | **Yes** — only the **current** account’s directory |
| **Downloads / Documents** | `Download/vector/` (desktop) or `Document/vector/` (iOS) — attachments | **Yes** (whole folder) |

### Global (not npub-scoped)

| Location | Removed on logout? |
|----------|-------------------|
| **`app_data_dir()/cache/`** | **No** — optional **Clear storage** clears this |
| **Legacy `AppData/mls/`** | **Yes** (compatibility cleanup) |

### In-memory

**`NOSTR_CLIENT`**, **`STATE`**, **`CURRENT_ACCOUNT`**, DB pool, wrapper/chat id caches — cleared or replaced when appropriate; **logout** clears the Nostr client and current account (see `logout` in `lib.rs`). **PIN-derived `ENCRYPTION_KEY`** behavior is described in **[MESSAGE_ENCRYPTION.md](./MESSAGE_ENCRYPTION.md)**.

---

## 2. Logout (backend) — current behavior

**Command:** `logout` in `src-tauri/src/lib.rs`.

Order (simplified):

1. Lock **`STATE`** so no concurrent writes race deletion.
2. **`close_db_connection()`** — required so files can be deleted (especially Windows).
3. **`get_current_account()`** → delete that npub’s **profile directory** (`remove_dir_all`).
4. Delete **downloads** `vector` folder and **legacy** `mls` under app data.
5. **`clear_nostr_client()`** and **`clear_current_account()`**.

**Not deleted:** other npubs’ profile directories (multi-account), global **cache** dir.

**Note:** Logout does **not** restart the process; the frontend should transition to logged-out UI and may call **login** / **create_account** again. That interacts with **`ENCRYPTION_KEY`** — see **MESSAGE_ENCRYPTION.md**.

---

## 3. Login and create account (summary)

- **`login(import_key)`** — builds client, sets or opens **`AppData/<npub>/`**, loads DB. Cannot replace an in-memory key with a different npub without going through logout flows (see errors in `login` when client already exists with another key).
- **`create_account`** — new mnemonic/keys, **`PENDING_ACCOUNT`** until PIN encrypts and persists **`pkey`**.

---

## 4. Switch account

**`switch_account(handle, npub)`** — points the app at another existing npub’s DB; **does not** delete data. See `account_manager.rs`.

---

## 5. Clear storage (separate from logout)

**`clear_storage`** — clears attachment files / metadata and **cache**, profile cached image paths; **does not** delete `vector.db`, keys, or MLS engine DB.

---

## 6. Frontend isolation (checklist)

Squads, networks, last-opened chat ids, and similar state must be **scoped to npub** or **cleared on logout / new account**. If any of this lives in **unscoped `localStorage`**, a new identity can still “see” the previous account’s navigation or squad list until cleared.

When adding persistence:

- Prefer keys like **`pacto_*_<npub>`** (see **[`docs/communities/DESIGN.md`](../communities/DESIGN.md)** — squads + in-app networks persistence pattern).
- On logout, call shared **`clearAccountState`** (or equivalent) **before** or **with** `invoke('logout')`.

---

## 7. Code index

| Topic | File |
|-------|------|
| Paths, schema init | `src-tauri/src/account_manager.rs` |
| Logout | `src-tauri/src/lib.rs` — `logout` |
| Clear storage | `src-tauri/src/lib.rs` — `clear_storage` |
| Frontend clear | `src/lib/utils/clear-account-state.ts` (resets domain stores + invite accept state), `src/stores/auth.ts` |
| Account load | `src/stores/persistence.ts` — `loadAccountState` |

---

*Consolidated from internal storage/logout plans; backend steps reflect current `logout` (no process restart).*
