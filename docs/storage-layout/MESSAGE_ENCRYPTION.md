# Local message encryption (SQLite)

DM-related rows in **`events`** (and similar) store **content encrypted with the user’s PIN-derived key**, not raw NIP-44 ciphertext from the relay. This page explains the model so you can debug **`[Decryption failed]`** and logout/re-login edge cases.

---

## 1. Write path

In **`db.rs`** (`save_event` and related), for kinds such as private direct messages and edits, content is passed through:

```rust
internal_encrypt(event.content.clone(), None).await
```

**`internal_encrypt`** (`crypto.rs`) uses a global **`ENCRYPTION_KEY`** (32 bytes) derived from the PIN (Argon2). With `password: None`, it encrypts using the **cached** key.

---

## 2. Read path

When loading events for the UI, DM-like rows are decrypted with:

```rust
internal_decrypt(event.content, None).await
```

On failure, callers typically substitute the literal **`[Decryption failed]`** so the UI still renders a row.

If **`ENCRYPTION_KEY`** is missing or wrong (e.g. user entered a different PIN, or key not re-set after a hot logout/login in the same process), decryption fails for **all** rows encrypted with the previous key.

---

## 3. Interaction with logout (same process)

**`ENCRYPTION_KEY`** is stored in a **`OnceCell`** (see `lib.rs` / `crypto.rs`). Setting it **twice** in one process lifetime can fail or leave stale behavior.

After **logout**, the profile directory (and thus encrypted payloads tied to that account) may be **gone**, but if the process stays alive and the user logs in again, ensure product flows **re-derive** or **reset** encryption state consistently with PIN entry. If you change logout/login behavior, re-test:

1. Logout → login same npub + same PIN  
2. Logout → login different npub  
3. **`[Decryption failed]`** should only appear for genuinely corrupt rows or wrong PIN — not for a fresh account after a full wipe.

---

## 4. Code index

| Topic | Location |
|-------|----------|
| Encrypt/decrypt | `src-tauri/src/crypto.rs` — `internal_encrypt`, `internal_decrypt` |
| Key cache | `ENCRYPTION_KEY` in `src-tauri/src/lib.rs` |
| Event persistence | `src-tauri/src/db.rs` — `save_event`, `get_events_for_chat`, … |

---

*Summarizes behavior described in former internal “legacy decryption” notes; verify against current `crypto.rs` if APIs change.*
