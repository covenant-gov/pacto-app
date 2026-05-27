# Dashboard polls — MLS sync

Polls for a squad/network parent are **replicated across members** via the parent’s **`#announcements` MLS group**. Each device reads SQLite through Tauri (`list_dashboard_polls`); `localStorage` only caches the signed-in user’s last selected option per poll.

## Wire

- **Kind 30078** rumor with **`d` tag** `pacto_dashboard_poll` and JSON schema **`pacto.dashboard_poll.v1`**.
- **`create`:** visible row in **#announcements** (poll-created card); upserts poll definition in replica. **First create wins** for metadata if the same `poll_id` conflicts.
- **`vote`:** tally only — **no** announcement timeline row. **Last vote wins** per `(poll_id, rumor author npub)`.

## Code touchpoints

| Layer | Location |
|-------|----------|
| Parse / DB / commands | `src-tauri/src/dashboard_poll.rs` |
| Rumor ingest | `src-tauri/src/rumor.rs` (`process_dashboard_poll_rumor`) |
| Virtual bucket | `src-tauri/src/virtual_channel_bucket.rs`, `src/lib/mls/virtual-channel-bucket.ts` |
| UI | `src/components/parent/DashboardPollsPanel.svelte`, `DashboardPollCreatedAnnounceBody.svelte` |
| Send helpers | `src/lib/api/nostr.ts` (`sendDashboardPollCreate`, vote) |

## Manual smoke

Two clients on the same announcements group: create → both see announcement + Polls tab; A votes → B tally updates without new feed lines; A revotes → B sees updated count.

## Related

- [`docs/messaging/OVERVIEW.md`](../messaging/OVERVIEW.md) — MLS vs DM, Kind 444 path
- [`docs/mls/VIRTUAL_CHANNEL_ROUTING_ADR.md`](../mls/VIRTUAL_CHANNEL_ROUTING_ADR.md) — virtual buckets including polls
