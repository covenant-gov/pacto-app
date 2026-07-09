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
| `announcements` | Human-facing chat and **squad-wide state** the whole group should see (member roster EVM shares, sponsor deploys, poll created, squad bot metadata / key-rotated notices). |
| `inbox` | **Personal prompts and automation** for the viewing member: treasury/governance cards, Safe proposals, roster setup cards in `#personal-alerts`, bot key rotate prompts. Wire bucket name remains `inbox`. |
| `polls` | Dashboard poll create/vote structured MLS payloads (and future poll-shaped traffic). |
| `join_requests` | Commons join request fan-out and accept/reject state for `#join-requests` (private MLS; see [`../communities/SQUAD_BOT_JOIN.md`](../communities/SQUAD_BOT_JOIN.md)). |

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
| 3 | Payload classified as dashboard poll rumor (existing poll ingest path / `d` tag convention) | `polls` |
| 4 | JSON `schema` is `pacto.squad.join_request.v1` or `pacto.squad.join_request_response.v1` | `join_requests` |
| 5 | `parseAnnouncement`-style governance/treasury/Safe (and similar **structured announce**) payloads used for automation today | `inbox` |
| 6 | JSON `type` identifies **`squad_member_evm_share`** (member published roster EVM address) | `announcements` |
| 7 | JSON `schema` is `pacto.squad_bot.meta.v1` or `pacto.squad_bot.key_rotated.v1` | `announcements` |
| 8 | JSON `schema` is `pacto.squad_bot.rotate_prompt.v1` | `inbox` |
| 9 | Plaintext or JSON without any rule above | `announcements` |

**Rationale for default `announcements`:** safest UX default for unknown content (human-readable traffic); automation paths should **always** set tag or field once virtual routing lands.

**Single MLS stream:** default squad/network traffic uses **one** physical `group_id`; sidebar rows (`#announcements`, `#personal-alerts`, `#polls`, `#join-requests`) partition that stream via persisted **virtual bucket** metadata and ADR derivation—not separate MLS rooms.

---

## Persistence invariant

Whatever stores `Message` rows must eventually persist a **normalized bucket** (column or sidecar) for squad-default single-group mode so list APIs can filter without re-parsing full history ad hoc. Exact migration is covered by issue **6** in the MLS virtual-channels backlog.

---

## Related documents

- This ADR — normative `pacto_bucket` / `pacto_virtual_bucket` contract.
- [`../dashboard/POLLS.md`](../dashboard/POLLS.md) — polls virtual-channel transport.
- [`../communities/SQUAD_BOT_JOIN.md`](../communities/SQUAD_BOT_JOIN.md) — `join_requests` bucket + squad bot wire schemas.
- [`../communities/DESIGN.md`](../communities/DESIGN.md) — hub channel semantics.
