# Commons — public discovery

**Commons** is the leftmost top-nav mode (**Commons | DMs | Squads**). It shows **time-bounded public broadcasts** from users and from **public squads** (including squad-pairs), filterable by up to three hashtags.

Broadcasts are **public Nostr events** on trusted relays — not MLS, not Gift Wrap. Anyone on those relays can read tag text and messages. Squad identity on cards uses the stable **announcements MLS group id** ([`DESIGN.md`](./DESIGN.md)).

Internal backlog and phase history: [`ai-docs/commons/COMMONS_PLAN.md`](../../ai-docs/commons/COMMONS_PLAN.md).

---

## Product rules

| Rule | Behavior |
|------|----------|
| **Private squad** | Default at create. No Commons metadata, no broadcast menu, not in feed. |
| **Public squad** | Elect **1–3 tags** at create. Auto **72 h** `#new` broadcast on success. **Broadcast Squad** in squad header menu (24 / 48 / 72 h) re-broadcasts without `#new`. |
| **User visibility** | No separate setting — **broadcasting is the public signal**. A user is discoverable only while they have an active broadcast. |
| **New vs active (implicit)** | A user's audience is derived, never chosen. The **first user broadcast ever** is shown as **new user** and carries the reserved **`#new`** tag; every later broadcast is **active user** with no `#new`. Tracked coarsely per npub (cancelling the first broadcast does not reset it). Newly created public squads always broadcast `#new` at create. The reserved `#new` tag cannot be self-selected. |
| **Cooldown** | One active broadcast per **(author npub, subject)** — user npub or squad id. UI blocks re-publish until `expiresAt`. |
| **Cancel** | The author can retract an active broadcast. Publishes a replacement (NIP-33, same `d`) with `cancelled: true`; clients drop it from the feed even before `expiresAt`, and the author's cooldown lifts so they can rebroadcast immediately. Newest-event-wins keeps the tombstone hidden and prevents feed spam. |
| **Feed** | Active broadcasts only; relay lookback **≤ 72 h** (max TTL). Refreshes every **60 s** while Commons is open. |
| **Squad broadcast roles** | Stub allows all members today; `canBroadcastSquad` in `src/lib/commons/permissions.ts` will gate on Squad Admin when on-chain roles ship ([`ai-docs/INHOUSE_GOV.md`](../../ai-docs/INHOUSE_GOV.md#commons-squad-broadcast-role-gate)). |

---

## User flows

### Discover

1. Open **Commons**.
2. **Passive browse:** scroll the curated category **tiles**; click one to expand its tags. **Focused search:** open **Browse tags** (genre-style dropdown) to drill categories → tags — this hides the tiles. Both pick from the same curated tag tree (no free-text tag entry).
3. Refine with **Show: all / squads / users** and **Audience: all / new / active** segmented switches. **Categories** resets tags and switches back to the default tile view; selected tags can also be removed individually.
   - **Combine logic:** **Category** tile search = **ANY** of all tags in that category (one category chip in the filter bar; no 3-tag cap). **Tags** menu search = **AND** of up to 3 chosen tags (each shown as a chip). Show and Audience are **AND** on top of either mode. **All** on a switch means no constraint. Picking tags clears an active category; opening **Tags** clears category. **Categories** resets everything.
4. Cards show name, tags, message, time until expiry.
5. **Message** (user) → opens DM with that npub.
6. **Request to join** (squad) → structured DM (`commons_join_request`); squad side uses existing invite/join handling.

### Publish — squad

- **Create public squad** → automatic **72 h `#new`** broadcast (tags from create form + reserved `#new`).
- **Squad header menu → Broadcast Squad** (public squads only) → duration + message modal (no `#new`).
- Cooldown copy when a broadcast is still active.

### Publish — user

- **Commons → + Broadcast** (personal panel) → broadcast modal (tags, duration, message). No audience choice. Tags are picked from the curated tree via a searchable dropdown (`CommonsTagPicker`); typing only matches existing tag names — no free-text tags.
- No visibility toggle: broadcasting makes the user discoverable for the broadcast's TTL.
- The **first broadcast ever** is auto-classified as a new user and tagged `#new`; later broadcasts are active users.

---

## Wire format

Public **Kind 30078** ([NIP-33](https://github.com/nostr-protocol/nips/blob/master/33.md) parameterized replaceable events). Same kind as other app-specific public events (e.g. dashboard polls), but Commons uses its own `d` tag and schema.

| Field | Value |
|-------|--------|
| **kind** | `30078` |
| **content** | JSON — schema `pacto.commons.broadcast.v1` |
| **`d`** | `pacto_commons_broadcast` (v1; see NIP-33 note below) |
| **`client`** | `pacto` |
| **`subject`** | `user` \| `squad` |
| **`exp`** | Expiry unix seconds (string) |
| **`t`** | Each tag (lowercase, max 3) |
| **`squad`** | Announcements MLS group id when `subject=squad` |

`content` JSON may also carry `cancelled: true` — a tombstone published to retract a still-unexpired broadcast. Clients keep the **newest** event per `(author, subject)` and drop the subject when that newest event is cancelled.

### JSON payload (examples)

**Squad broadcast:**

```json
{
  "schema": "pacto.commons.broadcast.v1",
  "subject": "squad",
  "message": "Open cohort for on-chain gov experiments.",
  "durationHours": 24,
  "expiresAt": 1740000000,
  "tags": ["neo", "coordination"],
  "squad": {
    "id": "<announcements_mls_group_id>",
    "name": "Neo Builders",
    "kind": "squad",
    "iconUrl": "https://…"
  }
}
```

**User broadcast:**

```json
{
  "schema": "pacto.commons.broadcast.v1",
  "subject": "user",
  "message": "Building wallet tooling; happy to DM.",
  "durationHours": 48,
  "expiresAt": 1740086400,
  "tags": ["neo"],
  "audience": "active_user"
}
```

`audience` is `new_user` \| `active_user` for user subjects only.

### Validation (publisher + consumer)

| Rule | Detail |
|------|--------|
| Tags | 1–3; `^[a-z0-9_]{1,32}$` after lowercasing and stripping `#` |
| TTL | `durationHours ∈ {24, 48, 72}` |
| Expiry | `expiresAt ≈ created_at + durationHours × 3600` (±60 s) |
| Squad id | Must match `squad` tag and payload; stable announcements group id |
| Expired | Dropped from feed and pruned from local cache |

### Join request DM (not Commons feed)

Kind **14** text with JSON `schema: pacto.commons.join_request.v1` — see `src/lib/commons/commons-join-request.ts`. Rate-limited client-side (24 h per squad target).

---

## NIP-33 enforcement (v1 vs future)

Kind **30078** is already a NIP-33 replaceable kind. **v1 does not use per-subject `d` tags**, so relays keep **every** published event until it ages out; the app enforces “one active card” by:

1. **Local cooldown** — `pacto_commons_broadcasts_<npub>` + SQLite active row per subject.
2. **Ingest dedupe** — newest non-expired event per `(authorNpub, subjectId)` in Rust and `dedupeCommonsBroadcasts` in the feed.

**To enforce NIP-33 at relay level** (post-v1, CM-10): use a **unique `d` per broadcast slot**, e.g. `pacto_commons_broadcast/user` for the author’s user slot and `pacto_commons_broadcast/squad/<groupId>` for each squad they broadcast. A newer publish with the same `(pubkey, kind, d)` replaces the old event on well-behaved relays.

| Work item | Effort |
|-----------|--------|
| Derive `d` from subject + subject id in `commons_publish_broadcast` | Small |
| Validate `d` on ingest | Small |
| Widen REQ filter (`kind` + `#client` instead of single `#d`) | Small |
| Tests + doc update | Small |
| **Breaking change** — flat `d` events stop matching until 72 h TTL clears | Acceptable pre-alpha |

**Overall: low–medium** (~half day). Deferred until dogfood shows duplicate-card noise; current dedupe + cooldown is enough for v1.

Optional later: slow-changing **`d: pacto_commons_squad`** profile event for tag discovery between broadcasts (also CM-10).

---

## Local persistence

| Key / table | Purpose |
|-------------|---------|
| `pacto_squads_<npub>` | `visibility`, `commonsTags` on each squad |
| `pacto_commons_broadcasted_<npub>` | Set after the first user broadcast; flags later broadcasts as active (persists across logout) |
| `pacto_commons_broadcasts_<npub>` | Own active broadcasts (cooldown UX) |
| `pacto_commons_join_requests_<npub>` | Join-request rate limit |
| SQLite `commons_broadcasts` | Ingested feed cache (per account DB) |

Cleared on logout via `clearAccountState`, except `pacto_commons_broadcasted_<npub>`, which persists so a returning account is not re-flagged as new.

---

## Implementation map

| Layer | Location |
|-------|----------|
| Wire + publish/fetch | `src-tauri/src/commons.rs` |
| Tauri commands | `commons_publish_broadcast`, `commons_fetch_broadcasts`, `commons_get_local_active`, `commons_cancel_broadcast` |
| Frontend API | `src/lib/api/commons.ts` |
| Types | `src/lib/commons/types.ts` |
| Feed filter/sort/dedupe | `src/lib/commons/commons-feed.ts` |
| Tag normalization + reserved tags | `src/lib/commons/tags.ts` |
| First-broadcast tracking (new vs active) | `src/lib/commons/first-broadcast.ts` |
| Tag taxonomy (curated tree + art) | `src/lib/commons/tag-catalog.ts` |
| Squad auto-broadcast on create | `src/lib/commons/squad-create-broadcast.ts` |
| Squad re-broadcast | `src/lib/commons/squad-broadcast.ts`, `BroadcastSquadModal.svelte` |
| User broadcast | `src/lib/commons/user-broadcast.ts`, `UserCommonsBroadcastPanel.svelte`, `PersonalBroadcastModal.svelte` |
| Feed UI | `CommonsView.svelte`, `CommonsTopFilters.svelte`, `CommonsBroadcastCard.svelte` |
| Tag browse / search | `CommonsTagBrowser.svelte` (passive tiles), `CommonsTagMenu.svelte` (shared genre dropdown), `CommonsTagPicker.svelte` (searchable picker wrapping the menu, used in the broadcast composer) |
| Personal panel | `CommonsPersonalPanel.svelte` |
| Card actions | `src/lib/commons/commons-card-actions.ts` |
| Join request | `src/lib/commons/commons-join-request.ts`, `CommonsJoinRequestCard.svelte` |
| Role gate (stub) | `src/lib/commons/permissions.ts` |
| Squad create visibility UI | `SquadCommonsVisibilityFields.svelte` |

Relays: **`TRUSTED_RELAYS`** only (same curated set as other app-specific public events). No Commons traffic on MLS or DM sync paths.

---

## Privacy and abuse (v1)

- **Public by design** — tags and broadcast text are visible on relays; modals should set expectations.
- **Impersonation** — squad name/id in JSON is a **claim**; join flow uses existing invite/crypto, not card text alone.
- **Spam** — trusted relays only; mute/report not in v1.
- **Tag charset** — ASCII lowercase + digits + underscore only.

---

## Related docs

| Doc | Relevance |
|-----|-----------|
| [`DESIGN.md`](./DESIGN.md) | Squad id = announcements MLS group id |
| [`../nostr/ARCHITECTURE.md`](../nostr/ARCHITECTURE.md) | Nostr paths vs MLS/DM |
| [`../dashboard/POLLS.md`](../dashboard/POLLS.md) | Kind 30078 JSON schema pattern |
| [`../../ai-docs/INHOUSE_GOV.md`](../../ai-docs/INHOUSE_GOV.md) | Future Squad Admin broadcast gate |
