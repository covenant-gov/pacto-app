# ADR: Virtual channel routing for single MLS group (squad defaults)

**Status:** Accepted. Remaining single-group virtual-channel backlog is tracked in this ADR and [`../dashboard/POLLS.md`](../dashboard/POLLS.md) transport notes.

**Inbox bucket rename:** wire bucket **`monitor` → `inbox`** everywhere (UI, JSON, SQLite, Rust ingest). No dual-read compatibility for the old slug (pre-alpha greenfield).

**Scope:** Default squad/network conversation scope when **one MLS `groupId`** backs `#announcements`, `#personal-alerts`, `#polls`, and `#join-requests`. User-created MLS channels that remain separate groups are out of scope unless explicitly migrated later.

**Posture:** Greenfield / pre-release — describe **one** normative contract; do not extend this ADR with alternate routing trees for superseded layouts. See [`.cursor/rules/greenfield-no-legacy.mdc`](../../.cursor/rules/greenfield-no-legacy.mdc).

---

## Context

Three carrier strategies were considered for squad-default MLS groups:

- **A.** JSON-only virtual bucket on serialized payload.
- **B.** Nostr rumor tags only (Rust ingest avoids JSON sniffing).
- **C.** **Hybrid:** tags where the stack already reasons about rumors + JSON for app-shaped payloads.

We need a single normative contract before FE/Tauri work so send paths, ingest, and SQLite agree on **bucket** semantics and **defaults** when metadata is missing.

---

## Decision

Adopt **option C (Hybrid)**:

1. **Optional rumor tag** on MLS-carried events (when the builder allows tags): **`pacto_bucket`** with value exactly one of `announcements` \| `inbox` \| `polls` \| `join_requests`.  
   - **Purpose:** cheap indexing, Tauri filtering, and consistency with existing tagged rumors (e.g. dashboard poll `d` tag).
2. **Optional JSON field** on JSON-shaped **`content`** strings: **`pacto_virtual_bucket`** (same enum).  
   - **Purpose:** payloads that are already JSON objects (announce envelopes, structured shares); avoids requiring every client to attach tags if the app controls serialization.
3. **Derivation rules** when **both** are absent (see below).

Only one canonical enum is used everywhere (tag value === JSON value).

---

## Allowed values (normative)

| Value | Meaning |
|-------|---------|
| `announcements` | Human-facing chat and **squad-wide state** the whole group should see (member roster EVM shares, sponsor deploys, poll created, Join inbox metadata / key-rotated notices). |
| `inbox` | **Personal prompts and automation** for the viewing member: treasury/governance cards, Safe proposals, roster setup cards in `#personal-alerts`, Join inbox rotate prompts. Wire bucket name remains `inbox`. |
| `polls` | Dashboard poll **vote** transport (and future poll-shaped traffic that is not a create card). Poll **creates** use `announcements`. |
| `join_requests` | Commons join request fan-out and accept/reject state for `#join-requests` (private MLS; see [`../communities/JOIN_INBOX.md`](../communities/JOIN_INBOX.md)). |

Future buckets extend this enum in the same ADR (revision) before code assumes open strings.

---

## JSON shape (informal schema)

For any MLS message whose **`content`** is intended to be parsed as JSON (application-specific data, structured announces, shares):

- Root object **may** include:

```json
{
  "pacto_virtual_bucket": "announcements"
}
```

**Constraints:**

- `pacto_virtual_bucket` **must** be omitted or be one of the four enum strings.
- Producers **should not** duplicate conflicting bucket hints (tag vs JSON); if both are present, **`pacto_bucket` rumor tag wins** over `pacto_virtual_bucket` during ingest normalization (single write path should log if mismatch).

**Formal fragment (JSON Schema–style):**

```json
{
  "type": "object",
  "properties": {
    "pacto_virtual_bucket": {
      "type": "string",
      "enum": ["announcements", "inbox", "polls", "join_requests"]
    }
  },
  "additionalProperties": true
}
```

Plaintext MLS messages (no JSON) **do not** carry this field; see derivation.

---

## Rumor tag (normative)

| Tag key | Values | Cardinality |
|---------|--------|-------------|
| `pacto_bucket` | `announcements` \| `inbox` \| `polls` \| `join_requests` | 0 or 1 per event |

If duplicated tags disagree, ingest **must** reject or pick deterministic first value and emit a developer-visible warning (implementation choice documented in PR).

Existing specialized tags (e.g. dashboard poll `d` tag) **continue** to imply bucket through derivation; producers **may** still add `pacto_bucket` for uniformity once send paths are centralized.

---

## Default & derivation when metadata is missing

Apply **first matching rule** (implementations walk top-to-bottom):

| Order | Condition | Resolved bucket |
|-------|-----------|-----------------|
| 1 | Rumor tag `pacto_bucket` present and valid | Tag value |
| 2 | JSON parse succeeds and `pacto_virtual_bucket` valid | Field value |
| 3a | Payload `type` is `dashboard_poll_created` (create card) | `announcements` |
| 3b | Payload classified as dashboard poll **vote** (`d` tag / `pacto.dashboard_poll.v1` vote action) | `polls` |
| 4 | JSON `schema` is `pacto.squad.join_request.v1` or `pacto.squad.join_request_response.v1` | `join_requests` |
| 5 | `parseAnnouncement`-style governance/treasury/Safe (and similar **structured announce**) payloads used for automation today | `inbox` |
| 6 | JSON `type` identifies **`squad_member_evm_share`** (certified roster EVM share) or **`squad_evm_roster_snapshot`** (certified roster gossip) | `announcements` |
| 7 | JSON `schema` is `pacto.squad.join_inbox.meta.v1` or `pacto.squad.join_inbox.key_rotated.v1` | `announcements` |
| 8 | JSON `schema` is `pacto.squad.join_inbox.rotate_prompt.v1` | `inbox` |
| 9 | Plaintext or JSON without any rule above | `announcements` |

**Rationale for default `announcements`:** safest UX default for unknown content (human-readable traffic); automation paths should **always** set tag or field once virtual routing lands.

**Single MLS stream:** default squad/network traffic uses **one** physical `group_id`. Sidebar UI rows are `#squad-dashboard`, `#announcements`, `#polls`, and `#settings` (dashboards and settings are virtual; announcements/polls share the MLS stream). Buckets `inbox` and `join_requests` remain for transport and are surfaced inside `#settings` (username-mode Alerts / Squad-mode Join requests), not as dedicated channels.

---

## Persistence invariant

Whatever stores `Message` rows must eventually persist a **normalized bucket** (column or sidecar) for squad-default single-group mode so list APIs can filter without re-parsing full history ad hoc. Exact migration is covered by issue **6** in the MLS virtual-channels backlog.

---

## Side-effect ingest gate

SQLite applicators for structured announces (`governance_updated`, `squad_safe_updated`, allowlist, tracked tokens, etc.) run from `apply_mls_virtual_bucket_side_effects` after bucket derivation.

**Author gate:** the MLS message author must be treated as a **member** of the announcements group (`is_author_mls_member_for_chat`) — not restricted to the MLS group creator. Publish-time product ACL (Captain / bot holder) stays on the write path; peers must not silently drop announces that a member was allowed to send.

**Parent id:** payload `parent_id` / `squad_id` must equal the MLS `chat_id` (announcements group id).

---

## Squad group records (`d`-tagged Kind 30078)

Squad-wide records ride the announcements group as **Kind 30078** rumors selected by their **`d` tag**, the same way dashboard polls use `pacto_dashboard_poll`. They also carry a `parent` tag with the squad/network `parent_id`.

| `d` tag | Status | Content schema |
|---------|--------|----------------|
| `pacto_squad_content_policy` | Active | `pacto.squad_content_policy.v1` — admin-only add restrictions (`restrict_event_create`, `restrict_doc_add`), each with its own `*_updated_at_ms`; per-flag last timestamp wins |
| `pacto_squad_event` | Active | `pacto.squad_event.v1` — squad events and RSVPs (see below) |

The name `pacto_squad_doc` is reserved for a future squad docs shelf; no code sends or reads it yet.

**Group gate:** a record is accepted only when the payload `parent_id` equals the MLS group it arrived in (a parent's id is its announcements group id), the same check as the side-effect ingest gate above. Records naming another parent are dropped on ingest, and send commands reject a mismatched `mls_group_id` with `squad_records_wrong_group`.

**Silent operations** (policy changes, event updates, RSVPs, cancels) return the silent ingest result (`SquadRecordSilent`, same handling as a poll vote): they update the SQLite replica and never create a timeline row. They need no `pacto_bucket` tag and **do not** extend the bucket enum — there is no `events` or `docs` bucket. Record ops that announce something (for example an event-created card) are stored as `announcements` messages like a poll create.

Feature shelves such as `#events` (and a future docs shelf) are hub rows that read their SQLite replica through Tauri, the same way `#polls` reads the poll replica. They are not virtual buckets of the MLS stream.

**Admin gate:** policy writes are accepted only from members in the group's MLS `admin_pubkeys`; non-admin policy rumors are dropped on ingest. Turning `restrict_event_create` on deletes non-admin events created at or after the flag timestamp; turning it off restores nothing.

### Squad events (`pacto_squad_event`)

- **Wire:** `{"schema":"pacto.squad_event.v1","op":…}` with `op` one of `create`, `update`, `rsvp`, `cancel`, `series_card`. Event fields use NIP-52 names (`kind` 31922 all-day / 31923 timed, `title`, `summary`, `start`, `end`, `start_tzid`, `location`) plus `id`, `parent_id`, `series_id`, `place`, `status`, `channel_id`, `updated_at_ms`. The rumor kind stays 30078; NIP-52 kinds only appear inside the encrypted payload.
- **Cards:** a `create` outside a series becomes an `announcements` message `{"type":"squad_event_created","payload":{…}}`; a weekly series sends its creates plus one `series_card` that becomes `{"type":"squad_event_series_created","payload":{…}}`. Card payloads never contain `location` or place details.
- **Silent:** `update`, `rsvp`, `cancel`, and series member creates update the replica only. Writes are last-`updated_at_ms`-wins per event (equal keeps the stored row), and children that arrive before their create wait in a pending-ops table.
- **Reminders:** local only. Lead time and mute are per-device prefs and never go on the wire. Reminders that come due while the app is not running are written to Catch up with kind `event_reminder` (`source_event_id` = `"{event_id}:{fire_at_ms}"`, `chat_id` = the announcements group).

---

## Related documents

- This ADR — normative `pacto_bucket` / `pacto_virtual_bucket` contract.
- [`../plans/2026-11-04-0208-feat-squad-group-records-plan.md`](../plans/2026-11-04-0208-feat-squad-group-records-plan.md) — squad group records and content policy.
- [`../dashboard/POLLS.md`](../dashboard/POLLS.md) — polls virtual-channel transport.
- [`../communities/JOIN_INBOX.md`](../communities/JOIN_INBOX.md) — `join_requests` bucket + Join inbox wire schemas.
- [`../communities/DESIGN.md`](../communities/DESIGN.md) — hub channel semantics.
