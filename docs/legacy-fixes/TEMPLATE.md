# LF-XXX — `short title`

## Symptom (alpha / dev only)

What users or devs saw before the fix.

## Root cause

Brief technical cause.

## What we shipped

- **Permanent (keep after v1):** …
- **Legacy only (candidate to remove):** …

## Code locations

- `path/to/file` — …

## User-facing / relay impact

Nostr, exports, support, etc.

## Removal checklist (before public v1)

- [ ] Confirm no supported install still needs this path.
- [ ] Delete legacy functions / call sites; simplify APIs if they only existed for repair.
- [ ] Update `docs/` references.
- [ ] Update **CATALOG.md** (mark removed or delete row).
- [ ] QA: fresh install + one migrated scenario if keeping a transition window.
