---
title: Live Kind 0 refresh
type: feat
date: 2026-11-11
execution: plan-only
depends_on: empty Kind 0 wipe guard (apply_fetched_kind0)
---

# Live Kind 0 refresh

**Do not implement until the empty Kind 0 wipe guard is on the branch.** Fetching more often without that guard wipes stored names.

## Problem

Peers who already have a name/avatar almost never see later Kind 0 updates.

- Live `notifs` in [`src-tauri/src/cmds/relays.rs`](../../src-tauri/src/cmds/relays.rs) subscribe only to gift wraps, MLS 444, and Commons — not Kind 0.
- [`sync_all_profiles`](../../src-tauri/src/profile_sync.rs) queues named profiles as **Low** (5 min delay, 24 h cache).
- Opening a DM calls [`queueProfileSync`](../../src/lib/api/nostr.ts) at default **Medium**, `forceRefresh = false`.
- Frontend [`startProfileLoad`](../../src/stores/profiles.ts) returns immediately when name/display_name/avatar exist. DM/members UI does not call it.
- [`queue_chat_profiles_sync`](../../src-tauri/src/cmds/profile_sync.rs) is orphaned (never invoked from `src/`).
- Named profiles use pooled `client.fetch_metadata` instead of per-relay NIP-01 winner ([`load_profile_metadata`](../../src-tauri/src/profile.rs)).

## Approach

1. **Live subscribe** in `notifs`: Kind 0 for the logged-in pubkey plus known contact pubkeys (or authors from `STATE.profiles`). On event, run the same apply path as fetch (`apply_fetched_kind0`, then `profile_update` + `set_profile`). Refresh the author filter when the contact set changes.
2. **Always per-relay NIP-01** in `load_profile_metadata` — drop the `lacks_metadata` split that uses `fetch_metadata` for named profiles.
3. **Open chat refreshes:** `queueProfileSync(npub, 'high', true)` when opening a DM ([`AuthenticatedApp.svelte`](../../src/components/app/AuthenticatedApp.svelte)). Wire `queue_chat_profiles_sync` when opening an MLS channel; remove it from the orphaned-command baseline once the frontend calls it.
4. **Login:** keep `refreshProfileNow` for self; `sync_all_profiles` should not skip named contacts via a 24 h cache on first session fetch (cache after a successful apply is fine).

## Out of scope

- Friends vs Pending `dm_flags` / `init_finished` race.
- Changing `apply_kind0_replacement` (wipe guard already skips empty over named).

## Tests

- Filter construction includes Kind 0.
- Named-profile fetch uses per-relay winner (unit around the fetch-strategy branch).
- `queueProfileSync` from DM open passes `force_refresh: true`.
- `queue_chat_profiles_sync` is invoked from channel open.
