---
title: Long-lived Session Recovery - Plan
type: fix
date: 2026-07-29
topic: long-lived-session-recovery
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
deepened: 2026-07-29
---

# Long-lived Session Recovery

## Goal Capsule

- **Objective:** Make a long-lived Pacto desktop session recover missed GiftWrap/DM traffic without a full restart, and make the sync status surface tell the truth about whether the client is actually caught up.
- **Product authority:** `STRATEGY.md` "Private group coordination" track. Reliable long-session behavior is a prerequisite for squads/DAOs that leave the app running for days.
- **Execution profile:** Code change across backend (Tauri Rust) and frontend (Svelte). No new external dependencies expected.
- **Stop conditions / open blockers:** None. All blocking product decisions were settled in the originating conversation.
- **Tail ownership:** The requirements here cover the catch-up mechanism, trigger policy, and status surface. The 181 MLS seed-restore credential limitation and the 139-C poll bucket bug are explicitly out of scope and tracked separately.

---

## Product Contract

### Summary

Move DM/GiftWrap catch-up out of the frontend lifecycle and into a backend-owned process that fetches a bounded recent window on wake, reconnect, or periodic check. Expose a manual deep-rescan affordance with a cost warning, and make `dmSyncStatus` report `idle`, `syncing`, `finished`, `behind`, or `stalled` instead of pretending "terminated" means "up to date."

### Problem Frame

Pacto's initial sync walks gift-wrap history backward in 2-day slices and then sets the sync state machine to `Finished`. Once `Finished`, every call to `fetch_messages(false)` returns before issuing any relay query (`src-tauri/src/lib.rs:877-886`). That means DMs arrive only through the live `notifs()` subscription. If that subscription misses a push — because the laptop slept, a relay disconnected, or the socket died — the event is unreachable until the app restarts.

Issue #181 overlaps on the symptom but not the root cause: after a seed restore the MLS device identity is genuinely gone (random `device_id`, local-only ratchet state), so squads can never be recovered by sync. But both #139 and #181 hide behind the same misleading green sync dot, because `sync_finished` currently means "the walk terminated," not "you are caught up."

### Key Decisions

- KD1. **Backend owns continuous catch-up.** The frontend's wake/focus/resume handlers become thin triggers; the backend process owns scheduling, window selection, and relay traffic policy. (session-settled: user-approved — chosen over frontend-driven to fix the macOS `resume` gap and to make the existing `Connected` reconnect catch-up actually do something.)
- KD2. **Users see when they are behind.** Recovery is not silent: the sync-status dot can display `behind` or `stalled` and offer a path to act. (session-settled: user-directed — chose truthful status over silent auto-recovery.)
- KD3. **Deep rescan is manual and warned.** The existing `deep_rescan` command is surfaced only by explicit user action with cost copy; it is never auto-triggered. (session-settled: user-approved — avoids surprise large downloads from relays.)
- KD4. **Conservative relay health policy by default.** The 15s health loop stops force-disconnecting relays on empty or slow Metadata probes; it records metrics/logs and only attempts reconnect when a relay is actually `Terminated`. No new global settings toggle is added. (Governs R11.)
- KD5. **Startup parity for `createAccount`.** Fresh account creation must run the same post-login network sync as `unlockWithPin` and `importAccount`, so the relay monitor starts in the first session. (Governs R10.)

### How This Work Fits Together

<!-- ce-section: work-relationships -->

This plan owns **session-level recovery for GiftWrap/DM traffic and sync-status honesty**. The broader #139/#181 space is understood as:

- **#139-C inbound poll bucket bug:** Can proceed independently. The fix changes `src-tauri/src/rumor.rs:701` from `virtual_bucket: "polls"` to the canonical `announcements` bucket. It is not part of this work unit because it is a permanent message-routing bug, not a session-recovery gap.
- **#181 MLS seed-restore credential limitation:** Outside this plan. Restoring from seed cannot recover a random `device_id` or local-only MLS ratchet state. This plan only addresses the shared symptom: the sync-status surface must not falsely imply recovery is complete.

### Requirements

#### Catch-up mechanism

- R1. Recent-window DM/GiftWrap catch-up runs as a backend process, not as a frontend lifecycle trigger. The backend owns scheduling, window selection, and relay traffic policy.
- R2. The recent-window fetch is bounded. It fetches only events newer than the last successful catch-up, capped at a maximum lookback no larger than the initial login window (2 days).
- R3. A single in-flight guard prevents concurrent catch-up, deep rescan, and login sync from overlapping. Rapid focus flickers must not spawn parallel fetches.
- R4. Catch-up reuses the existing progress/finished event surface (`sync_progress`, `sync_slice_finished`, `sync_finished`) so the current `dmSyncStatus` pipeline can consume it.
- R12. Relay reconnect catch-up on `Connected` must use the real recent-window fetch, replacing the current no-op path that returns immediately because `sync_mode == Finished`.

#### User-controlled deep rescan

- R5. Manual deep rescan is available only through explicit user action with a cost warning. It is never auto-triggered, including after prolonged sleep or disconnect.
- R6. The manual deep rescan reuses the existing `deep_rescan` command behavior: 2-day slices backward until 15 consecutive empty slices (approximately 30 days of silence).
- R8. The status affordance that shows `behind` or `stalled` also hosts the path to the manual deep-rescan action, so the signal and the control live together.

#### Sync-status truth

- R7. `dmSyncStatus` supports at least these states: `idle`, `syncing`, `finished`, `behind`, `stalled`. `finished` retains its current meaning; new states carry the real recovery signal.
- R9. The frontend's `focus`, `visibilitychange`, and `resume` handlers request catch-up from the backend with a debounce, but they do not schedule windows or select relay queries.
- R10. `createAccount` starts the same post-login network sync as `unlockWithPin` and `importAccount`, so `monitorRelayConnections` begins in the first session.

#### Relay health and reconnect policy

- R11. The 15s relay health loop stops force-disconnecting relays on empty or slow Metadata responses. It records `ping_ms`, `last_check`, and logs, and attempts reconnect only when a relay is actually `Terminated`. (Governs KD4.)

### Key Flows

- F1. **Wake catch-up**
  - **Trigger:** `window.focus`, `document.visibilitychange` (visible), or `document.resume` fires.
  - **Frontend:** Debounced request to backend catch-up process.
  - **Backend:** Checks in-flight guard; fetches bounded recent window; emits `sync_progress` / `sync_slice_finished` / `sync_finished`.
  - **UI:** `dmSyncStatus` moves through `syncing` → `finished` → `idle`, or to `behind`/`stalled` on failure.
  - **Covered by:** R1, R2, R3, R4, R7, R9.

- F2. **Relay reconnect catch-up**
  - **Trigger:** `monitor_relay_connections` sees `RelayStatus::Connected`.
  - **Backend:** Uses the same recent-window process for that relay, instead of the current no-op `fetch_messages(false, Some(url))`.
  - **UI:** No change on success; transitions to `behind` or `stalled` if the fetch fails.
  - **Covered by:** R1, R2, R12, R7.

- F3. **Manual deep rescan**
  - **Trigger:** User sees `behind`/`stalled` dot and opens the status affordance.
  - **Frontend:** Shows cost warning; on confirmation, invokes the existing `deep_rescan` command.
  - **Backend:** Resets `sync_mode` to `DeepRescan`, fetches 2-day slices backward until 15 empty slices.
  - **UI:** `dmSyncStatus` shows `syncing` with progress; returns to `finished` → `idle` or `stalled`.
  - **Covered by:** R5, R6, R8.

### Acceptance Examples

- AE1. **Missed DM on reconnect.** The app is left open, the network drops for an hour, then reconnects. A DM that arrived while offline appears without quitting the app. (Covers R1-R4, R12.)
- AE2. **Rapid focus flickers.** The user alt-tabs rapidly for 10 seconds. Only one catch-up fetch runs; no parallel syncs are spawned. (Covers R3, R9.)
- AE3. **Manual deep rescan.** After a seed restore, the user sees the `behind` dot, opens the status menu, confirms the cost warning, and older messages load over the next minute. (Covers R5, R6, R8.)
- AE4. **Fresh account gets a monitor.** A user creates a new account; the relay health monitor starts in the first session, not after the next unlock. (Covers R10.)
- AE5. **Flaky relay not thrashed.** A public relay returns an empty Metadata probe in 2 seconds and stays connected; the health loop logs the event but does not force-disconnect and reconnect it. (Covers R11.)
- AE6. **Stalled state surfaces.** A relay is `Disconnected` for 5 minutes and no catch-up succeeds; the sync dot shows `stalled` with a tooltip instead of a green `finished` dot. (Covers R7, R8.)

### Scope Boundaries

- **Deferred for later:**
  - Full `notifs()` restart-on-death redesign.
  - Per-channel auto-sync on every channel click.
  - Vote-before-create retry queue.
  - Peer `squad_state_sync_request` changes.
  - Changing SDK `reconnect(false)` globally beyond enabling the existing monitor.
- **Outside this product's identity / tracked separately:**
  - #181 root cause: MLS device identity (`device_id`) and ratchet state are not seed-derivable. This plan only addresses the misleading status signal.
  - #139-C: inbound poll `virtual_bucket` routing bug (`src-tauri/src/rumor.rs:701` hardcodes `"polls"` instead of `"announcements"`).

### Dependencies / Assumptions

- The existing `fetch_messages` state machine can be extended (or a new backend command added) without breaking the login-time init sync path.
- `dmSyncStatus` consumers can tolerate new states without breaking; the dead `stalled={false}` hardcodes at both callsites must be removed.
- The relay metrics/logs already captured (`RelayMetrics`, `RelayLog`) are sufficient to validate health-loop behavior changes.

### Outstanding Questions

- **Resolved during planning:**
  - Catch-up is implemented by extending `fetch_messages` with a bounded recent-window mode, reusing the existing state machine and event pipeline (R1, R4).
  - `behind`/`stalled` detection is derived on the frontend from existing events plus relay status; no new backend event is introduced (R7, R9).
  - Maximum lookback for recent catch-up is the same 2-day window used for login init and reconnect (R2).
  - Frontend wake trigger debounce is 50 ms, matching the existing session-focus debounce in `src/stores/auth.ts` (R9).
- **Deferred to implementation:**
  - Exact field shape of the new `catch_up` command payload (if a separate command is chosen over extending `fetch_messages`).
  - Whether `behind` is cleared automatically on the next successful catch-up or requires an explicit user dismiss (lean toward auto-clear).
  - Whether stall detection should also consider a per-slice timeout (60 s account-wide, 30 s single-relay) or only relay-status + last-success timestamp.

### Sources / Research

- GitHub issue #139: "App-wide: long-lived sessions miss Nostr/MLS events until restart."
- GitHub issue #181: "Squads never reappear after seed restore / DB deletion — MLS device identity isn't seed-derived."
- `src-tauri/src/lib.rs:807-886` — `sync_mode` is set to `Finished` after login and every subsequent `fetch_messages(false)` returns before fetching.
- `src-tauri/src/lib.rs:5092-5112` — existing `deep_rescan` command, unused from the frontend.
- `src-tauri/src/lib.rs:3891-4088` — `monitor_relay_connections` health/reconnect loops.
- `docs/messaging/SYNC_STATUS.md` — current `dmSyncStatus` contract and its known limits.
- `docs/solutions/logic-errors/orphaned-relay-health-monitor-command.md` — prior fix that wired the relay monitor, leaving reconnect catch-up as a no-op.
- `src/lib/app/post-login-sync.ts` and `src/stores/auth.ts` — post-login sync entry points; `createAccount` omits the call.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Extend `fetch_messages` rather than add a separate catch-up command.** The state machine already has an in-flight guard, progress events, and single-relay support. Adding a distinct command would duplicate the guard and event semantics. The trade-off is that `fetch_messages` must distinguish login-init, wake catch-up, and reconnect catch-up by call-site behavior, not just by `init` and `relay_url` flags. (session-settled: user-approved — instantiates KD1.)
- KTD2. **Recent-window catch-up is bounded to 2 days.** The backend records the end timestamp of the most recent successful catch-up window and only fetches from that point forward, capped at `now - 2 days`. This matches the login init window and keeps reconnect catch-up cheap. (Derived from R2.)
- KTD3. **Stall detection lives on the frontend.** The frontend already tracks relay status via `relay_status_change` and sync events. Deriving `behind`/`stalled` there avoids a new backend event and keeps the Rust change focused on fetch behavior. The trade-off is that the stall predicate is owned by UI code and must be tested there. (Derived from R7, R9, and KD1.)
- KTD4. **Keep the existing `deep_rescan` command unchanged; surface it from the status dot.** The command already resets `SyncMode::DeepRescan` and emits the standard event pipeline. The only new work is a frontend affordance that shows a cost warning and invokes the wrapper. (session-settled: user-approved — instantiates KD3.)
- KTD5. **Conservative health loop: log slow/empty probes, reconnect only on `Terminated`.** Remove the force-disconnect/reconnect branch for empty or slow Metadata probes in the 15 s loop. Keep the `ping_ms`/`last_check` recording path. The terminated-relay polling task (every 5 s) already handles actual disconnects. (session-settled: user-approved — instantiates KD4.)

### High-Level Technical Design

The existing sync architecture has three layers: the Rust `ChatState` machine, the Tauri event bus, and the Svelte `dmSyncStatus` store. The plan changes each layer minimally:

```mermaid
flowchart TB
  subgraph Frontend
    A[window focus / visibilitychange / resume] -->|debounce 50 ms| B(invoke fetch_messages catch-up)
    C[relay_status_change] --> D[relay status store]
    E[sync_progress / sync_slice_finished / sync_finished] --> F[dmSyncStatus store]
    D --> G[behind / stalled predicate]
    F --> G
    G --> H[SyncStatusIndicator + deep-rescan affordance]
  end

  subgraph Rust
    I[fetch_messages init=false relay_url=None] --> J{in-flight?}
    J -->|no| K[mode=CatchUp window=last_success..now capped at 2d]
    K --> L[fetch + emit sync_progress]
    L -->|more windows| M[emit sync_slice_finished]
    M -->|frontend re-invokes| I
    L -->|done| N[emit sync_finished update last_success]
    O[Connected in monitor_relay_connections] --> P[fetch_messages false Some(url)]
    P -->|currently no-op| Q[Replace with bounded recent-window single-relay fetch]
  end
```

The state machine gains a new mode `CatchUp` (or equivalent internal flag) that walks forward from `last_catch_up_until` to `now` in 2-day slices. When the window reaches `now` it transitions to `Finished` and emits `sync_finished`.

### Assumptions

- Recent-window catch-up can reuse the existing `sync_slice_finished` / `fetch_messages(false)` loop because the frontend already drives iteration that way for init sync.
- `last_catch_up_until` can be stored in `ChatState` in memory; it does not need to persist across app restarts because login init already covers the last 2 days on cold start.
- The frontend wake trigger does not need to detect whether the app actually lost connectivity; it simply asks the backend to catch up on every focus/visibility/resume.

### System-Wide Impact

- **Sync event contract.** The existing `sync_progress`/`sync_slice_finished`/`sync_finished` event shapes do not change, but their frequency changes: `sync_slice_finished` may fire outside the initial login walk whenever the app wakes. Any component that assumes these events only happen once per session must be re-examined; the current `tauri-subscriptions.ts` handler already treats them as a continuing loop, so no change is expected elsewhere.
- **Relay health behavior.** Changing the 15 s loop from aggressive reconnect to logging-only alters how quickly a flaky relay is visibly recovered. The separate 5 s `Terminated` polling task becomes the only automatic recovery path; this is intentional but shifts the operational meaning of `last_check`/`ping_ms` from "healthy because we reconnected it" to "we measured it and left it alone."
- **Auth lifecycle parity.** Calling `runPostLoginNetworkSync` from `createAccount` means the relay monitor and initial sync start before the user lands in the main shell. `+page.svelte` must guard against redundant `fetchMessages(true)` calls to avoid two overlapping init syncs.
- **Status surface truth.** Adding `behind`/`stalled` to `dmSyncStatus` changes the visual state users see in every channel and DM header. The component already supports `stalled` as a prop, but the hardcoded `false` at both callsites must be removed or bound to the computed predicate.

### Risks & Dependencies

- **Regression in login init sync.** Extending `fetch_messages` with a new mode touches the path that runs on every unlock/import/account creation. If the `CatchUp` entry condition is wrong, a fresh login could skip the historical backfill or enter an infinite loop. Mitigation: unit-test mode transitions with in-memory state and run the full login e2e path before landing.
- **Thundering herd on wake.** Multiple rapid focus/visibility/resume events could still produce bursts if the 50 ms debounce or the `is_syncing` guard has a race. Mitigation: the backend guard is the source of truth; the frontend debounce and `dmSyncStatus` suppression are only coalescing helpers.
- **Stall predicate false positives.** A relay that is intentionally disconnected (e.g., user disabled it) should not show `stalled`. Mitigation: the stall predicate only considers relays that are enabled in the user's relay list and have been in `disconnected`/`terminated` long enough.
- **Documentation drift.** `docs/messaging/SYNC_STATUS.md` is the authoritative contract for the dot; it must be updated before this work ships or the next implementer will re-discover the dead `stalled` hardcodes. U7 owns the doc update.

---

## Implementation Units

### U1. Extend `SyncMode` and `fetch_messages` for bounded recent-window catch-up

- **Goal:** Make `fetch_messages(false)` do real work again for account-wide catch-up by adding a bounded recent-window mode that stops when it reaches the present.
- **Requirements:** R1, R2, R3, R4.
- **Dependencies:** None.
- **Files:**
  - `src-tauri/src/lib.rs` — `SyncMode` enum, `ChatState`, `fetch_messages` entry guard and window logic.
  - `src-tauri/src/lib.rs` — `fetch_messages` completion logic and mode transitions.
- **Approach:**
  1. Add `CatchUp` to `SyncMode` and a `last_catch_up_until: u64` field to `ChatState`.
  2. At the end of a successful account-wide sync (init or deep rescan), set `last_catch_up_until = now`.
  3. Change the `Finished` early-return in `fetch_messages` so that, when `relay_url.is_none()`, it checks whether `last_catch_up_until` is older than a small grace window (e.g., 60 s). If so, enter `CatchUp` instead of returning.
  4. Implement the `CatchUp` window calculation: `since = last_catch_up_until - small_overlap`, `until = min(now, since + 2 days)`. Advance forward until `until >= now`, then transition to `Finished`.
  5. Keep the existing in-flight guard and event emission shape; only emit events when `relay_url.is_none()`.
- **Patterns to follow:** The existing `ForwardSync`/`BackwardSync`/`DeepRescan` window math in `fetch_messages` (`src-tauri/src/lib.rs:807-886`).
- **Test scenarios:**
  - Covers AE1. When `last_catch_up_until` is 1 hour ago, `fetch_messages(false)` fetches a 2-day window ending at `now` and stops at `now`.
  - When `last_catch_up_until` is within 60 s of `now`, `fetch_messages(false)` returns immediately and emits `sync_finished` without network traffic.
  - When a fetch is already in flight, a second `fetch_messages(false)` returns immediately without spawning a parallel window.
  - Edge case: `CatchUp` advances forward one 2-day slice at a time and emits `sync_slice_finished` between slices.
  - Error path: a failed Nostr query still resets `is_syncing` and transitions to `Finished`, but does not advance `last_catch_up_until`.
- **Verification:** Backend unit test exercises the new mode transitions with mocked or in-memory state; `cargo test --lib` passes.

### U2. Replace the no-op single-relay reconnect catch-up

- **Goal:** When `monitor_relay_connections` sees `Connected`, run a real bounded recent-window fetch against that relay instead of the current `fetch_messages(false, Some(url))` that exits because `sync_mode == Finished`.
- **Requirements:** R12, R1, R2.
- **Dependencies:** U1 (bounded recent-window logic must exist).
- **Files:**
  - `src-tauri/src/lib.rs` — `monitor_relay_connections` `Connected` branch.
- **Approach:**
  1. In the `Connected` branch, bypass the global `SyncMode::Finished` check by invoking a single-relay catch-up path.
  2. If U1's `fetch_messages` cannot cleanly support "single relay + bounded recent window + silent" because events are only emitted for account-wide synces, add an internal helper `catch_up_relay(url)` that builds the same filter but targets one relay and does not touch `ChatState.sync_mode`.
  3. Use the same 2-day cap from `last_catch_up_until` (or `now - 2 days` if no prior catch-up is recorded).
- **Patterns to follow:** The existing `fetch_messages(false, Some(url))` call site in `monitor_relay_connections`.
- **Test scenarios:**
  - Covers AE1. A `Connected` notification triggers a single-relay fetch for the last 2 days.
  - The single-relay fetch does not mutate `ChatState.sync_mode` or emit account-wide `sync_*` events.
  - Rapid reconnects do not spawn overlapping single-relay fetches (use the existing `is_syncing` guard or a relay-scoped guard).
- **Verification:** A Rust unit test simulates the `Connected` branch and asserts the targeted relay query is issued.

### U3. Add debounced frontend wake/resume trigger

- **Goal:** The frontend requests catch-up whenever the app regains focus or wakes, without scheduling windows or selecting relay queries.
- **Requirements:** R9, R3.
- **Dependencies:** U1.
- **Files:**
  - `src/lib/app/wake-sync.ts` (new) — `requestCatchUp()` and `installWakeSyncHandlers()`.
  - `src/lib/app/tauri-subscriptions.ts` — call `installWakeSyncHandlers()` during `subscribeAppEvents`.
  - `src/lib/api/nostr.ts` — typed wrapper `fetchMessagesCatchUp()` if a distinct command is needed; otherwise reuse `fetchMessages(false)`.
- **Approach:**
  1. Create a small module that listens to `focus`, `visibilitychange` (when `document.visibilityState === 'visible'`), and `resume` (document lifecycle) events.
  2. Debounce the handler at 50 ms, matching `src/stores/auth.ts:FOCUS_CHECK_DEBOUNCE_MS`.
  3. On trigger, call `fetchMessages(false)` (or the new catch-up wrapper). The backend decides whether there is a gap to fill.
  4. Ignore triggers while `dmSyncStatus` is `syncing` or `deep_rescan` is active to reduce noise.
- **Patterns to follow:** `initSessionFocusChecks` in `src/stores/auth.ts` for debounce pattern and cleanup; `monitorRelayConnections` invocation in `src/lib/app/post-login-sync.ts`.
- **Test scenarios:**
  - Covers AE2. Three rapid focus events within 100 ms result in exactly one `fetchMessages(false)` invoke.
  - Covers AE2. A focus event while `dmSyncStatus` is `syncing` is ignored.
  - A `visibilitychange` to visible invokes catch-up once.
  - The handlers are removed on `subscribeAppEvents` cleanup.
- **Verification:** Unit test in `src/lib/app/wake-sync.test.ts` mocks `fetchMessages` and the event targets; `pnpm test` passes.

### U4. Make `dmSyncStatus` truthful: `behind`, `stalled`, and deep-rescan affordance

- **Goal:** Remove the dead `stalled={false}` hardcodes, extend the store with `behind` and `stalled` states, and surface a manual deep-rescan control from the status dot.
- **Requirements:** R7, R8.
- **Dependencies:** U3 (wake trigger) and U1/U2 (catch-up success/failure signal) and existing `deep_rescan` command.
- **Files:**
  - `src/stores/dm.ts` — extend `SyncStatus` type and add derived/computed stores for `behind`/`stalled`.
  - `src/components/dm/SyncStatusIndicator.svelte` — bind `stalled` from a derived store; render clickable affordance when state is `behind`/`stalled`.
  - `src/components/channel/ChatView.svelte` and `src/components/dm/DmThread.svelte` — stop hardcoding `stalled={false}`.
  - `src/lib/i18n/locales/en/messaging.json` and `es/messaging.json` — add `messaging.syncStatus.behind` and update labels as needed.
- **Approach:**
  1. Extend `SyncStatus` to `'idle' | 'syncing' | 'finished' | 'behind' | 'stalled'`.
  2. Add `lastCatchUpSuccess: number | null` and `relayStatusByUrl: Record<string, RelayStatus>` to the store surface.
  3. Compute `behind` when `lastCatchUpSuccess` is older than a threshold (e.g., 5 minutes) and no sync is in progress.
  4. Compute `stalled` when any tracked relay is `disconnected` or `terminated` for longer than a threshold (e.g., 5 minutes) and catch-up has not succeeded in that window.
  5. When the dot is `behind`/`stalled`, make it a button/menu that shows a cost warning and, on confirmation, invokes the existing `deep_rescan` wrapper.
  6. Clear `behind`/`stalled` on the next successful `sync_finished`.
- **Patterns to follow:** Existing `dmSyncStatus` transitions in `src/lib/app/tauri-subscriptions.ts`; derived store pattern in `src/stores/dm.ts`; `SyncStatusIndicator` tests in `src/components/dm/SyncStatusIndicator.test.ts`.
- **Test scenarios:**
  - Covers AE3. Clicking the `behind` dot opens the deep-rescan confirmation; confirming invokes `deep_rescan`.
  - Covers AE6. A relay status of `disconnected` for 5 minutes and no catch-up success moves the dot to `stalled`.
  - When a catch-up succeeds, `behind`/`stalled` transitions back to `finished` then `idle`.
  - `SyncStatusIndicator` renders no dot for `idle`; colored dots for `syncing`, `finished`, `behind`, `stalled`.
  - The component keeps the live region and tooltip accessible for all states.
- **Verification:** Component and store tests pass; Tauri MCP smoke test confirms the dot renders and the deep-rescan confirmation opens.

### U5. Wire `createAccount` to `runPostLoginNetworkSync`

- **Goal:** Fresh account creation runs the same post-login network sync as unlock and import, so the relay health monitor and initial sync start immediately.
- **Requirements:** R10.
- **Dependencies:** None.
- **Files:**
  - `src/stores/auth.ts` — `createAccount` function.
  - `src/lib/app/post-login-sync.ts` — already calls `monitorRelayConnections`; no change required beyond ensuring it is safe to call before `+page` mount.
- **Approach:**
  1. After `loadAccountState(npub)` and before setting `isAuthenticated = true` (or immediately after), call `runPostLoginNetworkSync(npub)`.
  2. Remove or update the comment that says `fetchMessages will run from +page onMount`.
  3. Ensure `+page.svelte` does not call `fetchMessages(true)` redundantly when `createAccount` has already started it.
- **Patterns to follow:** `importAccount` and `unlockWithPin` in `src/stores/auth.ts`, which already call `runPostLoginNetworkSync(npub)`.
- **Test scenarios:**
  - Covers AE4. `createAccount` invokes `runPostLoginNetworkSync` with the new npub.
  - `createAccount` followed by `+page` mount does not trigger two overlapping init syncs.
  - Failure path: if `runPostLoginNetworkSync` throws, account creation still completes and the error is logged (fire-and-forget).
- **Verification:** Unit test in `src/stores/auth.test.ts` mocks `runPostLoginNetworkSync` and asserts it is called.

### U6. Soften the relay health loop to conservative reconnect policy

- **Goal:** Stop the 15 s health loop from force-disconnecting relays on empty or slow Metadata probes; only reconnect when a relay is `Terminated`.
- **Requirements:** R11, KD4.
- **Dependencies:** None.
- **Files:**
  - `src-tauri/src/lib.rs` — health check task inside `monitor_relay_connections`.
- **Approach:**
  1. In the 15 s loop, remove the branch that pushes relays to `unhealthy_relays` for empty or slow Metadata responses.
  2. Keep recording `ping_ms`/`last_check` and keep `add_relay_log` warnings.
  3. Keep the existing `Terminated`/`Disconnected` branch that adds relays to the reconnect list.
  4. Confirm the separate 5 s terminated-relay polling task is sufficient for actual disconnects; document in code comments.
- **Patterns to follow:** Existing `monitor_relay_connections` health loop and the prior learning in `docs/solutions/logic-errors/orphaned-relay-health-monitor-command.md`.
- **Test scenarios:**
  - Covers AE5. A `Connected` relay returning an empty Metadata probe in 2 s stays `Connected`; `ping_ms` and `last_check` are recorded.
  - A `Connected` relay with a 3 s Metadata timeout stays `Connected` and is logged, not force-disconnected.
  - A `Terminated` relay is still added to the reconnect list and `try_connect` is attempted.
- **Verification:** Rust unit test or Tauri MCP observation confirms no force-disconnect for slow/empty probes; health metrics are still recorded.

### U7. Update docs and orphaned-command ratchet

- **Goal:** Keep `docs/messaging/SYNC_STATUS.md` accurate and ensure any new command string introduced by the plan has a frontend caller.
- **Requirements:** R4, R7, R9.
- **Dependencies:** U3 (if a new command is added), U4.
- **Files:**
  - `docs/messaging/SYNC_STATUS.md` — update state diagram and state descriptions for `behind`/`stalled`.
  - `scripts/orphaned-tauri-commands-baseline.txt` — only if a new command must be grandfathered; otherwise no change.
  - `AGENTS.md` — if the catch-up command surface teaches a new process lesson, add a brief note.
- **Approach:**
  1. Update `SYNC_STATUS.md` to describe the five states and the catch-up/deep-rescan flows.
  2. If a new backend command is added (e.g., `fetch_messages_catch_up`), ensure a frontend `invoke()` wrapper exists and is called; run `pnpm check:tauri-commands` before finishing.
  3. If no new command is needed, skip baseline changes.
- **Patterns to follow:** Existing doc style in `docs/messaging/SYNC_STATUS.md`; orphan-prevention script in `scripts/check-orphaned-tauri-commands.mjs`.
- **Test scenarios:**
  - `pnpm check:tauri-commands` passes with zero new orphaned commands.
  - `SYNC_STATUS.md` accurately describes the new states and does not claim `stalled` is unreachable.
- **Verification:** Doc review plus the CI ratchet command pass.

---

## Verification Contract

Run these gates before declaring the plan done:

| Gate | Command / check | Applies to |
|---|---|---|
| Typecheck | `pnpm check` | All units touching frontend code |
| Lint | `pnpm lint` | All units |
| Orphaned-command ratchet | `pnpm check:tauri-commands` | U1, U2, U3 if new commands are added |
| Frontend unit tests | `pnpm test` | U3, U4, U5 |
| Backend unit tests | `cd src-tauri && cargo test --lib` | U1, U2, U6 |
| Tauri MCP smoke | Start app, create account, force a relay disconnect/reconnect, observe `behind`/`stalled` dot and recovered DM | AE1, AE4, AE5, AE6 (when MCP tools are available) |

---

## Definition of Done

- A backend-owned bounded recent-window catch-up runs on frontend wake/resume triggers and on relay reconnect, without duplicating the login init path.
- `dmSyncStatus` displays `behind` or `stalled` when the client is not caught up, and the status affordance offers a manual deep-rescan action with a cost warning.
- `createAccount` starts the same post-login network sync as unlock/import.
- The 15 s relay health loop no longer force-disconnects relays on empty or slow Metadata probes; it records metrics/logs and reconnects only on `Terminated`.
- All new or changed Tauri commands have frontend callers and pass `pnpm check:tauri-commands`.
- `docs/messaging/SYNC_STATUS.md` reflects the new states and flows.
- No abandoned experimental code remains in the diff.
