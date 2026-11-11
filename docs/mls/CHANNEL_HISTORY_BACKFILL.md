# MLS channel history backfill

**Status:** Accepted for implementation. Wire version is **1**. Unknown versions are rejected. There is no second reader for an older shape.

A device that just accepted an MLS welcome cannot decrypt earlier group messages. One current member copies the last 30 days of human chat to the joiner. Live chat stays MLS. The joiner cannot prove the copy against the Kind 444 transcript. The serving member can omit or alter lines.

This is not dashboard catch-up. `squad_state_sync_request` stays as documented in [`../communities/DESIGN.md`](../communities/DESIGN.md). Events, docs, roster, and infra do not move through this protocol.

## When it runs

The joiner posts `history_request` only after this device has recorded a welcome accept time for that group (see [Welcome divider](#welcome-divider)).

| Channel | Request |
|---------|---------|
| `#announcements` | `bucket` is `"announcements"` on the shared hub MLS group |
| Open custom channel, once this member is admitted | `bucket` is `null`; the channel has its own group id |
| Closed custom channel, when this member is added | `bucket` is `null`; the channel has its own group id |

Do not request `#polls`, `#join-requests`, or `#personal-alerts`. Those are other virtual buckets on the hub group. A hub welcome requests the `announcements` bucket only. Skipping them by group id would also skip announcements. Bucket values are the enum in [`VIRTUAL_CHANNEL_ROUTING_ADR.md`](./VIRTUAL_CHANNEL_ROUTING_ADR.md).

One sequence per group. If any imported row already exists for that group, do not request again. A sequence that is still in progress may resume. A finished sequence (at least one accepted chunk, `history_unavailable` from the current candidate, or three exhausted attempts) does not restart on a later launch.

## Messages

Three JSON objects. `history_request` is an MLS group message. `history_chunk` and `history_unavailable` are Kind 14 rumor contents inside a NIP-59 gift wrap addressed only to the requester.

`history_request` is stored so members can answer it, and it is not rendered in the channel (no card, no structured notice). The gift wraps are not rendered in the DM thread and must not create or bump a visible DM conversation. Same hide posture as `channel_in_squad`.

Group ids compare as lowercase hex. `requestId` is 32 hex characters from random bytes.

### `history_request`

Posted into the MLS group. Every member can read it. Only `designatedNpub` answers.

```json
{
  "type": "history_request",
  "version": 1,
  "requestId": "…32 hex…",
  "groupId": "…lowercase hex…",
  "bucket": "announcements",
  "attempt": 1,
  "designatedNpub": "npub1…"
}
```

`bucket` is required. It is the string `"announcements"` or JSON `null`. An absent `bucket` is a malformed request and is ignored. `attempt` is the integer 1, 2, or 3.

The hub request is stored in the `announcements` virtual bucket. A custom-channel request has no bucket.

### `history_chunk`

Rumor content is this object. UTF-8 JSON byte length is at most **12288** (12KB). The gift-wrap event may be larger. The cap is the rumor content.

```json
{
  "type": "history_chunk",
  "version": 1,
  "requestId": "…",
  "groupId": "…",
  "bucket": "announcements",
  "index": 0,
  "total": 3,
  "messages": []
}
```

`index` is zero-based, `total` is at least 1, and `index` is less than `total`. `bucket` matches the request (`"announcements"` or `null`).

Each entry in `messages` is one `events` row, not a denormalized bubble with edits folded in:

| Field | Meaning |
|-------|---------|
| `id` | Original event id |
| `kind` | 14 (text), 15 (file), 16 (edit), or 7 (reaction) |
| `createdAt` | Original `created_at`, Unix seconds |
| `authorNpub` | Sender npub |
| `content` | Stored content. Kind 15 content is the blob URL. |
| `tags` | Stored Nostr tags (`string[][]`), including kind-15 file tags |
| `referenceId` | Reply, reaction, or edit target, or `null` |

Do not copy `mine`, `pending`, `failed`, `received_at`, `wrapper_event_id`, local `chat_id`, or local `user_id`. Order entries by `createdAt`, then `id`.

Kind 15 copies the descriptor only: content URL plus tags `file-type`, `size`, `encryption-algorithm`, `decryption-key`, `decryption-nonce`, `ox`, and optional `filename` and `caption`. Do not copy blob bytes. A dead URL stays a dead attachment. See [`../messaging/ATTACHMENTS.md`](../messaging/ATTACHMENTS.md).

### `history_unavailable`

```json
{
  "type": "history_unavailable",
  "version": 1,
  "requestId": "…",
  "groupId": "…",
  "reason": "empty"
}
```

`reason` is `"empty"` (no exportable row) or `"over_cap"` (the export would exceed 32 chunks). Send no chunks in either case.

## Who answers

Roster is the group's `membersByGroupId` npubs, sorted ascending by the npub string, skipping this device. The requester picks `designatedNpub` as the entry at index `attempt - 1`. If fewer candidates exist than `attempt`, the sequence stops. No further MLS message is posted.

Other members ignore the request. The joiner accepts a chunk or an unavailable reply only when the gift-wrap sender is the `designatedNpub` of the current attempt.

The designated member exports with its own clock: `since = now - 30 days`, where 30 days is `30 * 24 * 60 * 60` seconds and `created_at >= since`. It does not trust a window sent by the joiner.

Timeout is 20 seconds from the post of that attempt.

- A `history_unavailable` for this `requestId`, with no chunk yet accepted, advances to the next attempt.
- A timeout with no chunk yet accepted advances the same way.
- The first valid chunk completes the sequence. Do not ask the next member. Later chunks for that `requestId` still import. A missing index stays missing.

## Export filter

The filter is frozen here. Later slices do not widen or narrow it.

Include an `events` row when all of the following hold:

1. It belongs to the requested group.
2. When `bucket` is `"announcements"`, `virtual_bucket` is `announcements`. When `bucket` is `null`, do not filter on bucket.
3. `kind` is 14, 15, 16, or 7.
4. The row is not pending and not failed.
5. `created_at` is inside the window above.
6. The content is human chat, by the rule below.

Human chat is the same rule as `isStructuredProductContent` in `src/lib/messaging/structured-content-notice.ts`. The Rust export and the TypeScript parser both use this rule:

- Content that is not a JSON object is human.
- A JSON object whose `kind` is `pacto.mentions.envelope.v1` is human.
- A JSON object whose `schema` is a string, or whose `type` is a string, is structured product and is excluded.

That exclusion covers governance, roster shares, catalog, join inbox, polls, inbox automation, squad events, squad docs, and these three protocol messages. Kind 30078 (typing and other app data) is outside the kind allowlist.

A single inner record that cannot fit in one chunk under the 12KB cap is dropped, not split. If the remaining records need more than **32** chunks, the peer sends `history_unavailable` with `reason` `"over_cap"` and sends nothing.

## Chunk acceptance

Reject the whole chunk, and import nothing from it, when any of these are true:

- UTF-8 JSON is longer than 12288 bytes.
- `version` is not 1.
- `groupId`, `requestId`, or `bucket` does not match the outstanding request.
- The gift-wrap sender is not the current `designatedNpub`.
- `index` or `total` is out of range.
- Any inner message has a kind other than 14, 15, 16, or 7, is missing `id` or `authorNpub`, or is structured product JSON under the rule above.

Other chunks of the same request are judged on their own. The joiner does not re-apply the 30-day window.

## Import

Import writes `events` rows through a dedicated insert. It does not run the MLS rumor pipeline and it does not call `apply_mls_virtual_bucket_side_effects`. Several side effects still run when the virtual bucket is missing, so skipping that call is required even after the filter.

On insert:

- Keep the original `id`, author npub, `created_at`, content, tags, `referenceId`, and kind.
- Set `mine` from whether `authorNpub` is the local npub.
- Set `received_at` to local receipt time.
- Set `history_import` to 1.

`history_import` is an `INTEGER NOT NULL DEFAULT 0` column on `events`, added by a timestamped migration. Existing rows stay 0.

Dedup on event id. If the id already exists, leave that row unchanged. Do not overwrite an MLS row, and do not flip its flag. Importing the same chunk twice does not add rows.

A smuggled `governance_updated` or `squad_member_evm_share` never reaches this insert: the chunk is rejected first. If one were inserted anyway, the skipped side-effect call still leaves infra and roster tables unchanged.

`edit_message` rejects a row with `history_import = 1`, including when the original `created_at` is inside the 60-second edit window. The composer does not offer edit on those rows. A new reply or reaction is a normal MLS message.

## Welcome divider

`mls_history_welcome_v1` (a list of group ids) is retired. The next key stores a map of lowercase group id to accept time, Unix milliseconds, recorded when the welcome is marked. A missing key or a v1 value loads as an empty map. Do not translate the old list.

Every row with `history_import = 1` renders above the welcome note, including a forged `created_at` later than the accept time. Live MLS rows render below the note. Imported rows order by `created_at`, then id. The note is not a stored event.

The note's copy says the lines above it are a copy from a member, and that this device still cannot decrypt the pre-join MLS transcript. English and Spanish catalogs carry that claim. The client does not check the copy against Kind 444.

## Out of scope

Public or NIP-28 rooms. Sharing MLS epoch keys. Replaying Kind 444. Writing the archive into the group. History older than 30 days. Copying blob bytes. Changing `squad_state_sync_request` or dashboard catch-up.
