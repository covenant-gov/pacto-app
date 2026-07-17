# Local message encryption (SQLite)

> **Superseded by** [`../security/CRYPTOGRAPHY.md`](../security/CRYPTOGRAPHY.md), which covers the PIN-derived key, per-device salt, v1→v2 migration, and how MLS encryption relates to at-rest storage.

This page is kept as a short DM-focused reference.

---

## DM-related rows in `events`

For kinds `PRIVATE_DIRECT_MESSAGE` (14) and `MESSAGE_EDIT` (16), `db.rs::save_event` encrypts `content` with:

```rust
crypto::internal_encrypt(event.content.clone()).await
```

and decrypts on read with:

```rust
crypto::internal_decrypt(event.content).await
```

`internal_encrypt` / `internal_decrypt` use the in-memory session key set by `set_encryption_key` during login/account creation. The key is derived from the PIN with Argon2id and a per-device salt (v2 accounts) or the legacy hard-coded salt (v1 accounts, migrated on unlock).

## What happens when the key is wrong

If `ENCRYPTION_KEY` is missing or stale (e.g., after a hot logout/login without re-entering the PIN, or a wrong PIN), DM-like rows render as `[Decryption failed]`. See the full cryptography doc for the key lifecycle and migration details.

## Code index

| Topic | Location |
|---|---|
| Encryption primitives | `src-tauri/src/crypto.rs` |
| Salt / migration / PIN decrypt | `src-tauri/src/migration.rs` |
| Session key cache | `src-tauri/src/lib.rs` — `ENCRYPTION_KEY`, `set_encryption_key`, `clear_encryption_key` |
| Event persistence | `src-tauri/src/db.rs` — `save_event`, `get_events_for_chat` |
