---
title: Sticker Packs and GIF Picker in the Composer - Plan
type: feat
date: 2026-08-08
topic: sticker-gif-picker
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
origin: https://github.com/covenant-gov/pacto-app/issues/200
---

# Sticker Packs and GIF Picker in the Composer - Plan

## Goal Capsule

- **Objective:** Fill the composer's already-built media panel with two working tabs. **Stickers** — squad-owned packs of animated images, stored on Blossom under Pacto's existing encryption and distributed over MLS — ships first and standalone. **GIFs** — Klipy search behind an opt-in privacy gate — follows as a separate phase.
- **Product authority:** This Product Contract governs product behavior. Implementation mechanism is deferred to the Planning Contract that `ce-plan` will add.
- **Open blockers:** None for Phase 1. Phase 2's two blockers are resolved: OQ1 (Klipy key distribution) settled on compile-time `option_env!` plus a runtime `std::env` override; OQ2 (Klipy production access) is running on a testing-tier key at 100 req/hour with production access requested but not yet granted.

---

## Product Contract

### Summary

The composer at `src/components/dm/MessageInput.svelte` already renders a two-tab media panel (`Emoji` / `GIFs`) whose GIFs tab is a `gifsComingSoon` placeholder. This work turns that shell into a three-tab panel and fills it.

**Phase 1 — Stickers.** A squad sticker pack is a named set of images owned by a Squad. Any member may curate it. Pack state travels as a typed MLS announce mirroring the existing `governance_updated` pattern, so authorization is MLS group membership and no pack metadata ever reaches a public relay. Pack images are encrypted and stored on Blossom through the same pipeline as file attachments. Tapping a sticker sends it immediately as an ordinary encrypted image attachment — which means zero new wire format and zero new receive-side code.

**Phase 2 — GIFs.** Klipy-backed search and trending, proxied through Rust so the API key never enters the webview, gated behind an explicit opt-in disclosure, and delivered as a provider URL because Klipy's terms forbid re-hosting.

### Problem Frame

Issue #200 asks for a Telegram-style GIF picker and recommends **Option B**: download the GIF, encrypt it, upload to Blossom, send as a kind-15 attachment — preserving Pacto's opaque-ciphertext threat model.

Research invalidated that recommendation. Klipy's integration requirements state:

> "Media must be loaded directly from the URLs included in the API response. Do not store, mirror, re-host, rewrite, or retain copies of KLIPY media unless KLIPY has approved a different delivery method in writing." — [docs.klipy.com/integration-requirements](https://docs.klipy.com/integration-requirements.md)

Option B is precisely what that forbids. Klipy additionally mandates a `"Search KLIPY"` search placeholder, a `POST /gifs/share/{slug}` share-trigger callback, and byte-exact URL preservation. So the GIF path cannot be both ToS-compliant and consistent with Pacto's existing privacy model — it must give up one.

Investigating a decentralized substitute confirmed none exists. NIP-30 plus NIP-51 kind 30030 standardize **custom emoji sets**, not GIF catalogs. Blossom is content-addressed storage with no discovery layer — BUD-12's `/list/<pubkey>` covers a single pubkey's own uploads and the spec marks it "unrecommended". No searchable GIF index exists on IPFS or Arweave at usable scale. Among real Nostr clients, Damus, Primal, Amethyst, Coracle, 0xchat and nostrudel ship custom emoji only; the one documented Nostr GIF integration, Gif Buddy, calls Tenor. (Tenor shuts down 2026-06-30, which is why Klipy is the right centralized pick if a centralized pick is made.)

That reframes the work. A global meme catalog is a poor fit for a squad-based organizing tool anyway; Telegram's actual cultural unit is the sticker pack, not GIF search. Pacto already owns every primitive a pack needs — Blossom upload with failover (`src-tauri/src/blossom.rs`), attachment download (`src-tauri/src/lib.rs` `download_attachment`), the encrypt-and-send pipeline (`src-tauri/src/message.rs` `send_file_bytes`), media-tile rendering (`src/components/dm/MessageAttachment.svelte`), and typed MLS announces with membership-based authorization (`src-tauri/src/db.rs` `maybe_upsert_governance_from_announce`). Stickers therefore introduce **no new trust boundary, no API key, no ToS obligation, and no privacy regression**, and can ship before any decision about Klipy is settled.

### Key Decisions

- **KD1 — Ship both tabs; Stickers first, then Klipy GIFs.** *(session-settled: user-directed — chosen over GIFs-only and Stickers-only: the panel's tab strip was built for three tabs, and Stickers has no external blockers so it need not wait on Klipy key approval.)* Governs R1, R24.
- **KD2 — Klipy is the GIF provider.** *(session-settled: user-directed — chosen over Tenor and Giphy: Tenor shuts down 2026-06-30; Giphy gates production keys behind app review.)* Governs R13.
- **KD3 — A sticker pack is owned by a Squad, not an individual.** *(session-settled: user-approved — chosen over personal packs and both-at-once: squad ownership matches Pacto's organizing model and answers the cold-start problem, since every squad has an immediate reason to build one.)* Governs R2, R9.
- **KD4 — Any squad member may update the pack; conflicts resolve last-write-wins; authorization is MLS group membership.** *(session-settled: user-directed — chosen over creator-pinned and creator-can-lock: exactly mirrors the existing `governance_updated` announce, so it adds no new permission code, and a departing member never orphans the pack.)* Governs R3, R4.
- **KD5 — Pack images are encrypted through the existing attachment pipeline; the key rides in the MLS announce.** *(session-settled: user-directed — chosen over plain unlisted blobs: consistency with every other blob Pacto stores outweighs cross-client NIP-30 interop, which is theoretical since no client renders animated packs.)* Governs R5. Consequence: packs are not readable by non-Pacto Nostr clients.
- **KD6 — On-chain governance does not gate pack curation.** `require_capability` means Captain/Crew Hats plus a linked squad EVM address (`src-tauri/src/evm/access_control/capability.rs`); that is governance machinery, not a sticker permission. Governs R3.
- **KD7 — A sticker send reuses the file-attachment path unchanged.** A sticker is an image attachment, so there is no new message kind, no new render path, and no new decrypt path. Governs R6, R7.
- **KD8 — Klipy GIFs are delivered as a provider URL, not re-hosted.** Issue #200's Option B is a written ToS violation. The rumor carrying the URL is still encrypted by NIP-17/MLS, so the URL is not public; the residual exposure is that the recipient's client reveals its IP to Klipy at render time. Governs R16, R21.
- **KD9 — Klipy access is opt-in behind a one-time disclosure; Tor routing is deferred.** *(session-settled: user-directed — chosen over on-by-default: a privacy-first product should not silently route user activity to a third party. Proxy routing was requested but depends on issue #173, which has not landed.)* Governs R15, R19.
- **KD10 — All Klipy egress passes through a single Rust module.** Both the search proxy and the media fetch. This is what lets #173 gate Klipy traffic in one place instead of hunting call sites, and it keeps the API key out of the webview. Governs R14, R19.

### Actors

- **A1 — Squad member.** Sends stickers and GIFs in squad channels and DMs.
- **A2 — Pack curator.** Any squad member editing that squad's pack. Not a distinct role or permission.
- **A3 — Recipient.** A DM peer or fellow squad member receiving the message.

### Requirements

**Phase 1 — Stickers**

- **R1** — The composer media panel presents three tabs: `Emoji`, `Stickers`, `GIFs`.
- **R2** — A squad sticker pack is a named, ordered set of images scoped to one Squad. Each entry carries a shortcode and an image.
- **R3** — Any member of the squad may create the pack, add entries, remove entries, and rename it. Authorization is MLS group membership; no on-chain capability is consulted.
- **R4** — Pack state propagates as a typed JSON announce over MLS, mirroring `governance_updated`: routed to the squad's announcements bucket, applied only when the author is an MLS group member, persisted locally. Concurrent edits resolve last-write-wins by announce timestamp.
- **R5** — Pack images are encrypted with the same scheme as file attachments and stored on Blossom. The decryption key is carried in the MLS announce, so only group members can render the pack.
- **R6** — Tapping a sticker sends it as a message immediately. It does not insert a token into the composer text field.
- **R7** — A received sticker renders as an ordinary media tile, indistinguishable in mechanism from any other image attachment.
- **R8** — A2 has an authoring surface to create a pack, add images, assign shortcodes, remove entries, and preview the result.
- **R9** — The Stickers tab shows the union of packs from every squad A1 belongs to, usable in any conversation including DMs. Membership in the squad is what grants the pack, not the conversation being in it.
- **R10** — The Stickers tab supports filtering entries by shortcode or pack name.
- **R11** — When A1 belongs to no squad with a pack, the tab shows an empty state that explains how to make one.
- **R12** — Sticker sends honor the composer's `disabled` and `isSendingAttachment` states exactly as the attachment and emoji controls do.

**Phase 2 — Klipy GIFs**

- **R13** — The GIFs tab searches Klipy, and shows trending results when the search box is empty.
- **R14** — The Klipy API key is never present in the webview bundle, in `VITE_*`/`ALCHEMY_*`, or in any frontend-reachable value. All provider calls originate in Rust.
- **R15** — Before the first Klipy request for an account, A1 sees a disclosure naming Klipy and stating what leaves the device. The tab stays inert until accepted. The decision is persisted npub-scoped.
- **R16** — A picked GIF is delivered as the provider URL exactly as Klipy returned it. Pacto does not download, cache, mirror, or re-upload Klipy media.
- **R17** — The GIF search input uses `"Search KLIPY"` as its placeholder, per Klipy's mandatory attribution requirement.
- **R18** — Sharing a GIF fires Klipy's share-trigger callback.
- **R19** — Every outbound Klipy request — search, trending, share-trigger, and media fetch — passes through one Rust module, so issue #173 can route it through Tor by changing one place.
- **R20** — No Klipy request carries an identifier derived from the user's npub or any Pacto identity.
- **R21** — Documentation discloses the Klipy network call and its metadata exposure, consistent with the existing Blossom disclosure in `docs/messaging/ATTACHMENTS.md`.
- **R22** — Search is debounced, results paginate, and a no-results state exists.

**Cross-cutting**

- **R23** — All new user-facing text is translated in `en` and `es` under `messaging.messageInput.*`. This includes replacing the two hardcoded English strings already present at `src/components/dm/MessageInput.svelte` lines 816 and 820.
- **R24** — Phase 1 ships and is useful with the GIFs tab still showing its placeholder. Phase 2 adds no dependency to Phase 1.

### Key Flows

- **F1 — Curate a squad pack.** A2 opens the squad's pack authoring surface, adds images, assigns shortcodes, saves. Images encrypt and upload to Blossom; an announce goes out over MLS; every member's client applies it and the pack appears in their Stickers tab.
- **F2 — Send a sticker.** A1 opens the composer media panel, selects Stickers, optionally filters, taps an entry. The message sends immediately through the existing attachment path.
- **F3 — Receive a sticker.** A3's client processes an ordinary encrypted image attachment and renders a media tile. No sticker-specific code runs.
- **F4 — Send a GIF (Phase 2).** A1 selects the GIFs tab, accepts the disclosure on first use, types a query, taps a result. Pacto fires the share-trigger and sends a message carrying the Klipy URL. A3's client fetches the media through the Rust egress module.

### Acceptance Examples

- **AE1** — A2 in squad `t14` creates a pack with three animated images. A different member of `t14`, on another device, sees all three in their Stickers tab without taking any action.
- **AE2** — Two members edit the pack within the same minute from different devices. Both converge on the later announce; neither client is left with a partially-applied pack.
- **AE3** — A1 sends a sticker in a DM to a peer who is not in the squad. The peer receives and renders it normally — the sticker travels as an attachment, so squad membership gates the *pack*, not the *message*.
- **AE4** — A non-member fetches a pack blob directly from the Blossom server by hash and gets ciphertext they cannot decrypt.
- **AE5** — A member removed from the squad no longer receives pack updates; already-received stickers remain usable locally.
- **AE6** — A1 belongs to two squads, each with a pack. Both packs appear in the Stickers tab, in every conversation.
- **AE7** — With `disabled` set on the composer, the Stickers tab cannot send.
- **AE8** — Searching the app for hardcoded user-facing English in the media panel returns nothing; both `en` and `es` catalogs resolve every new key.
- **AE9 (Phase 2)** — A fresh account opens the GIFs tab and no network request reaches Klipy until the disclosure is accepted.
- **AE10 (Phase 2)** — `strings` on the built webview bundle does not contain the Klipy API key.
- **AE11 (Phase 2)** — A sent GIF's stored message carries the Klipy URL byte-for-byte as returned, with no parameters stripped or rewritten.
- **AE12 (Phase 2)** — No Klipy request contains the user's npub or any value derived from it.

### Scope Boundaries

**In scope**

- Three-tab composer media panel on both DM and squad channel surfaces.
- Squad sticker packs: authoring, MLS distribution, encrypted Blossom storage, picker, send.
- Klipy GIF search, trending, opt-in gate, URL delivery, attribution, share-trigger (Phase 2).
- `en` and `es` translation, including repair of the existing hardcoded strings.

**Deferred for later**

- Tor / SOCKS routing of Klipy traffic — depends on issue #173. R19's single-chokepoint requirement exists so this becomes a small change.
- Personal (non-squad) sticker packs.
- Cross-client NIP-30 interop for packs, foreclosed by KD5.
- Klipy Stickers, Clips, and Memes catalogs; only the GIFs catalog is in scope.
- Pack discovery beyond squad membership — no browsing, no directory, no subscribing to a stranger's pack.

**Outside this product's identity**

- Any always-on third-party media call that is not user-initiated and not disclosed.
- Sending Pacto identity, npub, or squad identifiers to a content provider.

### Outstanding Questions

- **OQ1 (decided)** — How does a shipped binary obtain the Klipy key, given Pacto has no server? Resolved as compile-time `option_env!` with a runtime `std::env` override (`klipy_api_key()`, `src-tauri/src/klipy.rs`): a debug build reads `KLIPY_API_KEY` from the root `.env` at startup, a release build falls back to the value baked in at compile time. This satisfies R14 (key stays out of the webview) while accepting, plainly, that the key is extractable from a shipped binary — see [`docs/messaging/GIF_PROVIDER.md`](../messaging/GIF_PROVIDER.md#6-operator-setup-klipy_api_key). Per-user keys and a bundled-default-plus-override were rejected: the former kills adoption, the latter only relocates the same exposure.
- **OQ2 (resolved for now)** — Klipy keys are capped at 100 requests/hour until production access is granted. A testing-tier key is in hand at that cap; shipping on it was a deliberate call to unblock this phase rather than block on Klipy's review queue. Production access has been requested but not granted — revisit before the cap becomes a real-usage problem, not before ship.
- **OQ3 (non-blocking)** — Caps on pack size: number of entries, per-image bytes, total pack bytes. Needed before authoring ships to avoid a member uploading a 50 MB pack every squad must download.
- **OQ4 (non-blocking)** — Moderation. A pack propagates to every squad member automatically. Pacto already carries arbitrary user images, so this is new in reach rather than in kind, but a member-level mute or hide for a pack may be warranted.

### Sources

- Issue [#200](https://github.com/covenant-gov/pacto-app/issues/200) — original GIF picker request, including the now-invalidated Option B recommendation.
- Issue [#173](https://github.com/covenant-gov/pacto-app/issues/173) — Tor routing via embedded Arti; blocks the deferred proxy work.
- [Klipy integration requirements](https://docs.klipy.com/integration-requirements.md) — the no-re-hosting clause.
- [Klipy attribution](https://docs.klipy.com/attribution.md) — mandatory `"Search KLIPY"` placeholder.
- [Klipy share trigger](https://docs.klipy.com/gifs-api/gifs-share-trigger-api.md), [search](https://docs.klipy.com/gifs-api/gifs-search-api.md), [trending](https://docs.klipy.com/gifs-api/gifs-trending-api.md).
- [NIP-30](https://github.com/nostr-protocol/nips/blob/master/30.md), [NIP-51 kind 30030](https://github.com/nostr-protocol/nips/blob/master/51.md) — custom emoji sets; static-emoji oriented, no GIF catalog.
- [Blossom BUD-12](https://github.com/hzrd149/blossom/blob/master/buds/12.md) — `/list/<pubkey>`, marked unrecommended; no discovery layer.
- `docs/messaging/ATTACHMENTS.md` — existing pipeline and the Blossom privacy disclosure R21 mirrors.
- Repo grounding: `src/components/dm/MessageInput.svelte` (media panel shell, tab strip, hardcoded strings), `src-tauri/src/db.rs` (`maybe_upsert_governance_from_announce`, the MLS announce authorization pattern), `src-tauri/src/blossom.rs` (upload with failover), `src-tauri/src/message.rs` (`send_file_bytes`), `src-tauri/src/evm/access_control/capability.rs` (why KD6 rejects on-chain gating).

---

## Planning Contract

### Product Contract preservation

Product Contract unchanged. No R/A/F/AE IDs were added, split, or reworded during enrichment.

### Key Technical Decisions

- **KTD1 — A pack is one row with a JSON `entries` column, not a parent/child table pair.** Instantiates KD4's last-write-wins: the pack is replaced atomically, so entry-level rows would buy nothing but merge semantics we explicitly rejected. Mirrors `squad_infra` (`src-tauri/src/migrations/V14__squad_infra.sql`).
- **KTD2 — The announce is *sent* from the frontend, *ingested* in Rust.** This is not a split for its own sake: it is exactly how `governance_updated` already works. The frontend wraps the payload with `buildAnnounceContent` (`src/lib/announcements.ts:251`) and ships it via `sendDmMessage` → `invoke('message', { virtualBucket })` (`src/lib/api/nostr.ts:283`), as `src/routes/+page.svelte:284` already does. Rust only classifies and upserts. Governs R4.
- **KTD3 — Last-write-wins is compared explicitly on `updated_at`.** The existing governance upsert overwrites unconditionally, relying on MLS in-order delivery. That is not good enough here — two members editing within the same sync window is the expected case (AE2), not an edge case. The sticker upsert compares `payload.updated_at` against the stored row and drops the older announce. Governs R4, AE2.
- **KTD4 — Pack images compose four existing functions; no new crypto and no new upload code.** `util::sniff_extension_and_mime` (`src-tauri/src/util.rs:841`) → `crypto::generate_encryption_params` (`src-tauri/src/crypto.rs:50`) → `crypto::encrypt_data` (`src-tauri/src/crypto.rs:65`) → `blossom::upload_blob_with_progress_and_failover` (`src-tauri/src/blossom.rs:243`). Read path is `net::download` → `crypto::decrypt_data` (`src-tauri/src/crypto.rs:265`), mirroring `decrypt_and_save_attachment` (`src-tauri/src/lib.rs:5390`). `gif` and `webp` are already in `EXT_TO_MIME` (`src-tauri/src/util.rs:556`), so animated stickers need no new mime handling. Governs R5.
- **KTD5 — Sending a sticker calls the existing `onSendFile` prop.** The composer already exposes `onSendFile(bytes, fileName, repliedTo, useCompression)` (`src/components/dm/MessageInput.svelte:45`), wired in both consumers. A sticker tap decrypts to bytes and calls it. No new prop, no new callback, no change to `ChatView.svelte` or `DmThread.svelte`. Governs R6, R7, KD7.
- **KTD6 — Compression is forced off for stickers.** `useCompression: false` on the `onSendFile` call. Re-encoding would destroy animation. Governs R6.
- **KTD7 — Pack authoring is a new runes component mounted as a `ParentDashboard` tab.** `ParentDashboard.svelte` is one of the three legacy god shells AGENTS.md forbids converting, so the authoring UI is carved as a runes child alongside `DashboardStatusTab` / `DashboardCrewTab` rather than written into the shell. Governs R8.
- **KTD8 — `MessageInput.svelte` stays legacy.** It uses `export let` (`:38-57`). Runes mode is all-or-nothing per file, so the Stickers tab is added in legacy syntax. Converting it is explicitly out of scope. Governs R1.

### Cross-unit contract

Fixed up front so U1–U7 can be built concurrently. Any unit needing a change here must say so rather than diverge.

**Table** — `sticker_packs`, one row per pack:

| Column | Type | Notes |
|---|---|---|
| `squad_id` | TEXT NOT NULL | MLS group id of the squad's announcements chat |
| `pack_id` | TEXT NOT NULL | UUID, stable across edits |
| `name` | TEXT NOT NULL | |
| `entries` | TEXT NOT NULL | JSON array of `StickerEntry` |
| `updated_at` | INTEGER NOT NULL | Unix seconds; the LWW comparison key |
| `updated_by` | TEXT NOT NULL | Author npub |
| `deleted` | INTEGER NOT NULL DEFAULT 0 | Tombstone; a deleted pack still needs a row so a stale announce cannot resurrect it |

Primary key `(squad_id, pack_id)`.

**`StickerEntry`** — `{ shortcode, url, key, nonce, mime, size }`. `key` and `nonce` are hex, exactly as `crypto::EncryptionParams` produces them (`src-tauri/src/crypto.rs:14`).

**Announce wire format** — the string handed to `sendDmMessage`:

```json
{ "pacto_virtual_bucket": "announcements",
  "type": "sticker_pack_updated",
  "payload": { "squad_id": "…", "pack_id": "…", "name": "…",
               "entries": [ … ], "updated_at": 0, "deleted": false } }
```

**Tauri commands** — snake_case, all `Result<_, String>`:

| Command | Signature | Purpose |
|---|---|---|
| `list_sticker_packs` | `() -> Vec<StickerPackDto>` | Every non-deleted pack across every squad the account belongs to |
| `save_sticker_pack` | `(squadId, packId, name, entries, deleted) -> StickerPackDto` | Persist locally and stamp `updated_at`; the caller then sends the announce |
| `upload_sticker_image` | `(bytes, fileName) -> StickerImageUploadDto` | Sniff, encrypt, upload; returns `{ url, key, nonce, mime, size }` |
| `fetch_sticker_image` | `(url, key, nonce) -> String` | Download and decrypt to a cached file path for rendering |

**Emitted event** — `sticker_packs_updated`, payload `{ "packs": StickerPackDto[] }`, emitted after any local save and after any accepted announce ingest.

**Frontend modules** — `src/lib/api/stickers.ts` (typed wrappers plus the `StickerPack` / `StickerEntry` types, which every other unit imports from here) and `src/stores/stickers.ts` (`stickerPacks` writable, `hydrateStickerPacks()`).

**i18n keys** — composer keys under `messaging.messageInput.*`: `stickersTab`, `searchStickersPlaceholder`, `searchStickersAria`, `noStickersFound`, `noStickerPacks`, `noStickerPacksHint`, `insertStickerNamed`, plus `searchGifsPlaceholder` and `searchGifsAria` which replace the two hardcoded English strings. Authoring keys under `squad.stickers.*`.

---

## Implementation Units

### Phase 1 — Stickers

U1–U7 have **no overlapping files** and may all be built concurrently against the cross-unit contract above.

### U1. Sticker pack storage, announce ingest, and routing

**Goal:** Persist packs and accept `sticker_pack_updated` announces from squad members.

**Requirements:** R2, R4. Implements KTD1, KTD3.

**Dependencies:** None.

**Files:**
- `src-tauri/src/migrations/V<UTC timestamp>__sticker_packs.sql` — create via `make new-migration name=sticker_packs`; never hand-number
- `src-tauri/src/db.rs`
- `src-tauri/src/virtual_channel_bucket.rs`

**Approach:**
1. Migration creates `sticker_packs` per the contract table.
2. In `db.rs`, add `upsert_sticker_pack_inner`, `load_sticker_packs`, and `maybe_upsert_sticker_pack_from_announce`, modelled on `maybe_upsert_governance_from_announce` (`:2435`) — including its fail-closed author check via `is_author_mls_member_for_chat` (`:1270`) and its `payload.squad_id == chat_id` guard.
3. Unlike the governance upsert, compare `payload.updated_at` to the stored row and return early when the incoming announce is older or equal. This is KTD3 and the reason U1 is not a copy-paste of the governance path.
4. Call the new handler from `apply_mls_virtual_bucket_side_effects` (`:2968`) in the `announcements` branch, beside the existing governance dispatch.
5. In `virtual_channel_bucket.rs`, extend `normalize_virtual_bucket_for_message` (`:12-82`) so `type == "sticker_pack_updated"` routes to `announcements`. The governance branch at `:67-75` is the shape to follow, minus its provider check.

**Patterns to follow:** `maybe_upsert_governance_from_announce`, `upsert_squad_infra_inner`, `V14__squad_infra.sql`.

**Test scenarios:**
- An announce from a current MLS group member upserts the pack.
- An announce from a non-member is dropped and writes nothing.
- An announce whose `payload.squad_id` differs from `chat_id` is dropped.
- An announce with `updated_at` older than the stored row leaves the row untouched (AE2).
- An announce with `updated_at` newer replaces `name`, `entries`, and `updated_by`.
- Two announces arriving out of order converge on the one with the greater `updated_at`.
- `deleted: true` tombstones the pack; a subsequent older announce does not resurrect it.
- `normalize_virtual_bucket_for_message` returns `announcements` for a `sticker_pack_updated` content string, and is unchanged for `governance_updated` and plain text.
- Malformed JSON, a missing `payload`, and a non-array `entries` each no-op without panicking.

**Verification:** `cargo test --lib` passes, including the existing `embedded_set_matches_committed_migration_files` backstop, which enforces the timestamped migration name.

### U2. Rust sticker asset pipeline and Tauri commands

**Goal:** Encrypt and upload pack images, fetch and decrypt them, and expose the pack commands.

**Requirements:** R5, R8. Implements KTD4.

**Dependencies:** U1 for the storage functions. Buildable in parallel against the contract.

**Files:**
- `src-tauri/src/sticker_pack.rs` (new)
- `src-tauri/src/lib.rs`

**Approach:**
1. New module with the four commands from the contract.
2. `upload_sticker_image` composes KTD4's four functions in order, taking blob servers from `get_blossom_blob_servers()` (`src-tauri/src/lib.rs:88`). Do not add a second upload path.
3. `fetch_sticker_image` mirrors `decrypt_and_save_attachment` (`src-tauri/src/lib.rs:5390`): `net::download` then `crypto::decrypt_data`, cached on disk and keyed by the blob hash so repeated picker renders do not re-download.
4. `save_sticker_pack` stamps `updated_at` server-side from the system clock rather than trusting a frontend value, then emits `sticker_packs_updated`.
5. Register all four in `generate_handler!` (`src-tauri/src/lib.rs:8956`), alphabetically within a `sticker_pack::` group.

**Patterns to follow:** `send_file_bytes` (`src-tauri/src/message.rs:1813`) for the sniff-encrypt-upload order; `download_attachment` (`src-tauri/src/lib.rs:5475`) for the fetch-decrypt order.

**Test scenarios:**
- `upload_sticker_image` on GIF bytes returns `image/gif` and a key/nonce pair that round-trips through `crypto::decrypt_data` back to the original bytes.
- The same for animated WebP.
- A zero-byte or unrecognized-magic-byte input errors rather than uploading.
- `save_sticker_pack` stamps a monotonically non-decreasing `updated_at` and ignores any client-supplied value.
- `save_sticker_pack` with `deleted: true` tombstones and the pack disappears from `list_sticker_packs`.
- `list_sticker_packs` returns packs from every squad and omits tombstoned ones.
- `fetch_sticker_image` with a wrong key returns an error rather than garbage bytes.

**Verification:** `cargo test --lib` passes; `pnpm check:tauri-commands` reports no new orphans once U3 lands.

### U3. Frontend sticker API, store, and event subscription

**Goal:** Typed access to packs, and live updates when an announce arrives.

**Requirements:** R9. Owns the shared types every other frontend unit imports.

**Dependencies:** U2 for the commands. Buildable in parallel against the contract.

**Files:**
- `src/lib/api/stickers.ts` (new)
- `src/stores/stickers.ts` (new)
- `src/lib/app/tauri-subscriptions.ts`
- `src/lib/api/stickers.test.ts` (new)

**Approach:**
1. `stickers.ts` exports the `StickerPack` and `StickerEntry` types plus the four `invoke` wrappers. These types are the contract's single source of truth for the frontend — U4 and U5 import them, they are not redeclared.
2. `src/stores/stickers.ts` holds `stickerPacks: writable<StickerPack[]>` and `hydrateStickerPacks()`. Stays on `svelte/store` per AGENTS.md; do not convert to `$state`.
3. Add a `sticker_packs_updated` listener in `tauri-subscriptions.ts` beside the existing listeners, replacing store contents wholesale.
4. Reset the store on logout alongside the other npub-scoped state.

**Patterns to follow:** existing `src/lib/api/*.ts` wrappers; the listener registrations already in `tauri-subscriptions.ts`; the `invoke` mock setup in `src/lib/wallet/backend-wallet.test.ts`.

**Test scenarios:**
- Each wrapper invokes its command with exactly the contract's camelCase argument keys.
- `hydrateStickerPacks` populates the store from the command result.
- A `sticker_packs_updated` event replaces store contents rather than appending.
- An `invoke` rejection surfaces through `getInvokeErrorMessage` and leaves the store unchanged.
- Logout empties the store.

**Verification:** `pnpm test` passes; `pnpm check` clean.

### U4. Stickers tab in the composer

**Goal:** A third tab that lists the user's packs and sends on tap.

**Requirements:** R1, R6, R9, R10, R11, R12. Implements KTD5, KTD6, KTD8.

**Dependencies:** U3 for types and store. Buildable in parallel against the contract.

**Files:**
- `src/components/dm/MessageInput.svelte`

**Approach:**
1. Widen `emojiPanelTab` from `'emoji' | 'gifs'` to include `'stickers'` and add the third tab button to the strip at `:907-930`.
2. Add a `{:else if emojiPanelTab === 'stickers'}` branch in the panel body beside the existing emoji and placeholder branches at `:840-905`. Grid markup and CSS mirror `.emoji-picker-grid` / `.emoji-picker-item`.
3. Source rows from the `stickerPacks` store, flattened across squads (R9) and grouped under a per-pack label, reusing the `.emoji-picker-label` section pattern.
4. The search input at `:812-838` already switches placeholder by tab; add the stickers case and filter entries by shortcode and pack name.
5. On tap: `fetchStickerImage` for bytes, then `onSendFile(bytes, fileName, repliedToId, false)` — compression off per KTD6 — then `closeEmojiPanel({ refocusComposer: true })`.
6. Gate the tab and its send on `disabled || isSendingAttachment`, matching `:795`.
7. Replace the hardcoded `'Search GIFs…'` and `'Search GIFs'` at `:816` and `:820` with the new i18n keys.

**Execution note:** This file is legacy Svelte and one of the codebase's largest components. Add the tab branch beside the existing ones; do not restructure the panel and do not convert the file.

**Patterns to follow:** the emoji tab's own search, grid, section-label, and empty-state markup in the same file.

**Test scenarios:** covered by the U7 walkthrough rather than unit tests — this component has no rendering tests today and adding a DOM harness is out of scope. `Test expectation: none — verified in the U7 MCP walkthrough (AE6, AE7).`

**Verification:** `pnpm check` and `pnpm lint` clean, including zero new raw-text warnings.

### U5. Squad sticker pack authoring

**Goal:** Let a member create and edit their squad's pack.

**Requirements:** R2, R3, R8. Implements KTD2, KTD7.

**Dependencies:** U3 for types and store. Buildable in parallel against the contract.

**Files:**
- `src/components/parent/dashboard/DashboardStickersTab.svelte` (new, runes mode)
- `src/components/parent/ParentDashboard.svelte`
- `src/stores/navigation.ts` (or wherever `squadDashboardChannelMode` is declared)

**Approach:**
1. New runes component: list current entries, add an image, assign a shortcode, remove an entry, rename the pack, save.
2. File picking uses `openFileDialog` from `@tauri-apps/plugin-dialog` filtered to `png,jpg,jpeg,gif,webp`, mirroring `src/components/settings/ProfileSection.svelte:13-95`.
3. Save is two steps and both must happen: `saveStickerPack(...)` to persist, then wrap the returned DTO with `buildAnnounceContent` (`src/lib/announcements.ts:251`) and send via `sendDmMessage` to the squad's announcements group id. This is KTD2, and `src/routes/+page.svelte:284` is the worked example. A save that skips the announce silently produces a pack only the author can see.
4. Register the tab in `ParentDashboard.svelte` beside the existing tabs and extend the dashboard-mode union. Carve the UI into the new child; do not write it into the shell (KTD7).
5. Surface per-image upload progress and per-image failure without discarding the rest of the edit.

**Patterns to follow:** `DashboardStatusTab.svelte` for a squad-scoped tab; `ProfileSection.svelte` for image picking; `src/components/ui/Modal.svelte` (`titleId`, `descriptionId`, `onClose`, `dismissible`) if a confirm step is needed.

**Test scenarios:**
- Shortcode validation rejects empty, whitespace-only, and duplicate-within-pack values.
- A save with no entries is permitted and clears the pack rather than erroring.
- An upload failure on one image leaves the other pending entries intact.
- Pure-UI wiring beyond these is covered by the U7 walkthrough (AE1).

**Verification:** `pnpm check` and `pnpm lint` clean; the new file is runes mode with no `export let`.

### U6. Translation catalogs

**Goal:** Every new string translated in `en` and `es`.

**Requirements:** R23.

**Dependencies:** None — the key list is fixed by the cross-unit contract.

**Files:**
- `src/lib/i18n/locales/en/messaging.json`, `src/lib/i18n/locales/es/messaging.json`
- `src/lib/i18n/locales/en/squad.json`, `src/lib/i18n/locales/es/squad.json`

**Approach:** Add every contract key to all four catalogs. `messaging.messageInput.gifsComingSoon` stays until Phase 2 removes it. Do not touch `.svelte` files — U4 and U5 own their own call sites.

**Test scenarios:** `Test expectation: none — data-only. Covered by AE8 and the lint raw-text gate.`

**Verification:** `en` and `es` have identical key sets under the touched namespaces; both parse as valid JSON.

### U7. Documentation and manual verification

**Goal:** Document the feature and prove it end to end.

**Requirements:** R21 (Phase 1 half), and the walkthrough evidence U4 and U5 defer to.

**Dependencies:** U1–U6.

**Files:**
- `docs/messaging/STICKER_PACKS.md` (new)
- `docs/messaging/ATTACHMENTS.md`
- `docs/README.md`

**Approach:** Document the announce wire format, the encrypted-blob model, and the membership-based authorization, and state plainly that packs are unreadable by non-Pacto clients (KD5). Cross-link from `ATTACHMENTS.md`, since packs reuse its pipeline. Then run the MCP walkthrough in `make dev-sandbox` per AGENTS.md: create a pack, confirm it reaches a second account, send a sticker in a DM, confirm the media tile renders for both sides.

**Test scenarios:** `Test expectation: none — documentation plus the manual walkthrough covering AE1, AE3, AE6, AE7.`

**Verification:** Screenshot paths and the navigation path exercised are recorded in the handoff.

### Phase 2 — Klipy GIFs

Blocked on OQ1 and OQ2. Planned for sequencing only; do not start until both are resolved.

### U8. Klipy egress module and proxy commands

**Goal:** One Rust chokepoint for every Klipy request.

**Requirements:** R13, R14, R17, R18, R19, R20. Implements KTD10 (KD10).

**Dependencies:** OQ1, OQ2.

**Files:** `src-tauri/src/klipy.rs` (new), `src-tauri/src/lib.rs`, `.env.example`

**Approach:** `GET /api/v1/{app_key}/gifs/search` and `/gifs/trending`, plus `POST /gifs/share/{slug}`, over the existing `reqwest` dependency. The key is read once through the OQ1 mechanism and never crosses the IPC boundary. No `customer_id` is sent (R20). Every response URL is passed through untouched (R16). Redact the key via `wallet_security::redact_urls_in_text` before surfacing any error, since the key sits in the URL path.

**Test scenarios:** response parsing against a captured fixture including all four size variants; a missing key yields a typed error rather than an unauthenticated request; error text never contains the key; URLs survive round-trip byte-identical.

**Status:** Shipped. `src-tauri/src/klipy.rs` implements all four commands (`klipy_search_gifs`, `klipy_trending_gifs`, `klipy_report_share`, `klipy_is_configured`); `KLIPY_API_KEY` documented in `.env.example`.

### U9. GIFs tab and opt-in disclosure gate

**Goal:** A working GIFs tab that makes no network call until the user accepts.

**Requirements:** R15, R17, R22, R23. Implements KD9.

**Dependencies:** U8.

**Files:** `src/components/dm/MessageInput.svelte`, a new runes disclosure component, `src/lib/api/klipy.ts`, `src/stores/persistence-context.ts` consumer, the four locale catalogs

**Approach:** Replace the `gifsComingSoon` placeholder. The acceptance flag is npub-scoped via `persistenceKey(prefix)`. The search placeholder is literally `"Search KLIPY"` (R17). Debounce reuses the manual `setTimeout` pattern from `src/lib/app/wake-sync.ts:41`.

**Test scenarios:** no Klipy invoke fires before acceptance (AE9); acceptance persists across restart and is per-account; debounce collapses rapid keystrokes into one request; empty query shows trending; no-results state renders.

**Status:** Shipped. `src/lib/api/klipy.ts`, `src/components/dm/GifDisclosure.svelte`, and the `GIFs` tab in `MessageInput.svelte` are landed and gated on `assertGifsDisclosureAccepted()`.

### U10. GIF URL delivery and rendering

**Goal:** Send a picked GIF as a provider URL and render it on receipt.

**Requirements:** R16, R18.

**Dependencies:** U8, U9.

**Files:** `src-tauri/src/message.rs`, `src/components/dm/MessageAttachment.svelte`, `src-tauri/src/klipy.rs`

**Approach:** A URL-bearing message rather than an encrypted blob, since KD8 forbids re-hosting. Receive-side fetch goes through `klipy.rs` (R19), not the webview. Fire the share-trigger on send (R18).

**Test scenarios:** the stored message carries the URL byte-identical (AE11); no fetch originates in the webview; a purged slug degrades to a broken-media state rather than a crash.

**Status:** In progress. A picked GIF today sends its `fullUrl` as plain message text through the composer's existing `onSend` path (`sendGifUrl()` in `MessageInput.svelte`) rather than the dedicated URL-delivery/receive-side-fetch design this unit specifies; `src-tauri/src/message.rs` and `MessageAttachment.svelte` have not yet picked up the Klipy-specific wiring.

### U11. Klipy privacy disclosure

**Goal:** Document the third-party call.

**Requirements:** R21.

**Dependencies:** U8–U10.

**Files:** `docs/messaging/ATTACHMENTS.md` or a new `docs/messaging/GIF_PROVIDER.md`

**Approach:** Mirror the existing Blossom disclosure: what leaves the device, to whom, tied to what identifier, and how to avoid it. Name the deferred Tor dependency (#173).

**Status:** Shipped as `docs/messaging/GIF_PROVIDER.md`, cross-linked from `docs/messaging/ATTACHMENTS.md` and indexed in `docs/README.md`.

---

## Verification Contract

| Gate | Command |
|---|---|
| Typecheck | `pnpm check` |
| Lint, including Tauri command wiring | `pnpm lint` and `pnpm check:tauri-commands` |
| Frontend unit tests | `pnpm test` |
| Backend tests, including the migration backstop | `cd src-tauri && cargo test --lib` |
| Manual UI walkthrough | Tauri MCP bridge against `make dev-sandbox`, per AGENTS.md |

Run the gates once at the end of Phase 1, not per unit — the units are concurrent and mid-flight gates block each other.

---

## Definition of Done

**Phase 1 is done when:**

- The composer shows three tabs on both the DM and squad channel surfaces, and the Stickers tab lists packs from every squad the account belongs to (AE6).
- A member can build a pack; another member on a different account receives it with no action (AE1).
- Concurrent edits converge on the later `updated_at` and neither client is left partially applied (AE2).
- A sticker sent to a non-member DM peer renders normally for them (AE3).
- A pack blob fetched directly from Blossom by hash is undecryptable ciphertext (AE4).
- A departing member stops receiving updates and keeps already-received stickers (AE5).
- A disabled composer cannot send a sticker (AE7).
- No hardcoded user-facing English remains in the media panel, and `en` and `es` resolve every new key (AE8).
- Every gate in the Verification Contract passes, and the MCP walkthrough evidence from U7 is in the handoff.

**Phase 2 is done when** AE9–AE12 hold and OQ1 and OQ2 are resolved rather than assumed.

**Tail ownership:** No commit, push, or PR without an explicit request. Changes stay in the working tree for review.
