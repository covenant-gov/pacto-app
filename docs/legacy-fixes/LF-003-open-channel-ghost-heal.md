# LF-003 — open-channel ghost sidebar heal

## Symptom (alpha / dev only)

Late joiners saw an open custom channel in the sidebar before this device accepted its MLS Welcome: empty Members, messages that showed Sending… then vanished, and Catch up offering the channel Welcome as a new squad.

## Root cause

The channel catalog (`squad_channels_catalog`) used to insert sidebar rows directly, ahead of the Welcome accept.

## What we shipped

- **Permanent (keep after v1):** the catalog is a join list. Wanted rows live in `pending-open-channel-joins.ts`; the sidebar row is attached only after Welcome accept (or when the device already has the MLS group).
- **Legacy only (candidate to remove):** the ghost loop in `drainTargets` that treats already-local open channels as drain targets, so a pre-fix ghost row is healed when its Welcome is still pending.

## Code locations

- `src/lib/squad/open-channel-join.ts` — `drainTargets` ghost loop; `completeOpenChannelJoin` attach-when-joined branch for local rows.

## User-facing / relay impact

None on the wire. Without the heal, a pre-fix ghost row stays until the user is restored or rejoined.

## Removal checklist (before public v1)

- [ ] Confirm no supported install still carries pre-fix ghost rows.
- [ ] Delete the ghost loop in `drainTargets`; drain wanted rows only.
- [ ] Drop the ghost sentence in `docs/communities/DESIGN.md`.
- [ ] Update **CATALOG.md** (delete row).
- [ ] QA: fresh install, Commons late join into a squad with an open custom channel.
