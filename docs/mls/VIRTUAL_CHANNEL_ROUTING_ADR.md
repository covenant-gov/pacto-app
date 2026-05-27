# ADR: Virtual channel routing for single MLS group (squad defaults)

**Status:** Accepted (implementation backlog items follow [`MLS_SINGLE_GROUP_VIRTUAL_CHANNELS_TECH_SPEC.md`](../../ai-docs/gov-core/MLS_SINGLE_GROUP_VIRTUAL_CHANNELS_TECH_SPEC.md)).

**Step 17 decision (Phase G′):** **Option A** — rename wire bucket **`monitor` → `inbox`** everywhere (UI, JSON, SQLite, Rust ingest). No dual-read compatibility for the old slug (pre-alpha greenfield).

**Scope:** Default squad/network conversation scope when **one MLS `groupId`** backs `#announcements`, `#inbox`, and `#polls`. User-created MLS channels that remain separate groups are out of scope unless explicitly migrated later.

**Posture:** Greenfield / pre-release — describe **one** normative contract; do not extend this ADR with alternate routing trees for superseded layouts. See [`.cursor/rules/greenfield-no-legacy.mdc`](../../.cursor/rules/greenfield-no-legacy.mdc).

---

## Context

The MLS virtual-channels spec §4 offered three carrier strategies:

- **A.** JSON-only virtual bucket on serialized payload.
- **B.** Nostr rumor tags only (Rust ingest avoids JSON sniffing).
- **C.** **Hybrid:** tags where the stack already reasons about rumors + JSON for app-shaped payloads.

We need a single normative contract before FE/Tauri work so send paths, ingest, and SQLite agree on **bucket** semantics and **defaults** when metadata is missing.

---

## Decision

Adopt **option C (Hybrid)**:

1. **Optional rumor tag** on MLS-carried events (when the builder allows tags): **`pacto_bucket`** with value exactly one of `announcements` \| `inbox` \| `polls`.  
   - **Purpose:** cheap indexing, Tauri filtering, and consistency with existing tagged rumors (e.g. dashboard poll `d` tag).
2. **Optional JSON field** on JSON-shaped **`content`** strings: **`pacto_virtual_bucket`** (same enum).  
   - **Purpose:** payloads that are already JSON objects (announce envelopes, structured shares); avoids requiring every client to attach tags if the app controls serialization.
3. **Derivation rules** when **both** are absent (see below).

Only one canonical enum is used everywhere (tag value === JSON value).

---

## Allowed values (normative)

| Value | Meaning |
|-------|---------|
| `announcements` | Human-facing chat and member-authored broadcast intent. |
| `inbox` | Automation: treasury/governance announce cards, signer roster visibility rows, other bot-style MLS rows. |
| `polls` | Dashboard poll create/vote structured MLS payloads (and future poll-shaped traffic). |

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

- `pacto_virtual_bucket` **must** be omitted or be one of the three enum strings.
- Producers **should not** duplicate conflicting bucket hints (tag vs JSON); if both are present, **`pacto_bucket` rumor tag wins** over `pacto_virtual_bucket` during ingest normalization (single write path should log if mismatch).

**Formal fragment (JSON Schema–style):**

```json
{
  "type": "object",
  "properties": {
    "pacto_virtual_bucket": {
      "type": "string",
      "enum": ["announcements", "inbox", "polls"]
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
| `pacto_bucket` | `announcements` \| `inbox` \| `polls` | 0 or 1 per event |

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
| 4 | `parseAnnouncement`-style governance/treasury/Safe (and similar **structured announce**) payloads used for automation today | `inbox` |
| 5 | JSON `type` identifies signer roster share (`squad_member_evm_share` family) | `inbox` |
| 6 | Plaintext or JSON without any rule above | `announcements` |

**Rationale for default `announcements`:** safest UX default for unknown content (human-readable traffic); automation paths should **always** set tag or field once virtual routing lands.

**Single MLS stream:** default squad/network traffic uses **one** physical `group_id`; sidebar rows (`#announcements`, `#inbox`, `#polls`) partition that stream via persisted **virtual bucket** metadata and ADR derivation—not separate MLS rooms.

---

## Persistence invariant

Whatever stores `Message` rows must eventually persist a **normalized bucket** (column or sidecar) for squad-default single-group mode so list APIs can filter without re-parsing full history ad hoc. Exact migration is covered by issue **6** in the MLS virtual-channels backlog.

---

## Related documents

- [`ai-docs/gov-core/MLS_SINGLE_GROUP_VIRTUAL_CHANNELS_TECH_SPEC.md`](../../ai-docs/gov-core/MLS_SINGLE_GROUP_VIRTUAL_CHANNELS_TECH_SPEC.md) — program-level spec and executable issues.
- [`ai-docs/gov-core/DASHBOARD_MODPOL_CHANNELS_TECH_SPEC.md`](../../ai-docs/gov-core/DASHBOARD_MODPOL_CHANNELS_TECH_SPEC.md) — product semantics for announcements vs inbox vs polls.
