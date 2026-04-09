# Dashboard polls — cross-device sync via announcements MLS (plan)

This document is a **design and implementation plan** for evolving dashboard polls from **device-local `localStorage` only** to **member-visible tallies** on every device in the same squad or network, using the **#announcements MLS group** as the transport. It does not change product code by itself.

## Goals

- **Shared truth:** Everyone in the parent’s **announcements channel** sees the **same poll definitions** and **aggregate vote counts** (subject to sync latency).
- **One identity, one vote per poll:** **At most one counted vote per `(poll_id, voter_npub)`** cluster-wide. “Voter” is the **author pubkey of the signed rumor** (the same identity the app already uses for MLS membership), not a self-reported string in JSON.
- **Visibility in #announcements:** **`create`** must produce a **visible row** in the announcements channel so members notice the poll and can open **# dashboard → Polls** to vote. **`vote`** rumors stay **out of the feed** (silent tally only); they are ingested for counts only.
- **Local materialization:** Each device keeps a **local store** (SQLite and/or structured desktop storage) that merges **local edits** and **remote events** into a **render model** the Polls UI reads.

## Product decisions (locked)

| Topic | Decision |
|--------|----------|
| **Changing a vote** | **Last vote wins.** Each new **`vote`** rumor from the same author for the same `poll_id` **replaces** the previous choice in the tally (single row per `(poll_id, voter_npub)`; recount or delta per implementation). |
| **Platform** | **Tauri only.** There is no web build for Pacto; persistence and MLS are **desktop** (Rust + SQLite). Do not design for browser-only `localStorage` as the source of truth for synced polls. |
| **Conflicting `create` / collision resistance** | **`poll_id`** is a **cryptographically random UUID** (e.g. `randomUUID`) so accidental collision is negligible. If a second **`create`** arrives with the **same `poll_id`** but **different** payload (malicious or buggy), replicas treat **the first ingested create as canonical** and **ignore** later creates for that id (**first wins** for poll definition). Same payload + same id = harmless idempotent replay. |
| **Poll lifecycle (POC)** | No **`close`**, no deadlines, no “poll ended” state in v1. |
| **Who may create polls** | **Permissionless:** any MLS member of **#announcements** may publish **`create`**; no moderator gate in v1. |
| **Create vs vote in the timeline** | **`create`:** at least **one** human-visible announcement (same thread as other MLS announcements). **`vote`:** no timeline rows; under-the-hood only. |

### Clarification: what “question 3” meant (conflicting creates)

The risk is not random UUID collision—it is **two MLS messages** both saying “I am the `create` for `poll_id` = *X*” with **different** titles or options. Without a rule, clients could flip-flop or show ambiguous state. **Locked rule:** once a `poll_id` exists in the replica from a valid **`create`**, **do not apply** a later **`create`** that would change title/options for that id (first rumor wins). Votes always reference option ids from **that** definition.

## Non-goals (for this phase)

- Strong **anonymity** of votes inside the group (all members can decrypt MLS content; vote events are attributable to npub).
- **Global** or **public relay** visibility; scope is **MLS group members only**.
- **On-chain** voting or **proof-of-personhood** beyond “this MLS message was sent by member key `X`.”

## Current baseline (today)

- Poll bodies and per-device “I already voted” hints live in **browser `localStorage`**, keyed by **logged-in npub** and **parent id**.
- Nothing is published over Nostr/MLS for polls; **no propagation** to other members.

## Recommended transport

### Medium

- Use the parent’s **`#announcements` MLS `groupId`** as the **only** distribution channel for poll **`create`** (see below) and **`vote`** rumors.
- Rationale: membership is already aligned with “people who should see squad/network signals”; no new group setup.

### Wire path

- Same as other MLS traffic: **Kind 444** on the wire; inner **rumor** after MLS decrypt (see [`docs/messaging/OVERVIEW.md`](../messaging/OVERVIEW.md)).

### Rumor shape (proposal)

- **`vote`:** Use the **application-specific** pattern (**Kinds like 30078** and structured `content`) so **votes never appear** as normal Kind **14** announcement lines.
- **`create`:** Must still **feed the poll replica** and **surface in #announcements**. Implementations can (a) send **one** structured `create` rumor and **render** it in the announcements list with a **dedicated poll-created** template, or (b) send **two** MLS payloads (structured `create` + a short Kind **14** line). Prefer **(a)** if one message can satisfy both storage and UI without duplicate ids confusing the replica.

Suggested content (JSON, versioned), for example:

- `schema`: `"pacto.dashboard_poll.v1"`
- `action`: `"create"` | `"vote"` (optional future: `"close"` — **out of scope for POC**)
- `parent_id`: squad/network id (string the app already uses for dashboard parent)
- `poll_id`: uuid (or deterministic id if you later want idempotency debates)
- For **`create`**: `title`, `description` (optional string), `options`: `[{ "id", "label" }, …]` (min two options); author pubkey is **`created_by`** in the replica (do not trust a duplicate field in JSON over the rumor author).
- For **`vote`**: `option_id` (uuid matching options on the poll definition)

**Tags (recommended):** duplicate critical ids in tags (`poll`, `parent`, `option`) so Rust/JS can **filter without parsing JSON** on hot paths.

**Signing:** Author is the **rumor pubkey**; clients **must not** trust a voter npub taken only from JSON. Identity for **one-vote rules** = **event author**.

## Timeline visibility (create vs vote)

| Action | #announcements feed | Poll replica / tallies |
|--------|---------------------|-------------------------|
| **`create`** | **Show** (e.g. card or line: title, hint to open **Dashboard → Polls**, optional `poll_id` / chat ref) | Upsert poll document |
| **`vote`** | **Hide** (do not add a chat row) | Update effective vote (**last wins**) |

**Votes** — classify in `process_rumor` / UI: ingest for **`dashboard_poll_replica`**, **exclude** from the default message list query **or** filter in the announcements virtual list (same outcome: no new line per vote).

**Creates** — ensure the announcements **Message** path (or a parallel “system line” model) **includes** poll-created items so history sync and push behave like other channel traffic. All devices still receive the bytes for replay.

## Local data model (each device)

### Poll document

- `poll_id`, `parent_id`, title, description, options `{ id, label }`, `created_at`, `created_by` (npub), optional `announcements_group_id` for sanity checks.
- **Tallies:** Either
  - **Embedded counts** updated by merging votes, and/or
  - **Normalized vote table:** `(poll_id, voter_npub, option_id, rumor_event_id, created_at)` with a unique constraint on `(poll_id, voter_npub)`.

### Merge rules (one npub, one vote)

- **Ingest** a **vote** rumor **only if** author is in the MLS group (already implied if decryption succeeded).
- **Changing a vote (locked):** **Last vote wins.** Same author, same `poll_id`, multiple **`vote`** rumors → keep **one** effective choice: the one from the **latest** rumor by MLS order / `created_at` (same rule everywhere, including replay).
- **Conflict with local optimistic vote:** Reconcile to **last-write** per author using the same ordering as above.

### Create propagation (**decision: Option A**)

New polls are **not** local-only. The creator **always** publishes a **`create`** rumor on the **#announcements** MLS group. Every member device **ingests** that rumor and **upserts** the poll into the local replica (same `poll_id` for all).

- **Discovery:** Any member opening Polls for that parent can see polls **without** relying on chat paste or out-of-band `poll_id`.
- **Deduplication:** **`poll_id`** is the stable key. **First `create` wins** for metadata (see **Product decisions**); identical **`create`** replay is idempotent.
- **Ordering:** Poll list order in the UI can follow **`created_at`** from the rumor (or replica ingest time if clock skew is handled elsewhere).

Storage location: **SQLite** (already used for messages) with a small **poll replica** module. The current Polls UI `localStorage` layer is a placeholder until this lands.

## Client flow summary

1. **Open Polls** for parent `P`: load from **local replica** keyed by `P`.
2. **Create poll:** send **`create`** to **announcements `groupId`**; **replica** updates from the structured payload; **announcements UI** shows the “new poll” row; optional optimistic state until echo.
3. **Vote / change vote:** build **`vote`** rumor with chosen `option_id`, send to MLS; **optimistic** tally + reconcile on ingest. Repeat **`vote`** to change choice (**last wins**).
4. **Background:** Subscribe/sync MLS for announcements group; on each eligible rumor, **poll handler** updates replica and **increments tallies**; Polls UI subscribes to store updates.
5. **#announcements UI:** **one visible row per `create`**; **no** extra rows for **`vote`**.

## Security and abuse notes

- **Inside the group**, any member can post MLS messages; **poll spam** is possible (POC: permissionless create). Mitigations later: rate limits, caps—**not** required for POC.
- **One vote per human** is **not** guaranteed: one **npub** can be one person or a shared key; that matches your stated “one Nostr key, one vote” threat model.
- **Double voting across devices:** prevented by **author-based** uniqueness, not by `localStorage` alone.
- **Replay:** Replaying vote history must **not** inflate counts: effective vote per `(poll_id, author)` is **one**, determined by **last vote wins** over the full ordered stream (including replays).
- **Malicious option ids:** Clients must validate `option_id` ∈ poll definition before counting.

## Backend / Rust touchpoints (implementation checklist)

- Define rumor JSON schema and Kind choice (30078 vs new constant) in one module; validate in **`rumor`** or **`message`** pipeline.
- MLS send path: either **reuse** generic `message` with structured content or add **`send_dashboard_poll_rumor`** that builds the correct event builder.
- Reception: **`vote`** rumors → tally path only, **not** default announcement lines. **`create`** rumors → replica **and** materialize a **`Message`** (or equivalent) so the feed shows the poll notice.
- SQLite migrations: `dashboard_polls`, `dashboard_poll_votes` (names illustrative).
- Tauri events: emit compact payloads to frontend store for Polls view.

## Frontend touchpoints

- Replace or back **localStorage** polls with **replica store** fed by Tauri events + initial SQLite read.
- **Create / vote** buttons call **invoke** to send MLS rumor, not only `localStorage`.
- Loading and error states for **pending sync**.

## Testing

- Two clients, same squad, same announcements group: create → **both** see the **new poll** line in #announcements **and** the poll in Dashboard → Polls; A votes → B sees tally **without** new announcement lines; A revotes (**last vote wins**) → B sees updated tally; vote spam still **no** feed rows.
- Offline: queue vote, reconnect, reconcile.

## Related docs

- [`docs/messaging/OVERVIEW.md`](../messaging/OVERVIEW.md) — MLS vs DM, Kind 444, rumor path.
- [`docs/nostr/ARCHITECTURE.md`](../nostr/ARCHITECTURE.md) — high-level Nostr usage.
- [`docs/storage-layout/`](../storage-layout/) — SQLite and persistence conventions.

---

*End of plan.*
