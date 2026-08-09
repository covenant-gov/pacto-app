# Squad sticker packs

A squad sticker pack is a named, ordered set of images owned by a Squad — a
Telegram-style pack that any squad member can curate and every squad member
receives automatically. Sending a sticker is not a new feature at the wire
level: it reuses the encrypted attachment pipeline unchanged and adds only the
pack metadata layer on top.

**Related:** [`ATTACHMENTS.md`](./ATTACHMENTS.md) (the encryption and upload
pipeline packs reuse), [`OVERVIEW.md`](./OVERVIEW.md),
[`../communities/DESIGN.md`](../communities/DESIGN.md) (squads and MLS group
model).

---

## 1. What a pack is

A pack is one row: a squad id, a pack id, a name, and an ordered list of
entries. Each entry is a shortcode paired with an encrypted image:

```
sticker_packs(squad_id, pack_id, name, entries, updated_at, updated_by, deleted)
```

`entries` is a JSON array of `{ shortcode, url, key, nonce, mime, size }` —
one Blossom blob reference per sticker, with its own AES-256-GCM key and
nonce. `deleted` is a tombstone, not a row delete, so a stale announce can
never resurrect a removed pack. Primary key is `(squad_id, pack_id)`, so every
member's local copy converges independently from the same announce stream.

A member with no squad packs sees an empty state in the composer's Stickers
tab explaining that any squad member can create one from squad settings.

---

## 2. Distribution: an MLS announce, not a new protocol

Pack state propagates as a typed JSON announce sent as an ordinary MLS group
message, mirroring the existing `governance_updated` pattern exactly — same
transport, same authorization model, same persistence shape:

```json
{ "pacto_virtual_bucket": "announcements",
  "type": "sticker_pack_updated",
  "payload": { "squad_id": "<MLS group id>", "pack_id": "<uuid>", "name": "...",
               "entries": [ { "shortcode", "url", "key", "nonce", "mime", "size" } ],
               "updated_at": 0, "deleted": false } }
```

The frontend builds this content (`src/lib/announcements.ts`,
`ANNOUNCE_TYPE_STICKER_PACK_UPDATED`) and sends it like any other message; the
`sticker_pack_updated` type routes it to the squad's `announcements` virtual
bucket (`src-tauri/src/virtual_channel_bucket.rs`), the same bucket
`governance_updated` and squad EVM-share announces use. Rust only classifies
and persists — there is no separate sticker-pack transport to reason about.

### Authorization is MLS group membership — nothing more

`maybe_upsert_sticker_pack_from_announce` (`src-tauri/src/db.rs`) applies an
incoming announce only when:

1. `payload.squad_id` matches the MLS chat the message arrived on
   (`side_effect_parent_matches_chat`) — an announce claiming a different
   squad's id is dropped.
2. The author is verified, fail-closed, as a *current* member of that MLS
   group (`is_author_mls_member_for_chat`) — membership cannot be verified is
   the same as membership fails; there is no permissive fallback.

**Any member of the squad can create the pack, add or remove entries, and
rename it.** There is no admin role, no curator permission tier, and no
on-chain capability check — curating a pack was deliberately kept out of the
Hats/Squad-Admin governance system (`docs/governance/ACCESS_CONTROL.md`)
because it is not a governance action. A departing member's local pack keeps
working; they simply stop receiving further updates once they leave the
squad's MLS group.

Because the pack travels as ordinary MLS group content, **no pack metadata —
name, shortcodes, entry count, or membership implied by holding it — ever
reaches a public relay.** It exists only inside the squad's encrypted group
state, the same defense the governance announces already rely on.

---

## 3. Conflict resolution: last-write-wins on `updated_at`

Two members can edit the same pack within the same sync window — that is the
expected case, not an edge case, since curation has no lock and no owner.
Conflicts resolve by comparing the incoming announce's `updated_at` against
the row already stored, and the write only lands if it is strictly newer:

```sql
INSERT INTO sticker_packs (...) VALUES (...)
ON CONFLICT(squad_id, pack_id) DO UPDATE SET
  name = excluded.name, entries = excluded.entries,
  updated_at = excluded.updated_at, updated_by = excluded.updated_by,
  deleted = excluded.deleted
WHERE excluded.updated_at > sticker_packs.updated_at
```

This comparison and the write happen inside one SQLite statement, so two
announces ingested concurrently cannot race each other into applying a stale
value — there is no read-then-write window for a second thread to land in
between. An announce with an older or equal `updated_at` — including a
`deleted: true` tombstone racing a newer edit — is silently a no-op, never an
error. `updated_at` itself is stamped server-side from the system clock when a
member saves locally (`save_sticker_pack`, `src-tauri/src/sticker_pack.rs`),
never trusted from the announce payload at authoring time, so a client cannot
backdate its own edit to win a future race.

---

## 4. Pack images: the same encrypted-blob pipeline as any attachment

Sticker images are not a new storage mechanism. Uploading one composes the
exact same primitives [`ATTACHMENTS.md`](./ATTACHMENTS.md) documents for
ordinary file attachments, in the same order:

```
util::sniff_extension_and_mime → crypto::generate_encryption_params
  → crypto::encrypt_data → blossom::upload_blob_with_progress_and_failover
```

Each image gets its own fresh AES-256-GCM key and nonce. The ciphertext
uploads to a Blossom blob server as opaque `application/octet-stream`, sniffed
from the plaintext bytes rather than trusted from the caller's declared file
name — indistinguishable, from the host's point of view, from any other
attachment blob. The key and nonce never touch the upload; they travel only
inside the MLS announce's `entries` array, which only current squad members
can decrypt.

Fetching a sticker for rendering is the mirror: `net::download` the blob, then
`crypto::decrypt_data` with the entry's key and nonce, cached on disk keyed by
a hash of the source URL so repeated picker renders never re-download.

**Consequence, stated plainly (see [§7](#7-privacy)):** because the encryption
key rides inside an MLS-encrypted announce rather than a public NIP-30 list
event, a sticker pack is unreadable by any Nostr client other than Pacto —
there is no cross-client interop, even though the underlying image blob sits
on a public Blossom host. That trade was made deliberately: consistency with
every other encrypted blob Pacto stores outweighed interop with a NIP-30
ecosystem that, in practice, no client renders animated packs against anyway.

---

## 5. Sending a sticker is an ordinary attachment send

Tapping a sticker in the composer fetches and decrypts it, then calls the
same `onSendFile(bytes, fileName, repliedTo, useCompression)` callback the
paperclip and drag-and-drop attachment paths already use
(`src/components/dm/MessageInput.svelte`), with `useCompression` forced
`false` so re-encoding never destroys animation. From that call onward it is
indistinguishable from any other image attachment: same kind-15 rumor, same
encrypt-upload-publish path, same receive-side decrypt and render in
`MessageAttachment.svelte`. **There is no new message kind and no new receive
path.** A sticker sent to a DM peer outside the squad renders normally for
them — squad membership gates the *pack*, not the *message*.

---

## 6. Authoring surface

A squad member curates a pack from a **Stickers** tab in the squad dashboard
(`src/components/parent/dashboard/DashboardStickersTab.svelte`, registered in
`ParentDashboard.svelte`): add an image, assign it a shortcode, remove an
entry, rename the pack, save. Saving is two steps and both must happen for
other members to see the result: `saveStickerPack(...)` persists locally and
stamps `updated_at`, then the caller sends the `sticker_pack_updated` announce
carrying that same `updated_at` to the squad's announcements group. A save
that skips the announce produces a pack only the author's own client can see.

The composer surfaces every pack from every squad the account belongs to in
one flat, filterable **Stickers** tab (`src/components/dm/MessageInput.svelte`),
grouped by pack and searchable by shortcode or pack name, usable in any
conversation — DM or squad channel — since membership in the squad is what
grants the pack, not the conversation it is used in.

### Tauri commands

| Command | Signature | Purpose |
|---|---|---|
| `list_sticker_packs` | `() -> Vec<StickerPackDto>` | Every non-deleted pack across every squad the account belongs to |
| `save_sticker_pack` | `(squadId, packId, name, entries, deleted) -> StickerPackDto` | Persist locally and stamp `updated_at`; the caller then sends the announce |
| `upload_sticker_image` | `(bytes, fileName) -> StickerImageUploadDto` | Sniff, encrypt, upload; returns `{ url, key, nonce, mime, size }` |
| `fetch_sticker_image` | `(url, key, nonce) -> String` | Download and decrypt to a cached local file path for rendering |

All four live in `src-tauri/src/sticker_pack.rs`. An accepted announce ingest
and any local save both emit `sticker_packs_updated` (`{ packs:
StickerPackDto[] }`), which `src/lib/app/tauri-subscriptions.ts` applies to
the `stickerPacks` store (`src/stores/stickers.ts`) — replacing its contents
wholesale, never appending — so every open composer and dashboard tab updates
live. The store is cleared on logout alongside other npub-scoped state
(`src/lib/utils/clear-account-state.ts`).

---

## 7. Privacy

What leaves the device when a pack is curated or fetched:

| Exposed | Not exposed |
|---|---|
| Ciphertext bytes of each sticker image, uploaded to the same Blossom blob server ordinary attachments use | Pack name, shortcodes, entry count, or any pack metadata — none of it is published, all of it stays inside the MLS-encrypted announce |
| SHA-256 of each blob (its address) and upload timing, to the Blossom host — identical exposure to any other attachment | The decryption key and nonce — carried only inside the MLS announce, which only current squad members can decrypt |
| The uploader's npub, via BUD-01 auth on the image upload — see [`ATTACHMENTS.md` §4](./ATTACHMENTS.md#4-what-the-host-learns) for the full disclosure | Which squad a given blob belongs to, or who else is a member — the Blossom host sees an anonymous ciphertext blob, nothing more |

**Non-Pacto-client-unreadable, stated explicitly:** because the pack's
decryption keys travel inside an MLS-encrypted announce instead of a public
NIP-30 list event, **no Nostr client other than Pacto can render a squad's
sticker pack**, even though the encrypted image bytes are sitting on a
publicly reachable Blossom host. This was a deliberate trade (see [§4](#4-pack-images-the-same-encrypted-blob-pipeline-as-any-attachment)):
consistency with Pacto's existing attachment threat model was chosen over
cross-client interop that, in practice, nothing in the current Nostr client
ecosystem exercises for animated packs.

---

## 8. Status

**Phase 1 — squad sticker packs — is shipped**, covering pack storage and
MLS announce ingest, the encrypted image pipeline, the composer's Stickers
tab, and the squad dashboard authoring surface.

**Phase 2 — a Klipy-backed GIFs tab — has not shipped.** The composer's GIFs
tab still shows its placeholder. Klipy's terms forbid downloading and
re-hosting their media on Blossom, which is why issue #200's original
"download and re-upload" design was replaced with a provider-URL delivery
design for that phase; that work is additionally blocked on Klipy API-key
distribution and Klipy granting production API access.

---

## 9. Verification

- `pnpm check`: 2307 files, 0 errors, 0 warnings.
- `pnpm lint`: clean. `pnpm check:tauri-commands`: no orphaned commands.
- `pnpm test`: 205 files, 1869 tests passed.
- `cargo test --lib`: 619 passed, 0 failed — including the sticker
  announce-ingest tests (member/non-member author, squad-id mismatch,
  last-write-wins ordering, tombstone survives a stale resurrect attempt,
  malformed payloads no-op) and the migration backstop that enforces the
  timestamped migration filename.
- MCP walkthrough against `make dev-sandbox`: created an account, completed
  the seed-backup gate, opened a DM thread, and opened the composer's media
  panel. Confirmed all three tabs render (`Emoji`, `GIFs`, `Stickers`); the
  Stickers tab shows the placeholder `"Search stickers…"` and the empty state
  `"No sticker packs yet / Any squad member can create a sticker pack from
  squad settings."`; the GIFs tab placeholder now resolves through i18n
  rather than the previously hardcoded English string.
- **Not exercised:** the squad-scoped pack round-trip across two accounts
  (create a pack on one account, confirm it appears on a second squad
  member's client). Squad creation requires a second member, which a
  single-account sandbox session cannot provide. This is a gap in the manual
  walkthrough evidence, not in the implementation — the announce-ingest test
  suite covers the membership and last-write-wins logic this scenario would
  exercise, but no human or MCP session has watched a real cross-device sync
  happen.

*Verified against `src-tauri/src/{db.rs,sticker_pack.rs,virtual_channel_bucket.rs,migrations/V20260809062933__sticker_packs.sql}`, `src/lib/api/stickers.ts`, `src/stores/stickers.ts`, `src/lib/app/tauri-subscriptions.ts`, `src/lib/utils/clear-account-state.ts`, `src/lib/announcements.ts`, `src/components/dm/MessageInput.svelte`, `src/components/parent/dashboard/DashboardStickersTab.svelte`, `src/components/parent/ParentDashboard.svelte`, and `docs/plans/2026-08-08-001-feat-sticker-gif-picker-plan.md`.*
