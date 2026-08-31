//! Chat/message sync commands: fetch/paginate/search messages, typing, unread counts,
//! DM deletion, and the gift-wrap intake path (`handle_event`) plus the account-wide
//! forward/backward/catch-up sync state machine that backs `fetch_messages`.

use crate::{profile, Profile};
use nostr_sdk::prelude::*;
use crate::{db, get_file_type_description, get_nostr_client, handle_event_guarded, mls, notification, nostr_sign, nostr_tags, process_rumor, save_chat_messages, trusted_relays, wait_for_populated_relay_pool, ChatState, ChatType, ConversationType, Message, MlsService, Reaction, RumorContext, RumorEvent, RumorProcessingResult, STATE, StoredEvent, SyncMode, TAURI_APP, WRAPPER_ID_CACHE};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::Mutex;
use lazy_static::lazy_static;
#[cfg(test)]
use crate::{Chat, NotificationLevel};

/// Grace period after a Finished account-wide sync before a `fetch_messages(false)` call
/// (wake/reconnect trigger) is worth re-checking for missed events.
pub(crate) const CATCH_UP_GRACE_SECS: u64 = 60;

/// Overlap subtracted from `last_catch_up_until` on CatchUp entry, to avoid missing events
/// that landed exactly at the boundary of the previous sync.
pub(crate) const CATCH_UP_OVERLAP_SECS: u64 = 30;

/// Max span of a single CatchUp slice, matching the initial login window.
pub(crate) const CATCH_UP_SLICE_SECS: u64 = 60 * 60 * 24 * 2;

lazy_static! {
    /// Arbitrary fixed point captured at process start. `Instant::elapsed()` against this is a
    /// monotonic clock reading immune to wall-clock adjustments (NTP, manual changes, sleep/
    /// resume skew) — used to detect catch-up staleness even when the wall clock lies.
    static ref MONOTONIC_EPOCH: std::time::Instant = std::time::Instant::now();
}

/// Seconds elapsed since `MONOTONIC_EPOCH`. Not itself unit-tested (it reads the real clock);
/// `should_enter_catch_up` and friends take the reading as a plain `u64` parameter so their
/// staleness logic is.
pub(crate) fn monotonic_now_secs() -> u64 {
    MONOTONIC_EPOCH.elapsed().as_secs()
}

/// Should a Finished, account-wide sync be promoted into a bounded CatchUp walk?
/// True once the grace window since the last successful catch-up has elapsed, judged by
/// whichever clock shows more elapsed time: the wall clock (`now` vs. `last_catch_up_until`)
/// or a monotonic clock reading (`now_monotonic` vs. `last_catch_up_monotonic`, seconds since
/// an arbitrary process-start epoch). The wall clock alone is not reliable here: a backward
/// step (NTP correction, manual clock change, or clock skew on sleep/resume) can make
/// `now.saturating_sub(last_catch_up_until)` read small or zero even though real time — which
/// the monotonic clock still measures correctly, being immune to wall-clock adjustments — has
/// genuinely moved on. `last_catch_up_monotonic` is `None` before any catch-up has completed
/// in this process; the wall-clock delta alone decides in that case (matching the already-
/// covered "never recorded" / zero-watermark behavior).
pub(crate) fn should_enter_catch_up(
    last_catch_up_until: u64,
    now: u64,
    last_catch_up_monotonic: Option<u64>,
    now_monotonic: u64,
) -> bool {
    let wall_clock_elapsed = now.saturating_sub(last_catch_up_until);
    let elapsed = match last_catch_up_monotonic {
        Some(anchor) => std::cmp::max(wall_clock_elapsed, now_monotonic.saturating_sub(anchor)),
        None => wall_clock_elapsed,
    };
    elapsed > CATCH_UP_GRACE_SECS
}

/// Computes the next CatchUp slice, walking FORWARD from `window_start` towards `now` in
/// `CATCH_UP_SLICE_SECS`-bounded steps. `window_start` is `last_catch_up_until` on first
/// entry (`apply_overlap = true`, to re-cover the boundary) or the previous slice's `until`
/// on every later slice of the same walk (`apply_overlap = false`). Returns
/// `(since, until, is_last_slice)`; `is_last_slice` is true once the slice reaches `now`.
pub(crate) fn catch_up_window(window_start: u64, now: u64, apply_overlap: bool) -> (u64, u64, bool) {
    let raw_since = if apply_overlap {
        window_start.saturating_sub(CATCH_UP_OVERLAP_SECS)
    } else {
        window_start
    };
    // A zero watermark means "no catch-up ever recorded" (fresh `ChatState`), not a
    // decades-stale window. Floor it the same way `single_relay_fetch_since` floors its
    // no-prior-catch-up fallback, so the first promotion on a fresh session starts at most
    // `CATCH_UP_SLICE_SECS` back instead of walking forward from the Unix epoch.
    let since = if window_start == 0 {
        std::cmp::max(raw_since, now.saturating_sub(CATCH_UP_SLICE_SECS))
    } else {
        raw_since
    };
    let until = std::cmp::min(now, since + CATCH_UP_SLICE_SECS);
    let is_last_slice = until >= now;
    (since, until, is_last_slice)
}

/// Full entry gate for promoting a Finished, account-wide sync into CatchUp. Requires no
/// sync already in flight — the same `is_syncing` in-flight guard `ForwardSync` sets when
/// the login sync starts — so a duplicate wake/reconnect trigger arriving while a CatchUp
/// (or any other) walk is still running never spawns a second, parallel window.
pub(crate) fn should_promote_to_catch_up(
    mode: SyncMode,
    is_syncing: bool,
    last_catch_up_until: u64,
    now: u64,
    last_catch_up_monotonic: Option<u64>,
    now_monotonic: u64,
) -> bool {
    mode == SyncMode::Finished
        && !is_syncing
        && should_enter_catch_up(
            last_catch_up_until,
            now,
            last_catch_up_monotonic,
            now_monotonic,
        )
}

/// Bounds a single-relay reconnect fetch: caps it at the 2-day `CATCH_UP_SLICE_SECS` window,
/// but narrows it to the gap since the last recorded account-wide catch-up (with the same
/// overlap used by `catch_up_window`) when that gap is smaller. A relay reconnecting shortly
/// after a full catch-up therefore does not redundantly re-fetch the whole 2-day window, while
/// a relay with no prior catch-up (`last_catch_up_until == 0`) or a long outage still gets the
/// full 2-day cap.
pub(crate) fn single_relay_fetch_since(last_catch_up_until: u64, now: u64) -> u64 {
    let two_day_floor = now.saturating_sub(CATCH_UP_SLICE_SECS);
    let recent_bound = last_catch_up_until.saturating_sub(CATCH_UP_OVERLAP_SECS);
    std::cmp::max(two_day_floor, recent_bound)
}

/// Branch-selection for the next sync slice, extracted from `fetch_messages` so the
/// ForwardSync/BackwardSync/DeepRescan/CatchUp continuation and promotion logic is
/// unit-testable without a Tauri `AppHandle` or Nostr client. Mutates `state` to claim the
/// returned window (and, on promotion, to enter `SyncMode::CatchUp`) exactly as the inlined
/// version did, including setting `slice_in_flight` so a concurrent call sees the claim.
/// Returns `None` when there is nothing to do this call: a slice is already claimed by a
/// concurrent invocation (`slice_in_flight`), or the account-wide sync is `Finished` and
/// still within the catch-up grace window.
///
/// A slice deferred by `defer_sync_slice_for_empty_pool` (`sync_slice_relay_wait`) is retried
/// first, before the `slice_in_flight` check: it re-claims the *exact* window that deferral
/// captured rather than falling through to the normal branch selection, which would advance
/// past it (ForwardSync/BackwardSync/DeepRescan) or require the catch-up grace window to
/// re-elapse (CatchUp/Finished).
pub(crate) fn next_sync_slice(
    state: &mut ChatState,
    now: u64,
    now_monotonic: u64,
) -> Option<(u64, u64, bool)> {
    if state.sync_slice_relay_wait {
        state.sync_slice_relay_wait = false;
        state.slice_in_flight = true;
        return Some((
            state.sync_window_start,
            state.sync_window_end,
            state.sync_slice_deferred_is_last,
        ));
    }

    if state.slice_in_flight {
        return None;
    }

    let (since, until, is_last) = if state.sync_mode == SyncMode::ForwardSync {
        // Forward sync (filling gaps from last message to now)
        let window_start = state.sync_window_start;
        let new_window_start = window_start - (60 * 60 * 24 * 2); // Always 2 days
        state.sync_window_start = new_window_start;
        state.sync_window_end = window_start;
        (new_window_start, window_start, false)
    } else if state.sync_mode == SyncMode::BackwardSync {
        // Backward sync (historically old messages)
        let window_start = state.sync_window_start;
        let new_window_start = window_start - (60 * 60 * 24 * 2); // Always 2 days
        state.sync_window_start = new_window_start;
        state.sync_window_end = window_start;
        (new_window_start, window_start, false)
    } else if state.sync_mode == SyncMode::DeepRescan {
        // Deep rescan mode - scan backwards in 2-day increments until 30 days of no events
        let window_start = state.sync_window_start;
        let new_window_start = window_start - (60 * 60 * 24 * 2); // Always 2 days
        state.sync_window_start = new_window_start;
        state.sync_window_end = window_start;
        (new_window_start, window_start, false)
    } else if state.sync_mode == SyncMode::CatchUp {
        // Continuing a CatchUp walk: advance forward from the previous slice's `until`.
        let (since, until, is_last) = catch_up_window(state.sync_window_end, now, false);
        state.sync_window_start = since;
        state.sync_window_end = until;
        (since, until, is_last)
    } else if should_promote_to_catch_up(
        state.sync_mode,
        state.is_syncing,
        state.last_catch_up_until,
        now,
        state.last_catch_up_monotonic,
        now_monotonic,
    ) {
        // Stale account-wide sync (wake/reconnect trigger past the grace window):
        // promote into a bounded forward CatchUp walk instead of returning None below.
        let (since, until, is_last) = catch_up_window(state.last_catch_up_until, now, true);
        state.sync_mode = SyncMode::CatchUp;
        state.is_syncing = true;
        state.sync_empty_iterations = 0;
        state.sync_total_iterations = 0;
        state.sync_window_start = since;
        state.sync_window_end = until;
        (since, until, is_last)
    } else {
        // Finished within the grace window, or unknown state: nothing to do.
        return None;
    };

    state.slice_in_flight = true;
    Some((since, until, is_last))
}

/// Post-fetch continue/terminate decision, extracted from `fetch_messages` for the same
/// reason as `next_sync_slice`. `events_found` is `total_events_count` for DeepRescan and
/// `new_messages_count` for every other mode — the caller selects which. `oldest_message_time`
/// is the oldest message timestamp across all chats, read only for the ForwardSync ->
/// BackwardSync transition. Always releases `slice_in_flight` before returning, whether the
/// walk continues or terminates, so the next slice (continuation loop or a racing
/// wake/reconnect trigger) can proceed.
pub(crate) fn record_slice_result(
    state: &mut ChatState,
    new_messages_count: u16,
    events_found: u16,
    catch_up_is_last_slice: bool,
    oldest_message_time: Option<u64>,
    now: u64,
    now_monotonic: u64,
) -> bool {
    let mut continue_sync = true;

    state.sync_total_iterations += 1;

    if events_found > 0 {
        state.sync_empty_iterations = 0;
    } else {
        state.sync_empty_iterations += 1;
    }

    if state.sync_mode == SyncMode::ForwardSync {
        // Forward sync transitions to backward sync after:
        // 1. Finding messages and going 3 more iterations without messages, or
        // 2. Going 5 iterations without finding any messages
        let enough_empty_iterations = state.sync_empty_iterations >= 5;
        let found_then_empty = new_messages_count > 0 && state.sync_empty_iterations >= 3;

        if found_then_empty || enough_empty_iterations {
            state.sync_mode = SyncMode::BackwardSync;
            state.sync_empty_iterations = 0;
            state.sync_total_iterations = 0;

            if let Some(oldest_ts) = oldest_message_time {
                state.sync_window_end = oldest_ts;
                state.sync_window_start = oldest_ts - (60 * 60 * 24 * 2); // 2 days before oldest
            } else {
                // Still start backward sync, but from recent history
                let thirty_days_ago = now - (60 * 60 * 24 * 30);
                state.sync_window_end = thirty_days_ago;
                state.sync_window_start = thirty_days_ago - (60 * 60 * 24 * 2);
            }
        }
    } else if state.sync_mode == SyncMode::BackwardSync {
        // For backward sync, continue until no messages found for 5 consecutive iterations
        if state.sync_empty_iterations >= 5 {
            state.sync_mode = SyncMode::Finished;
            continue_sync = false;
        }
    } else if state.sync_mode == SyncMode::DeepRescan {
        // For deep rescan, continue until no messages found for 15 consecutive iterations
        // (30 days of no events at 2 days/iteration)
        if state.sync_empty_iterations >= 15 {
            state.sync_mode = SyncMode::Finished;
            continue_sync = false;
        }
    } else if state.sync_mode == SyncMode::CatchUp {
        // CatchUp terminates once the slice we just processed reached "now" (not on empty
        // iterations — a quiet inbox is a perfectly valid CatchUp outcome).
        if catch_up_is_last_slice {
            state.sync_mode = SyncMode::Finished;
            continue_sync = false;
        }
    } else {
        continue_sync = false; // Unknown state, stop syncing
    }
    // Every path that lands here with `continue_sync == false` is a normal completion of a
    // full account-wide walk (BackwardSync/DeepRescan exhausting empty iterations, or CatchUp
    // reaching "now") — advance the watermark. A failed relay event stream never reaches this
    // function at all (it returns early with its own reset), so there's no "failed" case to
    // gate out separately here.
    if !continue_sync {
        state.last_catch_up_until = now;
        state.last_catch_up_monotonic = Some(now_monotonic);
    }
    state.slice_in_flight = false;
    continue_sync
}

#[cfg(test)]
mod unread_count_tests {
    use super::*;

    fn unread_message(id: &str, mine: bool) -> Message {
        Message {
            id: id.to_string(),
            content: "hi".to_string(),
            at: 1,
            mine,
            ..Default::default()
        }
    }

    #[test]
    fn nothing_level_chat_contributes_zero_to_map_and_total() {
        let mut state = ChatState::new();
        let mut chat = Chat::new_dm("npub1peer".to_string());
        chat.notification_level = NotificationLevel::Nothing;
        chat.messages.push(unread_message("m1", false));
        chat.messages.push(unread_message("m2", false));
        state.chats.push(chat);

        assert!(state.unread_counts_by_chat().is_empty());
        assert_eq!(state.count_unread_messages(), 0);
    }

    #[test]
    fn mentions_chat_total_ignores_nothing_chat_unread() {
        let mut state = ChatState::new();

        let mut counted = Chat::new_dm("npub1peer".to_string());
        counted.notification_level = NotificationLevel::Mentions;
        counted.messages.push(unread_message("m1", false));
        counted.messages.push(unread_message("m2", false));
        state.chats.push(counted);

        let mut silenced = Chat::new_dm("npub1other".to_string());
        silenced.notification_level = NotificationLevel::Nothing;
        silenced.messages.push(unread_message("m3", false));
        silenced.messages.push(unread_message("m4", false));
        silenced.messages.push(unread_message("m5", false));
        state.chats.push(silenced);

        assert_eq!(state.count_unread_messages(), 2);
    }

    #[test]
    fn map_includes_mls_chats_keyed_by_group_id() {
        let mut state = ChatState::new();
        let mut group = Chat::new_mls_group(
            "group-abc".to_string(),
            vec!["npub1a".to_string(), "npub1b".to_string()],
        );
        group.messages.push(unread_message("m1", false));
        state.chats.push(group);

        let counts = state.unread_counts_by_chat();
        assert_eq!(counts.get("group-abc"), Some(&1));
    }

    #[test]
    fn reverse_walk_stops_at_own_most_recent_message_for_mls_chats() {
        let mut state = ChatState::new();
        let mut group = Chat::new_mls_group("group-abc".to_string(), vec!["npub1a".to_string()]);
        group.messages.push(unread_message("m1", false));
        group.messages.push(unread_message("m2", true)); // own message: stop here
        group.messages.push(unread_message("m3", false));
        group.messages.push(unread_message("m4", false));
        state.chats.push(group);

        let counts = state.unread_counts_by_chat();
        assert_eq!(counts.get("group-abc"), Some(&2));
    }

    #[test]
    fn marking_mls_chat_read_drops_its_count_to_zero() {
        let mut state = ChatState::new();
        let mut group = Chat::new_mls_group("group-abc".to_string(), vec!["npub1a".to_string()]);
        group.messages.push(unread_message("m1", false));
        group.messages.push(unread_message("m2", false));
        state.chats.push(group);
        assert_eq!(state.unread_counts_by_chat().get("group-abc"), Some(&2));

        // Same watermark logic `mark_as_read` applies: pick the last non-mine message.
        let chat = state
            .chats
            .iter_mut()
            .find(|c| c.id == "group-abc")
            .unwrap();
        assert!(chat.set_as_read());

        assert!(state.unread_counts_by_chat().get("group-abc").is_none());
        assert_eq!(state.count_unread_messages(), 0);
    }

    #[test]
    fn raising_a_nothing_chat_to_mentions_recounts_its_already_received_messages() {
        let mut state = ChatState::new();
        let mut chat = Chat::new_dm("npub1peer".to_string());
        chat.notification_level = NotificationLevel::Nothing;
        chat.messages.push(unread_message("m1", false));
        chat.messages.push(unread_message("m2", false));
        state.chats.push(chat);
        assert_eq!(state.count_unread_messages(), 0);

        state.chats[0].notification_level = NotificationLevel::Mentions;
        assert_eq!(state.count_unread_messages(), 2);
    }

    #[test]
    fn blocked_dm_peer_contributes_zero_even_at_all_level() {
        let mut state = ChatState::new();
        let mut profile = Profile::new();
        profile.id = "npub1peer".to_string();
        profile.blocked = true;
        state.profiles.push(profile);

        let mut chat = Chat::new_dm("npub1peer".to_string());
        chat.notification_level = NotificationLevel::All;
        chat.messages.push(unread_message("m1", false));
        state.chats.push(chat);

        assert!(state.unread_counts_by_chat().is_empty());
    }
}

#[cfg(test)]
mod catch_up_tests {
    use super::{
        catch_up_window, should_enter_catch_up, should_promote_to_catch_up,
        single_relay_fetch_since, SyncMode, CATCH_UP_GRACE_SECS, CATCH_UP_OVERLAP_SECS,
        CATCH_UP_SLICE_SECS,
    };

    #[test]
    fn within_grace_window_does_not_enter_catch_up() {
        let now = 1_000_000u64;
        let last_catch_up_until = now - 30; // 30s ago, well within the 60s grace window
        assert!(!should_enter_catch_up(last_catch_up_until, now, None, 0));
    }

    #[test]
    fn promotion_blocked_while_a_sync_is_already_in_flight() {
        // The in-flight guard: even with a stale watermark, a sync already running
        // (is_syncing = true) must not spawn a second, parallel CatchUp window.
        let now = 1_000_000u64;
        let last_catch_up_until = now - 60 * 60; // 1 hour ago: stale enough on its own
        assert!(!should_promote_to_catch_up(
            SyncMode::Finished,
            true,
            last_catch_up_until,
            now,
            None,
            0
        ));
        assert!(should_promote_to_catch_up(
            SyncMode::Finished,
            false,
            last_catch_up_until,
            now,
            None,
            0
        ));
    }

    #[test]
    fn promotion_only_fires_from_finished_mode() {
        let now = 1_000_000u64;
        let last_catch_up_until = now - 60 * 60;
        for mode in [
            SyncMode::ForwardSync,
            SyncMode::BackwardSync,
            SyncMode::DeepRescan,
            SyncMode::CatchUp,
        ] {
            assert!(!should_promote_to_catch_up(
                mode,
                false,
                last_catch_up_until,
                now,
                None,
                0
            ));
        }
    }

    #[test]
    fn exactly_at_grace_boundary_does_not_enter_catch_up() {
        let now = 1_000_000u64;
        let last_catch_up_until = now - CATCH_UP_GRACE_SECS;
        assert!(!should_enter_catch_up(last_catch_up_until, now, None, 0));
    }

    #[test]
    fn stale_last_catch_up_enters_catch_up() {
        let now = 1_000_000u64;
        let last_catch_up_until = now - 60 * 60; // 1 hour ago (the test name already conveys the scenario)
        assert!(should_enter_catch_up(last_catch_up_until, now, None, 0));
    }

    #[test]
    fn zero_watermark_enters_catch_up() {
        // A never-recorded (0) watermark is maximally stale and must enter catch-up.
        let now = 1_000_000u64;
        assert!(should_enter_catch_up(0, now, None, 0));
    }

    #[test]
    fn first_slice_covers_a_single_two_day_window_ending_at_now() {
        // last_catch_up_until 1 hour ago fetches a single 2-day window ending at now.
        let now = 2_000_000u64;
        let last_catch_up_until = now - 60 * 60;
        let (since, until, is_last) = catch_up_window(last_catch_up_until, now, true);

        assert_eq!(since, last_catch_up_until - 30); // overlap applied
        assert_eq!(until, now); // capped at now, well inside the 2-day slice cap
        assert!(is_last);
    }

    #[test]
    fn zero_watermark_floors_to_two_day_cap_instead_of_the_unix_epoch() {
        // A fresh ChatState's last_catch_up_until is 0 (never recorded), not a genuine
        // decades-old watermark. Mirrors single_relay_fetch_falls_back_to_two_day_cap_with_no_prior_catch_up:
        // the walk must start no further back than the 2-day slice cap.
        let now = 2_000_000_000u64;
        let (since, until, is_last) = catch_up_window(0, now, true);

        assert!(since >= now - CATCH_UP_SLICE_SECS);
        assert_eq!(until, now);
        assert!(is_last);
    }

    #[test]
    fn zero_watermark_still_promotes_to_catch_up() {
        let now = 2_000_000_000u64;
        assert!(should_promote_to_catch_up(
            SyncMode::Finished,
            false,
            0,
            now,
            None,
            0
        ));
    }

    #[test]
    fn wide_gap_produces_bounded_forward_slices_until_reaching_now() {
        // A gap wider than one slice must walk FORWARD (not backward) in
        // CATCH_UP_SLICE_SECS-bounded steps, ending exactly at `now`.
        let now = 10 * CATCH_UP_SLICE_SECS + 1_000;
        let last_catch_up_until = 500u64; // gap spans several slices

        let (since1, until1, is_last1) = catch_up_window(last_catch_up_until, now, true);
        assert_eq!(since1, last_catch_up_until - 30);
        assert_eq!(until1, since1 + CATCH_UP_SLICE_SECS);
        assert!(
            until1 < now,
            "first slice of a wide gap must not reach now yet"
        );
        assert!(!is_last1);

        // Next slice continues forward from the previous slice's `until`, no overlap.
        let (since2, until2, is_last2) = catch_up_window(until1, now, false);
        assert_eq!(since2, until1);
        assert!(
            since2 > since1,
            "window must advance forward, never backward"
        );
        assert!(!is_last2);

        // Walk remaining slices until the loop terminates at `now`.
        let mut since = since2;
        let mut until = until2;
        let mut is_last = is_last2;
        let mut iterations = 1;
        while !is_last {
            let (s, u, last) = catch_up_window(until, now, false);
            assert!(s >= since, "window must never move backward");
            since = s;
            until = u;
            is_last = last;
            iterations += 1;
            assert!(iterations < 100, "catch-up walk did not terminate");
        }
        assert_eq!(until, now);
    }

    #[test]
    fn single_relay_fetch_falls_back_to_two_day_cap_with_no_prior_catch_up() {
        // last_catch_up_until == 0 (never recorded): full 2-day cap, not the recent-gap bound.
        let now = 2_000_000_000u64;
        assert_eq!(single_relay_fetch_since(0, now), now - CATCH_UP_SLICE_SECS);
    }

    #[test]
    fn single_relay_fetch_narrows_to_recent_catch_up_gap() {
        // Reconnecting 10 minutes after a full account-wide catch-up must not re-fetch 2 days.
        let now = 2_000_000_000u64;
        let last_catch_up_until = now - 600;
        let since = single_relay_fetch_since(last_catch_up_until, now);
        assert_eq!(since, last_catch_up_until - CATCH_UP_OVERLAP_SECS);
        assert!(
            since > now - CATCH_UP_SLICE_SECS,
            "narrowed window must be tighter than the 2-day cap"
        );
    }

    #[test]
    fn single_relay_fetch_stays_capped_at_two_days_for_a_long_outage() {
        // A relay down far longer than 2 days must not walk back further than the cap.
        let now = 2_000_000_000u64;
        let last_catch_up_until = now - 10 * CATCH_UP_SLICE_SECS;
        assert_eq!(
            single_relay_fetch_since(last_catch_up_until, now),
            now - CATCH_UP_SLICE_SECS
        );
    }
}

#[cfg(test)]
mod fetch_messages_state_machine_tests {
    use super::{
        abandon_sync_slice, defer_sync_slice_for_empty_pool, is_empty_relay_pool_error,
        next_sync_slice, record_slice_result, ChatState, SyncMode, CATCH_UP_GRACE_SECS,
        CATCH_UP_SLICE_SECS,
    };

    #[test]
    fn promotion_claims_a_catch_up_slice_and_marks_it_in_flight() {
        // Fresh ChatState: Finished, not syncing, never caught up. A wake/reconnect trigger
        // must promote into CatchUp and claim the slice.
        let mut state = ChatState::new();
        let now = 2_000_000_000u64;

        let result = next_sync_slice(&mut state, now, 0);

        assert!(result.is_some());
        let (since, until, is_last) = result.unwrap();
        assert!(since >= now - CATCH_UP_SLICE_SECS);
        assert_eq!(until, now);
        assert!(is_last);
        assert_eq!(state.sync_mode, SyncMode::CatchUp);
        assert!(state.is_syncing);
        assert!(state.slice_in_flight);
    }

    #[test]
    fn continuation_advances_the_catch_up_window_forward() {
        let mut state = ChatState::new();
        state.sync_mode = SyncMode::CatchUp;
        state.is_syncing = true;
        state.sync_window_start = 1_000;
        state.sync_window_end = 5_000;
        let now = 5_000 + CATCH_UP_SLICE_SECS * 3;

        let (since, until, is_last) = next_sync_slice(&mut state, now, 0).unwrap();

        // Continuation has no overlap and starts exactly where the previous slice ended.
        assert_eq!(since, 5_000);
        assert_eq!(until, 5_000 + CATCH_UP_SLICE_SECS);
        assert!(!is_last);
        assert_eq!(state.sync_window_start, since);
        assert_eq!(state.sync_window_end, until);
        assert!(state.slice_in_flight);
    }

    #[test]
    fn a_concurrent_call_is_rejected_while_a_slice_is_in_flight() {
        // This is the regression guard for the concurrency bug: a second fetch_messages(false)
        // call (wake trigger racing the normal continuation loop, or vice versa) must not
        // advance sync_window_end a second time while the first call's slice is still in flight.
        let mut state = ChatState::new();
        state.sync_mode = SyncMode::CatchUp;
        state.is_syncing = true;
        state.sync_window_start = 1_000;
        state.sync_window_end = 5_000;
        state.slice_in_flight = true; // another call already claimed this slice

        let result = next_sync_slice(&mut state, 50_000, 0);

        assert!(
            result.is_none(),
            "a concurrent call must be rejected as a no-op duplicate"
        );
        // The window must be untouched: the in-flight call's own window is still authoritative.
        assert_eq!(state.sync_window_start, 1_000);
        assert_eq!(state.sync_window_end, 5_000);
    }

    #[test]
    fn catch_up_terminates_on_the_last_slice_and_advances_the_watermark() {
        let mut state = ChatState::new();
        state.sync_mode = SyncMode::CatchUp;
        state.is_syncing = true;
        state.slice_in_flight = true;
        let now = 2_000_000_000u64;

        let continue_sync = record_slice_result(
            &mut state, /* new_messages_count */ 0, /* events_found */ 0,
            /* catch_up_is_last_slice */ true, /* oldest_message_time */ None, now, 0,
        );

        assert!(
            !continue_sync,
            "CatchUp reaching its last slice must terminate the walk"
        );
        assert_eq!(state.sync_mode, SyncMode::Finished);
        assert_eq!(
            state.last_catch_up_until, now,
            "a normal completion must advance the watermark"
        );
        assert!(
            !state.slice_in_flight,
            "the claim must be released once the slice is recorded"
        );
    }

    #[test]
    fn catch_up_continues_and_releases_the_in_flight_claim_when_not_the_last_slice() {
        let mut state = ChatState::new();
        state.sync_mode = SyncMode::CatchUp;
        state.is_syncing = true;
        state.slice_in_flight = true;
        let last_catch_up_until_before = state.last_catch_up_until;

        let continue_sync = record_slice_result(&mut state, 0, 0, false, None, 2_000_000_000u64, 0);

        assert!(continue_sync);
        assert_eq!(
            state.sync_mode,
            SyncMode::CatchUp,
            "walk keeps going until the last slice"
        );
        assert_eq!(
            state.last_catch_up_until, last_catch_up_until_before,
            "no watermark advance mid-walk"
        );
        assert!(
            !state.slice_in_flight,
            "the claim must be released so the next slice can proceed"
        );
    }

    #[test]
    fn backward_sync_terminates_after_five_empty_iterations_and_advances_the_watermark() {
        let mut state = ChatState::new();
        state.sync_mode = SyncMode::BackwardSync;
        state.is_syncing = true;
        state.sync_empty_iterations = 4;
        state.slice_in_flight = true;
        let now = 2_000_000_000u64;

        let continue_sync = record_slice_result(&mut state, 0, 0, false, None, now, 0);

        assert!(!continue_sync);
        assert_eq!(state.sync_mode, SyncMode::Finished);
        assert_eq!(state.last_catch_up_until, now);
    }

    #[test]
    fn a_backward_wall_clock_jump_does_not_suppress_a_catch_up_that_was_otherwise_due() {
        // Regression guard: an NTP correction or manual clock change stepping the wall clock
        // backward must not make a genuinely due catch-up look fresh. The monotonic reading
        // (immune to wall-clock adjustments) is what actually elapsed and must win.
        let mut state = ChatState::new();
        state.sync_mode = SyncMode::Finished;
        state.is_syncing = false;
        state.last_catch_up_until = 1_000_000; // wall clock at the last successful catch-up
        state.last_catch_up_monotonic = Some(1_000); // monotonic reading at that same moment

        // The wall clock has jumped BACKWARD: it now reads before the last catch-up watermark,
        // so the wall-clock delta alone would saturate to 0 and hide the staleness.
        let now_wall_clock = 999_000u64;
        assert!(now_wall_clock < state.last_catch_up_until);

        // Real (monotonic) time has genuinely moved on well past the grace window.
        let now_monotonic = 1_000 + CATCH_UP_GRACE_SECS + 30;

        let result = next_sync_slice(&mut state, now_wall_clock, now_monotonic);

        assert!(
            result.is_some(),
            "monotonic elapsed time must still trigger the overdue catch-up"
        );
        assert_eq!(state.sync_mode, SyncMode::CatchUp);
    }

    #[test]
    fn deferred_slice_from_an_empty_pool_is_retried_immediately_not_abandoned() {
        // Regression guard: on a first-boot login, the account-wide sync
        // claims its initial ForwardSync window, but the relay pool is still empty when the
        // stream tries to establish (relay setup hasn't completed yet). The old behavior
        // (`abandon_sync_slice`) reset the walk to `Finished` permanently in practice — nothing
        // else re-triggers `fetch_messages(false)` on a fresh session, and even a prompt retry
        // within the 60s catch-up grace window would see `next_sync_slice` return `None` (see
        // `abandon_sync_slice_leaves_a_prompt_retry_with_nothing_to_do` below).
        let mut state = ChatState::new();
        state.sync_mode = SyncMode::ForwardSync;
        state.is_syncing = true;
        state.sync_window_start = 1_000_000;
        state.sync_window_end = 1_100_000;
        state.slice_in_flight = true; // claimed by the slice that's about to fail

        let now = 2_000_000_000u64;

        // The stream establishment failed because the pool was empty — defer, don't abandon.
        defer_sync_slice_for_empty_pool(&mut state, /* is_last */ false);

        assert!(
            !state.slice_in_flight,
            "the claim is released so a retry isn't rejected as a concurrent duplicate"
        );
        assert_eq!(
            state.sync_mode,
            SyncMode::ForwardSync,
            "deferral must not terminate the walk like abandon_sync_slice does"
        );
        assert!(state.is_syncing, "still syncing — just waiting on relays");

        // A relay connects moments later (well within the 60s catch-up grace window) and the
        // caller retries via fetch_messages(false) -> next_sync_slice.
        let retry = next_sync_slice(&mut state, now, 0);

        assert_eq!(
            retry,
            Some((1_000_000, 1_100_000, false)),
            "the exact deferred window must be retried, not skipped or gated on the grace window"
        );
        assert!(
            state.slice_in_flight,
            "the retried slice re-claims the in-flight guard"
        );
        assert!(
            !state.sync_slice_relay_wait,
            "the deferred-retry flag is consumed once the slice is re-claimed"
        );
    }

    #[test]
    fn abandon_sync_slice_leaves_a_prompt_retry_with_nothing_to_do() {
        // Contrast case: the OLD (pre-fix) permanent-abandon path. A retry that arrives
        // promptly (well inside the 60s catch-up grace window) finds nothing to do, because
        // `abandon_sync_slice` doesn't preserve the claimed window and `next_sync_slice`
        // requires the grace window to elapse before promoting a `Finished` sync into anything.
        let mut state = ChatState::new();
        state.sync_mode = SyncMode::ForwardSync;
        state.is_syncing = true;
        state.sync_window_start = 1_000_000;
        state.sync_window_end = 1_100_000;
        state.slice_in_flight = true;
        state.last_catch_up_until = 1_999_999_970; // a very recent watermark from earlier in the session

        let now = 2_000_000_000u64; // 30s later — inside the 60s grace window

        abandon_sync_slice(&mut state);
        assert_eq!(state.sync_mode, SyncMode::Finished);

        let retry = next_sync_slice(&mut state, now, 0);
        assert_eq!(
            retry, None,
            "abandon_sync_slice leaves a prompt retry with nothing to do inside the grace window"
        );
    }

    #[test]
    fn empty_relay_pool_error_detection_matches_no_relays_variants_only() {
        assert!(is_empty_relay_pool_error("no relays specified"));
        assert!(is_empty_relay_pool_error("No Relays"));
        assert!(!is_empty_relay_pool_error("relay banned"));
        assert!(!is_empty_relay_pool_error("connection refused"));
    }
}

#[tauri::command]
pub(crate) async fn fetch_messages<R: Runtime>(handle: AppHandle<R>, init: bool, relay_url: Option<String>) {
    let client = get_nostr_client().expect("Nostr client not initialized");

    // Grab our pubkey
    let signer = match client.signer().await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[Sync] Failed to get Nostr signer: {}", e);
            return;
        }
    };
    let my_public_key = match signer.get_public_key().await {
        Ok(pk) => pk,
        Err(e) => {
            eprintln!("[Sync] Failed to get public key from signer: {}", e);
            return;
        }
    };

    // If relay_url is provided, this is a single-relay sync that bypasses global state
    if relay_url.is_some() {
        // Single relay sync - bounded by the 2-day cap, narrowed to the gap since the last
        // account-wide catch-up. Read-only lock: does not mutate ChatState.
        let now = Timestamp::now();
        let last_catch_up_until = STATE.lock().await.last_catch_up_until;
        let since = single_relay_fetch_since(last_catch_up_until, now.as_secs());

        let filter = Filter::new()
            .pubkey(my_public_key)
            .kind(Kind::GiftWrap)
            .since(Timestamp::from_secs(since))
            .until(now);

        // Fetch from specific relay only
        let relay_url_str = relay_url.unwrap();
        let mut events = match client
            .stream_events_from(
                vec![relay_url_str.clone()],
                filter,
                std::time::Duration::from_secs(30),
            )
            .await
        {
            Ok(stream) => stream,
            Err(e) => {
                eprintln!(
                    "[Single-Relay Sync] Failed to fetch events from {}: {}",
                    relay_url_str, e
                );
                return;
            }
        };

        // Process events without affecting global sync state
        while let Some(event) = events.next().await {
            handle_event_guarded(event, false).await;
        }

        // Also sync MLS group messages after single-relay reconnection
        if let Err(e) = crate::cmds::mls_groups::sync_mls_groups_now(None).await {
            eprintln!("[Single-Relay Sync] Failed to sync MLS groups: {}", e);
        }

        return; // Exit early for single-relay syncs
    }

    // Regular sync logic with global state management
    let (since_timestamp, until_timestamp, catch_up_is_last_slice) = {
        let mut state = STATE.lock().await;

        if init {
            // Set current account for SQL mode if profile database exists
            // This must be done BEFORE loading chats/messages so SQL mode is active
            let signer = client.signer().await.unwrap();
            let my_public_key = signer.get_public_key().await.unwrap();
            let npub = my_public_key.to_bech32().unwrap();

            let app_data = crate::test_sandbox::test_data_dir(&handle).ok();
            if let Some(data_dir) = app_data {
                let profile_db = data_dir.join(&npub).join("pacto.db");
                if profile_db.exists() {
                    let _ = crate::account_manager::set_current_account(npub.clone());
                    println!("[Startup] Set current account for SQL mode: {}", npub);
                }
            }

            // Load our DB (if we haven't already; i.e: our profile is the single loaded profile since login)
            let mut needs_integrity_check = false;
            if state.profiles.len() == 1 {
                let profiles = db::get_all_profiles(&handle).await.unwrap();
                // Load our Profile Cache into the state
                state.merge_db_profiles(profiles).await;

                // Spawn background task to cache profile images for offline support
                tokio::spawn(async {
                    profile::cache_all_profile_images().await;
                });

                // Load chats and their messages from database
                let slim_chats_result = db::get_all_chats(&handle).await;
                if let Ok(slim_chats) = slim_chats_result {
                    // Load MLS groups to check for evicted status
                    let mls_groups: Option<Vec<mls::MlsGroupMetadata>> =
                        db::load_mls_groups(&handle).await.ok();

                    // Convert slim chats to full chats and load their messages
                    for slim_chat in slim_chats {
                        let mut chat = slim_chat.to_chat();

                        // Skip MLS group chats that are marked as evicted
                        // MLS group chat IDs are just the group_id (no prefix)
                        if chat.chat_type == ChatType::MlsGroup {
                            if let Some(ref groups) = mls_groups {
                                if let Some(group) =
                                    groups.iter().find(|g| g.group_id.as_str() == chat.id())
                                {
                                    if group.evicted {
                                        println!(
                                            "[Startup] Skipping evicted MLS group chat: {}",
                                            chat.id()
                                        );
                                        continue; // Skip this chat
                                    }
                                }
                            }
                        }

                        // Load only the last message for preview (optimization: full messages loaded on-demand by frontend)
                        let last_messages_result =
                            db::get_chat_last_messages(&handle, &chat.id(), 1).await;
                        if let Ok(last_messages) = last_messages_result {
                            for message in last_messages {
                                // Check if this message has downloaded attachments (for integrity check)
                                if !needs_integrity_check
                                    && message.attachments.iter().any(|att| att.downloaded)
                                {
                                    needs_integrity_check = true;
                                }
                                chat.internal_add_message(message);
                            }
                        } else {
                            eprintln!(
                                "Failed to load last message for chat {}: {:?}",
                                chat.id(),
                                last_messages_result
                            );
                        }

                        // Ensure profiles exist for all chat participants
                        for participant in chat.participants() {
                            if state.get_profile(participant).is_none() {
                                // Create a basic profile for the participant
                                let mut profile = Profile::new();
                                profile.id = participant.clone();
                                profile.mine = false; // It's not our profile
                                state.profiles.push(profile);
                            }
                        }

                        // Add chat to state
                        state.chats.push(chat);

                        // Sort the chats by their last received message
                        state
                            .chats
                            .sort_by(|a, b| b.last_message_time().cmp(&a.last_message_time()));
                    }
                } else {
                    eprintln!(
                        "Failed to load chats from database: {:?}",
                        slim_chats_result
                    );
                }
            }

            if needs_integrity_check {
                // Clean up empty file attachments first
                cleanup_empty_file_attachments(&handle, &mut state).await;

                // Check integrity without dropping state
                check_attachment_filesystem_integrity(&handle, &mut state).await;

                // Preload ID caches for maximum performance
                if let Err(e) = db::preload_id_caches(&handle).await {
                    eprintln!("[Cache] Failed to preload ID caches: {}", e);
                }

                // Preload wrapper_event_ids for fast duplicate detection during sync
                // Load last 30 days of wrapper_ids to cover typical sync window
                if let Ok(wrapper_ids) = db::load_recent_wrapper_ids(&handle, 30).await {
                    let mut cache = WRAPPER_ID_CACHE.lock().await;
                    *cache = wrapper_ids;
                }

                // Build dm_flags (has_from_me / has_from_them per DM) from DB so frontend can show Friends vs Requests vs Pending
                let mut dm_flags = serde_json::Map::new();
                for chat in &state.chats {
                    if chat.id().starts_with("npub1") || chat.chat_type == ChatType::DirectMessage {
                        if let Ok((has_from_me, has_from_them)) =
                            db::get_dm_sent_received(&handle, chat.id())
                        {
                            dm_flags.insert(chat.id().clone(), serde_json::json!({ "has_from_me": has_from_me, "has_from_them": has_from_them }));
                        }
                    }
                }
                // Send the state to our frontend to signal finalised init with a full state
                handle
                    .emit(
                        "init_finished",
                        serde_json::json!({
                            "profiles": &state.profiles,
                            "chats": &state.chats,
                            "dm_flags": serde_json::Value::Object(dm_flags)
                        }),
                    )
                    .unwrap();
            } else {
                // Even if no integrity check needed, still clean up empty files
                cleanup_empty_file_attachments(&handle, &mut state).await;

                // Preload ID caches for maximum performance
                if let Err(e) = db::preload_id_caches(&handle).await {
                    eprintln!("[Cache] Failed to preload ID caches: {}", e);
                }

                // Preload wrapper_event_ids for fast duplicate detection during sync
                // Load last 30 days of wrapper_ids to cover typical sync window
                if let Ok(wrapper_ids) = db::load_recent_wrapper_ids(&handle, 30).await {
                    let mut cache = WRAPPER_ID_CACHE.lock().await;
                    *cache = wrapper_ids;
                }

                // Build dm_flags (has_from_me / has_from_them per DM) from DB so frontend can show Friends vs Requests vs Pending
                let mut dm_flags = serde_json::Map::new();
                for chat in &state.chats {
                    if chat.id().starts_with("npub1") || chat.chat_type == ChatType::DirectMessage {
                        if let Ok((has_from_me, has_from_them)) =
                            db::get_dm_sent_received(&handle, chat.id())
                        {
                            dm_flags.insert(chat.id().clone(), serde_json::json!({ "has_from_me": has_from_me, "has_from_them": has_from_them }));
                        }
                    }
                }
                // No integrity check needed, send init immediately
                handle
                    .emit(
                        "init_finished",
                        serde_json::json!({
                            "profiles": &state.profiles,
                            "chats": &state.chats,
                            "dm_flags": serde_json::Value::Object(dm_flags)
                        }),
                    )
                    .unwrap();
            }

            // ALWAYS begin with an initial sync of at least the last 2 days
            let now = Timestamp::now();

            state.is_syncing = true;
            state.slice_in_flight = true;
            state.sync_mode = SyncMode::ForwardSync;
            state.sync_empty_iterations = 0;
            state.sync_total_iterations = 0;

            // Initial 2-day window: now - 2 days → now
            let two_days_ago = now.as_secs() - (60 * 60 * 24 * 2);

            state.sync_window_start = two_days_ago;
            state.sync_window_end = now.as_secs();

            (Timestamp::from_secs(two_days_ago), now, false)
        } else {
            match next_sync_slice(&mut state, Timestamp::now().as_secs(), monotonic_now_secs()) {
                Some((since, until, is_last)) => (
                    Timestamp::from_secs(since),
                    Timestamp::from_secs(until),
                    is_last,
                ),
                // Nothing to do: a slice is already in flight for a concurrent call, or the
                // sync is Finished within the catch-up grace window.
                None => return,
            }
        }
    };

    // If sync is finished, emit the finished event and return
    {
        let state = STATE.lock().await;
        if state.sync_mode == SyncMode::Finished {
            // Only emit if this is not a single-relay sync
            if relay_url.is_none() {
                handle.emit("sync_finished", ()).unwrap();
            }
            return;
        }
    }

    // Emit our current "Sync Range" to the frontend (only for general syncs, not single-relay)
    if relay_url.is_none() {
        handle
            .emit(
                "sync_progress",
                serde_json::json!({
                    "since": since_timestamp.as_secs(),
                    "until": until_timestamp.as_secs(),
                    "mode": format!("{:?}", STATE.lock().await.sync_mode)
                }),
            )
            .unwrap();
    }

    // Fetch GiftWraps related to us within the time window
    let filter = Filter::new()
        .pubkey(my_public_key)
        .kind(Kind::GiftWrap)
        .since(since_timestamp)
        .until(until_timestamp);

    let mut event_stream = if let Some(url) = &relay_url {
        // Fetch from specific relay
        match client
            .stream_events_from(vec![url], filter, std::time::Duration::from_secs(30))
            .await
        {
            Ok(stream) => stream,
            Err(e) => {
                eprintln!("[Sync] Relay event stream failed for {}: {}", url, e);
                let mut state = STATE.lock().await;
                abandon_sync_slice(&mut state);
                return;
            }
        }
    } else {
        // Fetch from all relays. A brand-new session's account-wide stream can race relay setup
        // (login/startup adds relays to the pool right after this fires) — give the pool a
        // bounded chance to gain a relay before establishing the stream, instead of racing
        // ahead into a doomed "no relays specified" attempt: the stream must not be established
        // before the pool is populated.
        if client.relays().await.is_empty() {
            wait_for_populated_relay_pool(&client).await;
        }
        match client
            .stream_events(filter, std::time::Duration::from_secs(60))
            .await
        {
            Ok(stream) => stream,
            Err(e) => {
                let mut state = STATE.lock().await;
                if is_empty_relay_pool_error(&e.to_string()) {
                    // Retryable: the pool is (still) empty, even after the bounded wait above.
                    // Defer instead of abandoning so the exact same window is retried once a
                    // relay connects (see `connect`'s retry hook), rather than leaving the
                    // account looking synced while it silently ingests nothing forever.
                    println!(
                        "[Sync] Account-wide relay event stream deferred: {} (will retry once a relay connects)",
                        e
                    );
                    defer_sync_slice_for_empty_pool(&mut state, catch_up_is_last_slice);
                } else {
                    eprintln!("[Sync] Account-wide relay event stream failed: {}", e);
                    abandon_sync_slice(&mut state);
                }
                return;
            }
        }
    };

    // Count total events fetched (for DeepRescan) and new messages added (for other modes)
    // We'll compute total count while iterating; placeholder will be set after loop
    let mut new_messages_count: u16 = 0;
    while let Some(event) = event_stream.next().await {
        // Count the amount of accepted (new) events
        if handle_event_guarded(event, false).await {
            new_messages_count += 1;
        }
    }

    // After processing all events, total_events_count equals the number of processed events
    let total_events_count = new_messages_count as u16;
    let should_continue = {
        let mut state = STATE.lock().await;

        // For DeepRescan, use total events count; for other modes, use new messages count
        let events_found = if state.sync_mode == SyncMode::DeepRescan {
            total_events_count
        } else {
            new_messages_count
        };

        // Oldest message timestamp across all chats, needed only for the ForwardSync ->
        // BackwardSync transition; computed here since it needs `state.chats`.
        let oldest_message_time = state
            .chats
            .iter()
            .filter_map(|chat| chat.last_message_time())
            .min();

        record_slice_result(
            &mut state,
            new_messages_count,
            events_found,
            catch_up_is_last_slice,
            oldest_message_time,
            Timestamp::now().as_secs(),
            monotonic_now_secs(),
        )
    };

    if should_continue {
        // Keep synchronising
        if relay_url.is_none() {
            handle.emit("sync_slice_finished", ()).unwrap();
        }
    } else {
        // We're done with sync - update state first, then emit event
        {
            let mut state = STATE.lock().await;
            state.sync_mode = SyncMode::Finished;
            state.is_syncing = false;
            state.sync_empty_iterations = 0;
            state.sync_total_iterations = 0;
            // last_catch_up_until was already advanced inside record_slice_result for the
            // normal-completion case; nothing further to do here.
        } // Release lock before emitting event

        // Clear the wrapper_id cache - it's only needed during sync
        {
            let mut cache = WRAPPER_ID_CACHE.lock().await;
            let cache_size = cache.len();
            cache.clear();
            cache.shrink_to_fit();
            // Each entry: 64-char hex String (~88 bytes) + HashSet overhead (~48 bytes) ≈ 136 bytes
            println!(
                "[Startup] Sync Complete - Dumped NIP-59 Decryption Cache (~{} KB Memory freed)",
                (cache_size * 136) / 1024
            );
        }

        if relay_url.is_none() {
            handle.emit("sync_finished", ()).unwrap();

            // Now that regular sync is complete and chats are loaded, sync MLS groups
            // This ensures chat data is in memory before MLS tries to sync participants
            let handle_clone = handle.clone();
            tokio::task::spawn(async move {
                // Small delay to ensure init_finished has been processed
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                if let Err(e) = crate::cmds::mls_groups::sync_mls_groups_now(None).await {
                    eprintln!("[MLS] Post-sync MLS group sync failed: {}", e);
                }

                // After MLS sync completes, check if weekly VACUUM is needed
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                if let Err(e) = db::check_and_vacuum_if_needed(&handle_clone).await {
                    eprintln!("[Maintenance] Weekly VACUUM check failed: {}", e);
                }
            });
        }
    }
}

/// Removes attachments with empty file hash from all messages
/// Also removes messages that have ONLY corrupted attachments (no content)
/// This cleans up corrupted uploads that resulted in 0-byte files
pub(crate) async fn cleanup_empty_file_attachments<R: Runtime>(handle: &AppHandle<R>, state: &mut ChatState) {
    const EMPTY_FILE_HASH: &str =
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    let mut cleaned_count = 0;
    let mut chats_to_update = Vec::new();

    for chat in &mut state.chats {
        let mut chat_had_changes = false;

        // First pass: remove attachments with empty file hash
        for message in &mut chat.messages {
            let original_count = message.attachments.len();

            // Remove attachments with empty file hash in their URL
            message
                .attachments
                .retain(|attachment| !attachment.url.contains(EMPTY_FILE_HASH));

            let removed = original_count - message.attachments.len();
            if removed > 0 {
                cleaned_count += removed;
                chat_had_changes = true;
            }
        }

        // Second pass: remove messages that are now empty (no content, no attachments)
        let messages_before = chat.messages.len();
        chat.messages
            .retain(|message| !message.content.is_empty() || !message.attachments.is_empty());

        if chat.messages.len() < messages_before {
            chat_had_changes = true;
        }

        // If this chat had changes, save all its messages
        if chat_had_changes {
            chats_to_update.push((chat.id(), chat.messages.clone()));
        }
    }

    // Save updated chats to database
    for (chat_id, messages) in chats_to_update {
        if let Err(e) = save_chat_messages(handle.clone(), &chat_id, &messages).await {
            eprintln!(
                "Failed to save chat after cleaning empty attachments: {}",
                e
            );
        }
    }

    if cleaned_count > 0 {
        eprintln!("Cleaned up {} empty file attachments", cleaned_count);
    }
}

/// Checks if downloaded attachments still exist on the filesystem
/// Sets downloaded=false for any missing files and updates the database
pub(crate) async fn check_attachment_filesystem_integrity<R: Runtime>(
    handle: &AppHandle<R>,
    state: &mut ChatState,
) {
    let mut total_checked = 0;
    let mut chats_with_updates = std::collections::HashMap::new();

    // Capture the starting timestamp
    let start_time = std::time::Instant::now();

    // First pass: count total attachments to check
    let mut total_attachments = 0;
    for chat in &state.chats {
        for message in &chat.messages {
            for attachment in &message.attachments {
                if attachment.downloaded {
                    total_attachments += 1;
                }
            }
        }
    }

    // Iterate through all chats and their messages with mutable access to update downloaded status
    for (chat_idx, chat) in state.chats.iter_mut().enumerate() {
        let mut updated_messages = Vec::new();

        for message in &mut chat.messages {
            let mut message_updated = false;

            for attachment in &mut message.attachments {
                // Only check attachments that are marked as downloaded
                if attachment.downloaded {
                    total_checked += 1;

                    // Emit progress every 2 attachments or on the last one, but only if process has taken >1 second
                    if (total_checked % 2 == 0 || total_checked == total_attachments)
                        && start_time.elapsed().as_secs() >= 1
                    {
                        handle
                            .emit(
                                "progress_operation",
                                serde_json::json!({
                                    "type": "progress",
                                    "current": total_checked,
                                    "total": total_attachments,
                                    "message": "Checking file integrity"
                                }),
                            )
                            .unwrap();
                    }

                    // Check if the file exists on the filesystem
                    let file_path = std::path::Path::new(&attachment.path);
                    if !file_path.exists() {
                        // File is missing, set downloaded to false
                        attachment.downloaded = false;
                        message_updated = true;
                        attachment.path = String::new();
                    }
                }
            }

            // If any attachment in this message was updated, we need to save the message
            if message_updated {
                updated_messages.push(message.clone());
            }
        }

        // If any messages in this chat were updated, store them for database update
        if !updated_messages.is_empty() {
            chats_with_updates.insert(chat_idx, updated_messages);
        }
    }

    // Update database for any messages with missing attachments
    if !chats_with_updates.is_empty() {
        // Only emit progress if process has taken >1 second
        if start_time.elapsed().as_secs() >= 1 {
            handle
                .emit(
                    "progress_operation",
                    serde_json::json!({
                        "type": "progress",
                        "total": chats_with_updates.len(),
                        "current": 0,
                        "message": "Updating database..."
                    }),
                )
                .unwrap();
        }

        // Save updated messages for each chat that had changes
        let mut saved_count = 0;
        let total_chats = chats_with_updates.len();
        for (chat_idx, _updated_messages) in chats_with_updates {
            // Since we're iterating over existing indices, we know the chat exists
            let chat = &state.chats[chat_idx];
            let chat_id = chat.id().clone();

            // Save
            let all_messages = &chat.messages;
            if let Err(e) = save_chat_messages(handle.clone(), &chat_id, all_messages).await {
                eprintln!("Failed to update messages after filesystem check: {}", e);
            } else {
                saved_count += 1;
            }

            // Emit progress for database updates, but only if process has taken >1 second
            if ((saved_count) % 5 == 0 || saved_count == total_chats)
                && start_time.elapsed().as_secs() >= 1
            {
                handle
                    .emit(
                        "progress_operation",
                        serde_json::json!({
                            "type": "progress",
                            "current": saved_count,
                            "total": total_chats,
                            "message": "Updating database"
                        }),
                    )
                    .unwrap();
            }
        }
    }
}

#[tauri::command]
pub(crate) async fn start_typing(receiver: String) -> bool {
    let client = get_nostr_client().expect("Nostr client not initialized");
    let signer = client.signer().await.unwrap();
    let my_public_key = signer.get_public_key().await.unwrap();

    // Check if this is a group chat (group IDs are hex, not bech32)
    match PublicKey::from_bech32(receiver.as_str()) {
        Ok(pubkey) => {
            // This is a DM - use NIP-17 gift wrapping

            // Build and broadcast the Typing Indicator
            let rumor = EventBuilder::new(Kind::ApplicationSpecificData, "typing")
                .tag(Tag::public_key(pubkey))
                .tag(nostr_tags::d_tag(vec!["vector"]))
                .tag(Tag::expiration(Timestamp::from_secs(
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs()
                        + 30,
                )))
                .build(my_public_key);

            // Gift Wrap and send our Typing Indicator to receiver via our Trusted Relay
            // Note: we set a 30-second expiry so that relays can purge typing indicators quickly
            let expiry_time = Timestamp::from_secs(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs()
                    + 30,
            );
            match client
                .gift_wrap_to(
                    trusted_relays::trusted_relays().iter().cloned(),
                    &pubkey,
                    rumor,
                    [Tag::expiration(expiry_time)],
                )
                .await
            {
                Ok(_) => true,
                Err(_) => false,
            }
        }
        Err(_) => {
            // This is a group chat - use MLS
            let group_id = receiver.clone();

            // Build the typing indicator rumor
            let rumor = EventBuilder::new(Kind::ApplicationSpecificData, "typing")
                .tag(nostr_tags::d_tag(vec!["vector"]))
                .tag(Tag::expiration(Timestamp::from_secs(
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs()
                        + 30,
                )))
                .build(my_public_key);

            // Send via MLS
            match mls::send_mls_message(&group_id, rumor, None).await {
                Ok(_) => true,
                Err(_e) => false,
            }
        }
    }
}

/// Get paginated messages for a chat directly from the database
/// Also adds the messages to the backend state for cache synchronization
#[tauri::command]
pub(crate) async fn get_chat_messages_paginated<R: Runtime>(
    handle: AppHandle<R>,
    chat_id: String,
    limit: usize,
    offset: usize,
) -> Result<Vec<Message>, String> {
    // Load messages from database
    let messages = db::get_chat_messages_paginated(&handle, &chat_id, limit, offset).await?;

    // Also add these messages to the backend state for cache synchronization
    // This ensures operations like fetch_msg_metadata can find the messages
    if !messages.is_empty() {
        let mut state = STATE.lock().await;
        if let Some(chat) = state.chats.iter_mut().find(|c| c.id == chat_id) {
            for msg in &messages {
                // Only add if not already present (avoid duplicates)
                if !chat.messages.iter().any(|m| m.id == msg.id) {
                    chat.messages.push(msg.clone());
                }
            }
            // Sort messages by timestamp to maintain order
            chat.messages.sort_by_key(|m| m.at);
        }
    }

    Ok(messages)
}

/// Get the total message count for a chat
#[tauri::command]
pub(crate) async fn get_chat_message_count<R: Runtime>(
    handle: AppHandle<R>,
    chat_id: String,
) -> Result<usize, String> {
    db::get_chat_message_count(&handle, &chat_id).await
}

/// Get message views (composed from events table) for a chat
/// This is the new event-based approach that computes reactions from flat events
#[tauri::command]
pub(crate) async fn get_message_views<R: Runtime>(
    handle: AppHandle<R>,
    chat_id: String,
    limit: usize,
    offset: usize,
    virtual_bucket_filter: Option<String>,
) -> Result<Vec<Message>, String> {
    // Convert chat identifier to database ID (MLS groups: create row if missing so new channels load)
    let chat_int_id = db::resolve_chat_id_for_message_load(&handle, &chat_id)?;

    // Get materialized message views from events
    let messages =
        db::get_message_views(&handle, chat_int_id, limit, offset, virtual_bucket_filter).await?;

    // Sync to backend state for cache compatibility (uses binary search for efficient insertion)
    if !messages.is_empty() {
        let mut state = STATE.lock().await;
        if let Some(chat) = state.chats.iter_mut().find(|c| c.id == chat_id) {
            for msg in messages.iter().cloned() {
                chat.internal_add_message(msg);
            }
        }
    }

    Ok(messages)
}

/// Get messages around a specific message ID (for scrolling to replied-to messages)
/// Loads messages from (target - context_before) to the most recent
#[tauri::command]
pub(crate) async fn get_messages_around_id<R: Runtime>(
    handle: AppHandle<R>,
    chat_id: String,
    target_message_id: String,
    context_before: usize,
) -> Result<Vec<Message>, String> {
    let messages =
        db::get_messages_around_id(&handle, &chat_id, &target_message_id, context_before).await?;

    // Sync to backend state so fetch_msg_metadata and other functions can find these messages
    if !messages.is_empty() {
        let mut state = STATE.lock().await;
        if let Some(chat) = state.chats.iter_mut().find(|c| c.id == chat_id) {
            for msg in messages.iter().cloned() {
                chat.internal_add_message(msg);
            }
        }
    }

    Ok(messages)
}

/// Evict messages from the backend cache for a specific chat
/// Called by frontend when LRU eviction occurs to keep caches in sync
#[tauri::command]
pub(crate) async fn evict_chat_messages(chat_id: String, keep_count: usize) -> Result<(), String> {
    let mut state = STATE.lock().await;
    if let Some(chat) = state.chats.iter_mut().find(|c| c.id == chat_id) {
        let total = chat.messages.len();
        if total > keep_count {
            // Keep only the last `keep_count` messages (most recent)
            let drain_count = total - keep_count;
            chat.messages.drain(0..drain_count);
        }
    }
    Ok(())
}

/// Delete a DM chat and all its messages from the database and in-memory state.
/// chat_id is the other party's npub for DMs. Persists a deletion cutoff so relay
/// replay cannot restore history at or before the delete time.
///
/// Returns as soon as SQLite work finishes. In-memory `STATE` cleanup is best-effort
/// and must not block the invoke when sync holds the lock.
#[tauri::command]
pub(crate) async fn delete_dm_chat<R: Runtime>(handle: AppHandle<R>, chat_id: String) -> Result<(), String> {
    let deleted_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    db::upsert_dm_deletion_cutoff(&handle, &chat_id, deleted_at).await?;
    match db::delete_chat(handle.clone(), &chat_id).await {
        Ok(()) => {}
        Err(e) if e.starts_with("Chat not found:") => {}
        Err(e) => return Err(e),
    }
    drop_dm_chat_from_state(chat_id);
    Ok(())
}

/// Remove a DM from in-memory chats without awaiting a contended `STATE` lock.
pub(crate) fn drop_dm_chat_from_state(chat_id: String) {
    match STATE.try_lock() {
        Ok(mut state) => {
            state.chats.retain(|c| c.id != chat_id);
        }
        Err(_) => {
            tokio::spawn(async move {
                let mut state = STATE.lock().await;
                state.chats.retain(|c| c.id != chat_id);
            });
        }
    }
}

/// Outcome of attempting to process an MLS Welcome extracted from a gift-wrapped rumor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WelcomeOutcome {
    /// `process_welcome` succeeded.
    Processed,
    /// The MDK engine gave a permanent verdict (a known replay error); retrying
    /// will never succeed, so the wrapper can be treated as handled.
    PermanentFailure,
    /// Everything else (MLS service/engine init failure, task join failure, or an
    /// unrecognized `process_welcome` error); may succeed on a later retry.
    TransientFailure,
}

impl WelcomeOutcome {
    /// Whether this outcome should be recorded as permanently handled so historical
    /// resync stops retrying it.
    fn should_mark_handled(self) -> bool {
        matches!(
            self,
            WelcomeOutcome::Processed | WelcomeOutcome::PermanentFailure
        )
    }
}

/// Classify a `process_welcome` error message as permanent (no retry will ever help)
/// or transient (may succeed later). Once a welcome permanently fails (e.g. no
/// matching key package after a seed restore), mdk-core's `process_welcome` refuses
/// to retry it and instead returns `Error::WelcomePreviouslyFailed(reason)` on every
/// later call — Display `"welcome previously failed to process: {reason}"`, with the
/// original failure text interpolated in, so it can only be matched by prefix, never
/// by exact equality (mdk-core 0.8.0's `welcomes.rs`, `process_welcome`'s retry guard).
pub(crate) fn classify_welcome_error(msg: &str) -> WelcomeOutcome {
    const PERMANENT_RETRY_PREFIX: &str = "welcome previously failed to process:";
    if msg.starts_with(PERMANENT_RETRY_PREFIX) {
        WelcomeOutcome::PermanentFailure
    } else {
        WelcomeOutcome::TransientFailure
    }
}

#[cfg(test)]
mod welcome_outcome_tests {
    use super::{classify_welcome_error, WelcomeOutcome};

    #[test]
    fn classifies_welcome_previously_failed_as_permanent() {
        assert_eq!(
            classify_welcome_error(
                "welcome previously failed to process: Error previewing welcome: Welcome(\"No matching key package was found in the key store.\")"
            ),
            WelcomeOutcome::PermanentFailure
        );
    }

    #[test]
    fn classifies_bare_permanent_prefix_with_no_reason_as_permanent() {
        assert_eq!(
            classify_welcome_error("welcome previously failed to process:"),
            WelcomeOutcome::PermanentFailure
        );
    }

    #[test]
    fn classifies_unknown_error_as_transient() {
        assert_eq!(
            classify_welcome_error("database is locked"),
            WelcomeOutcome::TransientFailure
        );
    }

    #[test]
    fn only_processed_and_permanent_failure_should_mark_handled() {
        assert!(WelcomeOutcome::Processed.should_mark_handled());
        assert!(WelcomeOutcome::PermanentFailure.should_mark_handled());
        assert!(!WelcomeOutcome::TransientFailure.should_mark_handled());
    }
}

/// Park the walk and release *both* sync in-flight guards. Every `fetch_messages` path
/// that returns before `record_slice_result` must use this: clearing `is_syncing` alone
/// still refuses every later slice, because `next_sync_slice` bails on `slice_in_flight`.
pub(crate) fn abandon_sync_slice(state: &mut ChatState) {
    state.is_syncing = false;
    state.slice_in_flight = false;
    state.sync_mode = SyncMode::Finished;
    state.sync_empty_iterations = 0;
    state.sync_total_iterations = 0;
}

/// Defer the in-flight slice because the relay pool was empty (or the stream failed with "no
/// relays specified"/"no relays") rather than abandoning it permanently like `abandon_sync_slice`
/// does. Keeps `sync_mode`, `is_syncing`, and the claimed `sync_window_start`/`sync_window_end`
/// untouched, and only releases `slice_in_flight` — so `next_sync_slice` retries the *exact*
/// window on its next call instead of skipping ahead (ForwardSync/BackwardSync/DeepRescan) or
/// requiring the catch-up grace window to elapse again (CatchUp/Finished). A `fetch_messages`
/// call arriving after the deferral is not rejected — it performs the retry itself, which is the
/// point. Exactly one caller can: `next_sync_slice` consumes the flag and re-claims
/// `slice_in_flight` under the same `STATE` mutex, so the deferred window is handed out once and
/// two slices still cannot run at the same time.
/// An empty pool at login/startup must be retryable, not terminal.
pub(crate) fn defer_sync_slice_for_empty_pool(state: &mut ChatState, is_last: bool) {
    state.slice_in_flight = false;
    state.sync_slice_relay_wait = true;
    state.sync_slice_deferred_is_last = is_last;
}

/// True for a relay-pool error whose only defect is having no relays configured yet (nostr-sdk's
/// `NoRelaysSpecified`/"no relays specified" and `NoRelays`/"no relays") — the exact state a
/// fresh login or a startup race leaves the pool in before relay setup completes. Distinct from
/// a real per-relay failure (auth, network, protocol), which should still abandon the slice via
/// `abandon_sync_slice` rather than retry indefinitely.
pub(crate) fn is_empty_relay_pool_error(message: &str) -> bool {
    message.to_lowercase().contains("no relays")
}

#[tauri::command]
pub(crate) async fn handle_event(event: Event, is_new: bool) -> bool {
    // Get the wrapper (giftwrap) event ID for duplicate detection
    let wrapper_event_id = event.id.to_hex();

    // For historical sync events (is_new = false), use the wrapper_id cache for fast duplicate detection
    // For real-time new events (is_new = true), skip cache checks - they're guaranteed to be new
    if !is_new {
        // Check in-memory cache first (O(1) lookup, no SQL overhead)
        // This cache is only populated during init and cleared after sync finishes
        {
            let cache = WRAPPER_ID_CACHE.lock().await;
            if cache.contains(&wrapper_event_id) {
                // Already processed this giftwrap, skip (cache hit)
                return false;
            }
        }

        // Cache miss - check database as fallback (for events older than cache window)
        if let Some(handle) = TAURI_APP.get() {
            if let Ok(exists) = db::wrapper_event_exists(handle, &wrapper_event_id).await {
                if exists {
                    // Already processed this giftwrap, skip (DB hit)
                    return false;
                }
            }
        }
    }

    // Missing client or signer is a transient local condition, not a bad payload: return
    // without a verdict so the wrapper stays retryable instead of unwinding into the
    // intake boundary, which would record it as permanently discarded.
    let Ok(client) = get_nostr_client() else {
        eprintln!(
            "[Intake] Nostr client not initialized; leaving gift wrap {} retryable",
            wrapper_event_id
        );
        return false;
    };
    let Ok(signer) = client.signer().await else {
        eprintln!(
            "[Intake] No signer available; leaving gift wrap {} retryable",
            wrapper_event_id
        );
        return false;
    };
    let Ok(my_public_key) = signer.get_public_key().await else {
        eprintln!(
            "[Intake] Signer has no public key; leaving gift wrap {} retryable",
            wrapper_event_id
        );
        return false;
    };

    // Unwrap the gift wrap
    match client.unwrap_gift_wrap(&event).await {
        Ok(UnwrappedGift { rumor, sender }) => {
            // Check if it's mine
            let is_mine = sender == my_public_key;

            // Attempt to get contact public key (bech32)
            let contact: String = if is_mine {
                // Try to get the first public key from tags
                match rumor.tags.public_keys().next() {
                    Some(pub_key) => match pub_key.to_bech32() {
                        Ok(p_tag_pubkey_bech32) => p_tag_pubkey_bech32,
                        Err(_) => {
                            eprintln!("Failed to convert public key to bech32");
                            // If conversion fails, fall back to sender
                            sender
                                .to_bech32()
                                .expect("Failed to convert sender's public key to bech32")
                        }
                    },
                    None => {
                        eprintln!("No public key tag found");
                        // If no public key found in tags, fall back to sender
                        sender
                            .to_bech32()
                            .expect("Failed to convert sender's public key to bech32")
                    }
                }
            } else {
                // If not is_mine, just use sender's bech32
                sender
                    .to_bech32()
                    .expect("Failed to convert sender's public key to bech32")
            };

            // Special handling for MLS Welcomes (not processed by rumor processor)
            if rumor.kind == Kind::MlsWelcome {
                // Convert rumor Event -> UnsignedEvent
                let unsigned_opt = nostr_sign::unsigned_event_from(&rumor).ok();

                if let Some(unsigned) = unsigned_opt {
                    // Outer giftwrap id is our wrapper id for dedup/logs
                    let wrapper_id = event.id;
                    let app_handle = TAURI_APP.get().cloned();

                    // Use blocking thread for non-Send MLS engine
                    let outcome = tokio::task::spawn_blocking(move || {
                        if app_handle.is_none() {
                            return WelcomeOutcome::TransientFailure;
                        }
                        let handle = app_handle.unwrap();
                        let svc = MlsService::new_persistent(&handle);
                        if let Ok(mls) = svc {
                            if let Ok(engine) = mls.engine() {
                                return match engine.process_welcome(&wrapper_id, &unsigned) {
                                    Ok(_) => WelcomeOutcome::Processed,
                                    Err(e) => {
                                        let msg = e.to_string();
                                        let outcome = classify_welcome_error(&msg);
                                        // Permanent replay errors carry no new information;
                                        // only log genuinely unexpected (transient) failures.
                                        if outcome == WelcomeOutcome::TransientFailure {
                                            eprintln!("[MLS] Failed to process welcome: {}", msg);
                                        }
                                        outcome
                                    }
                                };
                            }
                        }
                        WelcomeOutcome::TransientFailure
                    })
                    .await
                    .unwrap_or(WelcomeOutcome::TransientFailure);

                    // Mark this wrapper event as handled so historical resyncs (every login)
                    // don't re-unwrap and re-attempt it, but only once we have a permanent
                    // verdict (success or a known-permanent MDK replay error). Transient
                    // failures (init/engine/join errors) stay retryable on the next login.
                    if outcome.should_mark_handled() {
                        if let Some(handle) = TAURI_APP.get() {
                            let _ = db::record_discarded_giftwrap(handle, &wrapper_event_id).await;
                        }
                        let mut cache = WRAPPER_ID_CACHE.lock().await;
                        cache.insert(wrapper_event_id.clone());
                    }

                    if outcome == WelcomeOutcome::Processed {
                        // Only notify UI after initial sync is complete
                        // During initial sync, invites are processed but not emitted to avoid UI updates before chats are loaded
                        let should_emit = {
                            let state = STATE.lock().await;
                            state.sync_mode == SyncMode::Finished || !state.is_syncing
                        };

                        if should_emit {
                            if let Some(app) = TAURI_APP.get() {
                                let _ = app.emit(
                                    "mls_invite_received",
                                    serde_json::json!({
                                        "wrapper_event_id": wrapper_id.to_hex()
                                    }),
                                );
                            }
                        }
                        return true;
                    } else {
                        return false;
                    }
                } else {
                    eprintln!("[MLS] Failed to convert rumor to UnsignedEvent");
                    if let Some(handle) = TAURI_APP.get() {
                        let _ = db::record_discarded_giftwrap(handle, &wrapper_event_id).await;
                    }
                    {
                        let mut cache = WRAPPER_ID_CACHE.lock().await;
                        cache.insert(wrapper_event_id.clone());
                    }
                    return false;
                }
            }

            // Local block list: relays still deliver gift wraps; we discard decrypted payloads from this peer.
            if !is_mine {
                let peer_blocked = {
                    let state = STATE.lock().await;
                    state
                        .get_profile(&contact)
                        .map(|p| p.blocked)
                        .unwrap_or(false)
                };
                if peer_blocked {
                    if let Some(handle) = TAURI_APP.get() {
                        let _ = db::record_discarded_giftwrap(&handle, &wrapper_event_id).await;
                    }
                    {
                        let mut cache = WRAPPER_ID_CACHE.lock().await;
                        cache.insert(wrapper_event_id.clone());
                    }
                    return true;
                }
            }

            // DM delete cutoff: ignore wraps at or before the local deletion timestamp
            // (inbound and outbound) so relay replay cannot restore purged history.
            if contact.starts_with("npub1") {
                if let Some(handle) = TAURI_APP.get() {
                    if let Ok(Some(deleted_at)) = db::get_dm_deletion_cutoff(handle, &contact).await
                    {
                        if db::dm_created_at_at_or_before_cutoff(
                            rumor.created_at.as_secs(),
                            deleted_at,
                        ) {
                            let _ = db::record_discarded_giftwrap(handle, &wrapper_event_id).await;
                            {
                                let mut cache = WRAPPER_ID_CACHE.lock().await;
                                cache.insert(wrapper_event_id.clone());
                            }
                            return true;
                        }
                    }
                }
            }

            // Convert rumor to RumorEvent for protocol-agnostic processing
            let rumor_event = RumorEvent {
                id: rumor.id.unwrap(),
                kind: rumor.kind,
                content: rumor.content.clone(),
                tags: rumor.tags.clone(),
                created_at: rumor.created_at,
                pubkey: rumor.pubkey,
            };

            let rumor_context = RumorContext {
                sender,
                is_mine,
                conversation_id: contact.clone(),
                conversation_type: ConversationType::DirectMessage,
            };

            // Process the rumor using our protocol-agnostic processor
            match process_rumor(rumor_event, rumor_context).await {
                Ok(result) => {
                    match result {
                        RumorProcessingResult::TextMessage(mut msg) => {
                            // Set the wrapper event ID for database storage
                            msg.wrapper_event_id = Some(wrapper_event_id.clone());
                            if let Some(handle) = TAURI_APP.get() {
                                match crate::join_inbox::apply_key_share_from_content(
                                    handle,
                                    &msg.content,
                                )
                                .await
                                {
                                    Ok(true) => {
                                        // Join inbox key share consumed; do not persist nsec in the DM timeline.
                                        return true;
                                    }
                                    Ok(false) => {}
                                    Err(e) => {
                                        eprintln!("[join_inbox] key share rejected: {e}");
                                    }
                                }
                            }
                            handle_text_message(msg, &contact, is_mine, is_new, &wrapper_event_id)
                                .await
                        }
                        RumorProcessingResult::FileAttachment(mut msg) => {
                            // Set the wrapper event ID for database storage
                            msg.wrapper_event_id = Some(wrapper_event_id.clone());
                            handle_file_attachment(
                                msg,
                                &contact,
                                is_mine,
                                is_new,
                                &wrapper_event_id,
                            )
                            .await
                        }
                        RumorProcessingResult::Reaction(reaction) => {
                            handle_reaction(reaction, &contact).await
                        }
                        RumorProcessingResult::DashboardPollCreate(_)
                        | RumorProcessingResult::DashboardPollVoteIngested => false,
                        RumorProcessingResult::TypingIndicator { profile_id, until } => {
                            // Update the chat's typing participants
                            let active_typers = {
                                let mut state = STATE.lock().await;
                                // For DMs, the chat_id is the contact's npub
                                if let Some(chat) = state.get_chat_mut(&contact) {
                                    chat.update_typing_participant(profile_id.clone(), until);
                                    chat.get_active_typers()
                                } else {
                                    vec![]
                                }
                            };

                            // Emit typing update event to frontend
                            if let Some(handle) = TAURI_APP.get() {
                                let _ = handle.emit(
                                    "typing-update",
                                    serde_json::json!({
                                        "conversation_id": contact,
                                        "typers": active_typers,
                                    }),
                                );
                            }

                            true
                        }
                        RumorProcessingResult::UnknownEvent(mut event) => {
                            // Store unknown events for future compatibility
                            event.wrapper_event_id = Some(wrapper_event_id.clone());
                            handle_unknown_event(event, &contact).await
                        }
                        RumorProcessingResult::Ignored => false,
                        RumorProcessingResult::Edit {
                            message_id,
                            new_content,
                            edited_at,
                            mut event,
                        } => {
                            // Skip if this edit event was already processed (deduplication)
                            if let Some(handle) = TAURI_APP.get() {
                                if db::event_exists(handle, &event.id).unwrap_or(false) {
                                    return true; // Already processed, skip
                                }

                                // Save edit event to database with proper chat_id
                                if let Ok(chat_id) = db::get_chat_id_by_identifier(handle, &contact)
                                {
                                    event.chat_id = chat_id;
                                }
                                event.wrapper_event_id = Some(wrapper_event_id.clone());
                                let _ = db::save_event(handle, &event).await;
                            }

                            // Update message in state and emit to frontend
                            let mut state = STATE.lock().await;
                            if let Some(chat) = state.get_chat_mut(&contact) {
                                if let Some(msg) = chat.get_message_mut(&message_id) {
                                    msg.apply_edit(new_content, edited_at);

                                    // Emit update to frontend
                                    if let Some(handle) = TAURI_APP.get() {
                                        let _ = handle.emit(
                                            "message_update",
                                            serde_json::json!({
                                                "old_id": &message_id,
                                                "message": &msg,
                                                "chat_id": &contact
                                            }),
                                        );
                                    }
                                }
                            }
                            true
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Failed to process rumor: {}", e);
                    false
                }
            }
        }
        Err(_) => false,
    }
}

/// Display name for a DM peer from in-memory profile cache (fallback: shortened npub).
pub(crate) fn dm_peer_display_name(state: &ChatState, npub: &str) -> String {
    match state.get_profile(npub) {
        Some(p) if !p.nickname.is_empty() => p.nickname.clone(),
        Some(p) if !p.name.is_empty() => p.name.clone(),
        Some(p) if !p.display_name.is_empty() => p.display_name.clone(),
        _ => {
            if npub.len() > 16 {
                format!("{}…{}", &npub[..8], &npub[npub.len() - 4..])
            } else {
                npub.to_string()
            }
        }
    }
}

/// If `content` is a `wallet_tx_announcement` JSON DM, return a role-specific OS notification body; otherwise `None`.
pub(crate) fn wallet_tx_hash_from_announcement_content(content: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(content).ok()?;
    if v.get("type").and_then(|t| t.as_str()) != Some("wallet_tx_announcement") {
        return None;
    }
    let h = v.get("tx_hash").and_then(|t| t.as_str())?;
    Some(h.to_lowercase())
}

pub(crate) fn dm_chat_has_wallet_tx_hash(state: &ChatState, peer_npub: &str, tx_hash_lower: &str) -> bool {
    for chat in &state.chats {
        if chat.chat_type != ChatType::DirectMessage || chat.id != peer_npub {
            continue;
        }
        for m in &chat.messages {
            if let Some(h) = wallet_tx_hash_from_announcement_content(&m.content) {
                if h == tx_hash_lower {
                    return true;
                }
            }
        }
        return false;
    }
    false
}

pub(crate) fn try_wallet_tx_announcement_notify_body(
    content: &str,
    is_mine: bool,
    peer_npub: &str,
    state: &ChatState,
) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(content).ok()?;
    if v.get("type").and_then(|t| t.as_str()) != Some("wallet_tx_announcement") {
        return None;
    }
    let amount = v.get("amount").and_then(|a| a.as_str())?;
    let asset = v.get("asset").and_then(|a| a.as_str())?;
    let peer_name = dm_peer_display_name(state, peer_npub);
    Some(if is_mine {
        format!("You transferred\n{} {}\nto {}", amount, asset, peer_name)
    } else {
        format!("{}\ntransferred\n{} {}\nto you", peer_name, amount, asset)
    })
}

/// Handle a processed text message
pub(crate) async fn handle_text_message(
    mut msg: Message,
    contact: &str,
    is_mine: bool,
    is_new: bool,
    wrapper_event_id: &str,
) -> bool {
    // Check if message already exists in database (important for sync with partial message loading)
    if let Some(handle) = TAURI_APP.get() {
        if let Ok(exists) = db::message_exists_in_db(&handle, &msg.id).await {
            if exists {
                // Message already in DB but we got here (wrapper check passed)
                // Try to backfill the wrapper_event_id for future fast lookups
                // If backfill fails (message already has a different wrapper), add this wrapper to cache
                // to prevent repeated processing of duplicate giftwraps
                if let Ok(updated) =
                    db::update_wrapper_event_id(&handle, &msg.id, wrapper_event_id).await
                {
                    if !updated {
                        // Message has a different wrapper_id - add this duplicate wrapper to cache
                        let mut cache = WRAPPER_ID_CACHE.lock().await;
                        cache.insert(wrapper_event_id.to_string());
                    }
                }
                return false;
            }
        }
    }

    // Shared: parse channel-in-* DM → check user in parent → get pending welcome → accept → emit.
    // Channel-in-squad: if this DM is a channel invite for a squad we're already in, auto-accept
    // on the backend and never show it as an invite (don't add to chat, don't emit message_new).
    if !is_mine {
        if let Some((announcements_group_id, channel_group_id, channel_name)) =
            parse_channel_in_squad_dm(&msg.content)
        {
            if let Some(handle) = TAURI_APP.get() {
                let handle = handle.clone();
                let in_squad = match db::load_mls_groups(&handle).await {
                    Ok(groups) => {
                        let aid = announcements_group_id.to_lowercase();
                        groups.iter().any(|g| {
                            g.group_id.to_lowercase() == aid
                                || g.engine_group_id.to_lowercase() == aid
                        })
                    }
                    Err(_) => false,
                };
                if in_squad {
                    crate::cmds::mls_groups::spawn_accept_channel_welcome_and_emit(
                        announcements_group_id,
                        channel_group_id,
                        channel_name,
                    );
                    return true;
                }
            }
        }
    }

    // Populate reply context before emitting (for replies to old messages not in frontend cache)
    if !msg.replied_to.is_empty() {
        if let Some(handle) = TAURI_APP.get() {
            let _ = db::populate_reply_context(&handle, &mut msg).await;
        }
    }

    if let Some(tx_hash) = wallet_tx_hash_from_announcement_content(&msg.content) {
        let state = STATE.lock().await;
        if dm_chat_has_wallet_tx_hash(&state, contact, &tx_hash) {
            return false;
        }
    }

    // Add the message to the state and handle database save in one operation to avoid multiple locks
    let was_msg_added_to_state = {
        let mut state = STATE.lock().await;
        state.add_message_to_participant(contact, msg.clone())
    };

    // If accepted in-state: commit to the DB and emit to the frontend
    if was_msg_added_to_state {
        // Send it to the frontend
        if let Some(handle) = TAURI_APP.get() {
            handle
                .emit(
                    "message_new",
                    serde_json::json!({
                        "message": &msg,
                        "chat_id": contact
                    }),
                )
                .unwrap();
        }

        // Backfill reply context for any messages that arrived earlier and reference this one.
        // This fixes the race where a bot reply (which references the original message's rumor id)
        // is processed before the user's own outbound message has been persisted under its real id.
        let updated_replies = {
            let mut state = STATE.lock().await;
            if let Some(chat) = state.get_chat_mut(contact) {
                chat.update_replies_to_message(&msg, is_mine)
            } else {
                Vec::new()
            }
        };
        for reply in updated_replies {
            if let Some(handle) = TAURI_APP.get() {
                let reply_id = reply.id.clone();
                let _ = handle.emit(
                    "message_update",
                    serde_json::json!({
                        "old_id": reply_id,
                        "message": reply,
                        "chat_id": contact
                    }),
                );
            }
        }

        // OS notification: incoming DMs, and outgoing `wallet_tx_announcement` (transfer completed)
        if is_new {
            if !is_mine {
                let (level, blocked, single) = {
                    let state = STATE.lock().await;
                    let level = state
                        .get_chat(contact)
                        .map(|c| c.notification_level)
                        .unwrap_or_default();
                    match state.get_profile(contact) {
                        Some(profile) => {
                            let display_name = if !profile.nickname.is_empty() {
                                profile.nickname.clone()
                            } else if !profile.name.is_empty() {
                                profile.name.clone()
                            } else if !profile.display_name.is_empty() {
                                profile.display_name.clone()
                            } else {
                                String::from("New Message")
                            };
                            let body = try_wallet_tx_announcement_notify_body(
                                &msg.content,
                                false,
                                contact,
                                &state,
                            )
                            .unwrap_or_else(|| msg.content.clone());
                            (
                                level,
                                profile.blocked,
                                notification::SingleEventNotification {
                                    title: display_name,
                                    body,
                                },
                            )
                        }
                        None => {
                            let body = try_wallet_tx_announcement_notify_body(
                                &msg.content,
                                false,
                                contact,
                                &state,
                            )
                            .unwrap_or_else(|| msg.content.clone());
                            (
                                level,
                                false,
                                notification::SingleEventNotification {
                                    title: String::from("New Message"),
                                    body,
                                },
                            )
                        }
                    }
                };
                if !blocked {
                    if let Some(handle) = TAURI_APP.get() {
                        let chat_display_name = single.title.clone();
                        notification::emit(
                            handle,
                            notification::EventKind::DirectMessage,
                            level,
                            false,
                            false,
                            contact,
                            &chat_display_name,
                            single,
                        )
                        .await;
                        crate::catch_up::record_admitted_event_for_handle(
                            handle,
                            notification::EventKind::DirectMessage,
                            false,
                            false,
                            contact,
                            &msg.id,
                        )
                        .await;
                    }
                }
            } else if let Some(body) = {
                let state = STATE.lock().await;
                try_wallet_tx_announcement_notify_body(&msg.content, true, contact, &state)
            } {
                if let Some(handle) = TAURI_APP.get() {
                    let level = {
                        let state = STATE.lock().await;
                        state
                            .get_chat(contact)
                            .map(|c| c.notification_level)
                            .unwrap_or_default()
                    };
                    let single = notification::SingleEventNotification {
                        title: "Transfer sent".to_string(),
                        body,
                    };
                    notification::emit(
                        handle,
                        notification::EventKind::DirectMessage,
                        level,
                        false,
                        false,
                        contact,
                        "Transfer sent",
                        single,
                    )
                    .await;
                    crate::catch_up::record_admitted_event_for_handle(
                        handle,
                        notification::EventKind::DirectMessage,
                        false,
                        false,
                        contact,
                        &msg.id,
                    )
                    .await;
                }
            }
        }

        // Save the new message to DB (chat_id = contact npub for DMs)
        if let Some(handle) = TAURI_APP.get() {
            // Only save the single new message (efficient!)
            let _ = db::save_message(handle.clone(), contact, &msg).await;
        }
        // Ensure OS badge is updated immediately after accepting the message
        if let Some(handle) = TAURI_APP.get() {
            let _ = update_unread_counter(handle.clone()).await;
        }
    } else {
        // Message was not added to state (duplicate or filtered)
    }

    was_msg_added_to_state
}

/// Handle a processed file attachment
pub(crate) async fn handle_file_attachment(
    mut msg: Message,
    contact: &str,
    is_mine: bool,
    is_new: bool,
    wrapper_event_id: &str,
) -> bool {
    // Check if message already exists in database (important for sync with partial message loading)
    if let Some(handle) = TAURI_APP.get() {
        if let Ok(exists) = db::message_exists_in_db(&handle, &msg.id).await {
            if exists {
                // Message already in DB but we got here (wrapper check passed)
                // Try to backfill the wrapper_event_id for future fast lookups
                // If backfill fails (message already has a different wrapper), add this wrapper to cache
                // to prevent repeated processing of duplicate giftwraps
                if let Ok(updated) =
                    db::update_wrapper_event_id(&handle, &msg.id, wrapper_event_id).await
                {
                    if !updated {
                        // Message has a different wrapper_id - add this duplicate wrapper to cache
                        let mut cache = WRAPPER_ID_CACHE.lock().await;
                        cache.insert(wrapper_event_id.to_string());
                    }
                }
                return false;
            }
        }
    }

    // Populate reply context before emitting (for replies to old messages not in frontend cache)
    if !msg.replied_to.is_empty() {
        if let Some(handle) = TAURI_APP.get() {
            let _ = db::populate_reply_context(&handle, &mut msg).await;
        }
    }

    // Get file extension for notification
    let extension = msg
        .attachments
        .first()
        .map(|att| att.extension.clone())
        .unwrap_or_else(|| String::from("file"));

    // Add the message to the state and clear typing indicator for sender
    let (was_msg_added_to_state, _active_typers) = {
        let mut state = STATE.lock().await;
        let added = state.add_message_to_participant(contact, msg.clone());

        // Clear typing indicator for the sender (they just sent a message)
        let typers = if let Some(chat) = state.get_chat_mut(contact) {
            chat.update_typing_participant(contact.to_string(), 0); // 0 = clear immediately
            chat.get_active_typers()
        } else {
            Vec::new()
        };

        (added, typers)
    };

    // If accepted in-state: commit to the DB and emit to the frontend
    if was_msg_added_to_state {
        // Send it to the frontend
        if let Some(handle) = TAURI_APP.get() {
            handle
                .emit(
                    "message_new",
                    serde_json::json!({
                        "message": &msg,
                        "chat_id": contact
                    }),
                )
                .unwrap();
        }

        // Send OS notification for incoming files (only after confirming message is new)
        if !is_mine && is_new {
            let (level, blocked, single) = {
                let state = STATE.lock().await;
                let level = state
                    .get_chat(contact)
                    .map(|c| c.notification_level)
                    .unwrap_or_default();
                match state.get_profile(contact) {
                    Some(profile) => {
                        let display_name = if !profile.nickname.is_empty() {
                            profile.nickname.clone()
                        } else if !profile.name.is_empty() {
                            profile.name.clone()
                        } else {
                            String::from("New Message")
                        };
                        let file_description =
                            "Sent a ".to_string() + &get_file_type_description(&extension);
                        (
                            level,
                            profile.blocked,
                            notification::SingleEventNotification {
                                title: display_name,
                                body: file_description,
                            },
                        )
                    }
                    None => {
                        let file_description =
                            "Sent a ".to_string() + &get_file_type_description(&extension);
                        (
                            level,
                            false,
                            notification::SingleEventNotification {
                                title: String::from("New Message"),
                                body: file_description,
                            },
                        )
                    }
                }
            };
            if !blocked {
                if let Some(handle) = TAURI_APP.get() {
                    let chat_display_name = single.title.clone();
                    notification::emit(
                        handle,
                        notification::EventKind::DirectMessage,
                        level,
                        false,
                        false,
                        contact,
                        &chat_display_name,
                        single,
                    )
                    .await;
                    crate::catch_up::record_admitted_event_for_handle(
                        handle,
                        notification::EventKind::DirectMessage,
                        false,
                        false,
                        contact,
                        &msg.id,
                    )
                    .await;
                }
            }
        }

        // Save the new message to DB (chat_id = contact npub for DMs)
        if let Some(handle) = TAURI_APP.get() {
            // Only save the single new message (efficient!)
            let _ = db::save_message(handle.clone(), contact, &msg).await;
        }
        // Ensure OS badge is updated immediately after accepting the attachment
        if let Some(handle) = TAURI_APP.get() {
            let _ = update_unread_counter(handle.clone()).await;
        }
    }

    was_msg_added_to_state
}

/// Handle a processed reaction
pub(crate) async fn handle_reaction(reaction: Reaction, _contact: &str) -> bool {
    // Find the chat containing the referenced message and add the reaction
    // Use a single lock scope to avoid nested locks
    let (reaction_added, chat_id_for_save) = {
        let mut state = STATE.lock().await;
        let reaction_added = if let Some((chat_id, msg_mut)) =
            state.find_chat_and_message_mut(&reaction.reference_id)
        {
            msg_mut.add_reaction(reaction.clone(), Some(chat_id))
        } else {
            // Message not found in any chat - this can happen during sync
            // TODO: track these "ahead" reactions and re-apply them once sync has finished
            false
        };

        // If reaction was added, get the chat_id for saving
        let chat_id_for_save = if reaction_added {
            state
                .find_message(&reaction.reference_id)
                .map(|(chat, _)| chat.id().clone())
        } else {
            None
        };

        (reaction_added, chat_id_for_save)
    };

    // Save the updated message with the new reaction to our DB (outside of state lock)
    if let Some(chat_id) = chat_id_for_save {
        if let Some(handle) = TAURI_APP.get() {
            // Get only the message that was updated
            let updated_message = {
                let state = STATE.lock().await;
                state
                    .find_message(&reaction.reference_id)
                    .map(|(_, msg)| msg.clone())
            };

            if let Some(msg) = updated_message {
                let _ = db::save_message(handle.clone(), &chat_id, &msg).await;
            }
        }
    }

    reaction_added
}

/// Handle an unknown event type - store for future compatibility
pub(crate) async fn handle_unknown_event(mut event: StoredEvent, contact: &str) -> bool {
    // Get the chat_id for this contact
    if let Some(handle) = TAURI_APP.get() {
        match db::get_chat_id_by_identifier(&handle, contact) {
            Ok(chat_id) => {
                event.chat_id = chat_id;
                // Save the event to the database
                if let Err(e) = db::save_event(&handle, &event).await {
                    eprintln!("Failed to save unknown event: {}", e);
                    return false;
                }
                // Emit event to frontend (it can render as "Unknown Event" placeholder)
                let _ = handle.emit(
                    "event_new",
                    serde_json::json!({
                        "event": event,
                        "chat_id": contact
                    }),
                );
                true
            }
            Err(_) => {
                // Chat doesn't exist yet, skip this event
                eprintln!("Cannot save unknown event: chat not found for {}", contact);
                false
            }
        }
    } else {
        false
    }
}

#[tauri::command]
pub(crate) async fn list_group_cursors() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async move {
            let mls = MlsService::new_persistent(&handle).map_err(|e| e.to_string())?;
            let cursors = mls.read_event_cursors().await.map_err(|e| e.to_string())?;
            serde_json::to_value(&cursors).map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Last per-chat counts emitted to the frontend, so `update_unread_counter`
/// can emit only the chats whose count actually changed (R14's single
/// authority, without re-sending every chat on every recompute).
pub(crate) static LAST_UNREAD_COUNTS: std::sync::LazyLock<Mutex<std::collections::HashMap<String, u32>>> =
    std::sync::LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));

/// Guards against scheduling more than one pending debounced recompute at
/// once (KTD9): a burst of MLS messages spawns a single delayed task, not
/// one per message.
pub(crate) static UNREAD_RECOMPUTE_PENDING: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Debounce window for the MLS-arrival recompute path. The DM arrival path
/// and explicit actions (mark-as-read, a level change) call
/// `update_unread_counter` directly instead, so they are never delayed by
/// this window (R17's "moves badges in the same interaction").
pub(crate) const UNREAD_RECOMPUTE_DEBOUNCE: std::time::Duration = std::time::Duration::from_millis(500);

/// Returns the entries in `current` that differ from `last` (added, or a
/// changed value) plus a zero entry for every id in `last` no longer in
/// `current`. Pure and STATE-independent so the "only changed chats" and
/// "removed chats zero out" contracts are unit-testable without a database
/// or app handle.
pub(crate) fn diff_unread_counts(
    last: &std::collections::HashMap<String, u32>,
    current: &std::collections::HashMap<String, u32>,
) -> std::collections::HashMap<String, u32> {
    let mut changed: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    for (chat_id, count) in current {
        if last.get(chat_id) != Some(count) {
            changed.insert(chat_id.clone(), *count);
        }
    }
    for chat_id in last.keys() {
        if !current.contains_key(chat_id) {
            changed.insert(chat_id.clone(), 0);
        }
    }
    changed
}

/// Immediate (non-debounced) recompute: updates the OS dock badge with the
/// total and emits `unread_counts_changed` with only the per-chat entries
/// whose count changed since the last emission. Every explicit caller
/// (mark-as-read, a notification-level change) wants this path; the MLS
/// arrival handler instead goes through `schedule_debounced_unread_recompute`.
#[tauri::command]
pub(crate) async fn update_unread_counter<R: Runtime>(handle: AppHandle<R>) -> u32 {
    // Get the count of unread messages from the state
    let (unread_count, counts_by_chat) = {
        let state = STATE.lock().await;
        let counts_by_chat = state.unread_counts_by_chat();
        let unread_count: u32 = counts_by_chat.values().sum();
        (unread_count, counts_by_chat)
    };

    // Emit only the chats whose count changed (added, removed, or a
    // different value) since the last emission.
    {
        let mut last = LAST_UNREAD_COUNTS.lock().await;
        let changed = diff_unread_counts(&last, &counts_by_chat);
        if !changed.is_empty() {
            let _ = handle.emit("unread_counts_changed", &changed);
        }
        *last = counts_by_chat;
    }

    // Get the main window
    if let Some(window) = handle.get_webview_window("main") {
        if unread_count > 0 {
            // Platform-specific badge/overlay handling
            #[cfg(target_os = "windows")]
            {
                // On Windows, use overlay icon instead of badge
                let icon = tauri::include_image!("./icons/icon_badge_notification.png");
                let _ = window.set_overlay_icon(Some(icon));
            }

            #[cfg(not(any(target_os = "windows", target_os = "ios", target_os = "android")))]
            {
                // On macOS, Linux, etc. use the badge if available
                let _ = window.set_badge_count(Some(unread_count as i64));
            }
        } else {
            // Clear badge/overlay when no unread messages
            #[cfg(target_os = "windows")]
            {
                // Remove the overlay icon on Windows
                let _ = window.set_overlay_icon(None);
            }

            #[cfg(not(any(target_os = "windows", target_os = "ios", target_os = "android")))]
            {
                // Clear the badge on other platforms
                let _ = window.set_badge_count(None);
            }
        }
    }

    unread_count
}

/// Debounced recompute for the MLS arrival path (R18, KTD9): the walk
/// contends with the rumor loop for the same global lock, and squad
/// traffic is far heavier than DM traffic, so a recompute per message would
/// put contention on a hot path. A burst inside the window collapses into
/// one recompute at its end.
pub(crate) fn schedule_debounced_unread_recompute<R: Runtime>(handle: AppHandle<R>) {
    if UNREAD_RECOMPUTE_PENDING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return; // already scheduled
    }
    tokio::spawn(async move {
        tokio::time::sleep(UNREAD_RECOMPUTE_DEBOUNCE).await;
        UNREAD_RECOMPUTE_PENDING.store(false, std::sync::atomic::Ordering::SeqCst);
        let _ = update_unread_counter(handle).await;
    });
}

/// Full per-chat unread map, for the frontend's single hydrate call (R14) —
/// no `startsWith('npub1')` filter, no client-side counting.
#[tauri::command]
pub(crate) async fn get_unread_counts() -> std::collections::HashMap<String, u32> {
    let state = STATE.lock().await;
    state.unread_counts_by_chat()
}

#[cfg(test)]
mod unread_diff_and_debounce_tests {
    use super::*;
    use std::collections::HashMap;

    fn map(pairs: &[(&str, u32)]) -> HashMap<String, u32> {
        pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
    }

    #[test]
    fn diff_reports_only_added_and_changed_entries() {
        let last = map(&[("a", 1), ("b", 2)]);
        let current = map(&[("a", 1), ("b", 3), ("c", 5)]);
        let changed = diff_unread_counts(&last, &current);
        assert_eq!(changed, map(&[("b", 3), ("c", 5)]));
    }

    #[test]
    fn diff_zeroes_out_entries_removed_from_current() {
        let last = map(&[("a", 1), ("b", 2)]);
        let current = map(&[("a", 1)]);
        let changed = diff_unread_counts(&last, &current);
        assert_eq!(changed, map(&[("b", 0)]));
    }

    #[test]
    fn diff_is_empty_when_nothing_changed() {
        let last = map(&[("a", 1), ("b", 2)]);
        let current = map(&[("a", 1), ("b", 2)]);
        assert!(diff_unread_counts(&last, &current).is_empty());
    }

    fn test_handle() -> AppHandle<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap()
            .handle()
            .clone()
    }

    #[tokio::test]
    async fn burst_of_calls_collapses_into_one_pending_recompute() {
        UNREAD_RECOMPUTE_PENDING.store(false, std::sync::atomic::Ordering::SeqCst);
        let handle = test_handle();

        schedule_debounced_unread_recompute(handle.clone());
        assert!(UNREAD_RECOMPUTE_PENDING.load(std::sync::atomic::Ordering::SeqCst));

        // A second call while one is already pending must not schedule another.
        schedule_debounced_unread_recompute(handle.clone());
        assert!(UNREAD_RECOMPUTE_PENDING.load(std::sync::atomic::Ordering::SeqCst));

        // Once the debounce window elapses and the recompute runs, the guard clears.
        tokio::time::sleep(UNREAD_RECOMPUTE_DEBOUNCE + std::time::Duration::from_millis(300)).await;
        assert!(!UNREAD_RECOMPUTE_PENDING.load(std::sync::atomic::Ordering::SeqCst));
    }
}

/// Parse DM content as channel_in_squad payload; returns (announcements_group_id, channel_group_id, channel_name) if valid.
pub(crate) fn parse_channel_in_squad_dm(content: &str) -> Option<(String, String, String)> {
    let v: serde_json::Value = serde_json::from_str(content).ok()?;
    let obj = v.as_object()?;
    if obj.get("type").and_then(|t| t.as_str()) != Some("channel_in_squad") {
        return None;
    }
    let announcements = obj.get("announcementsGroupId").and_then(|s| s.as_str())?;
    let channel = obj.get("channelGroupId").and_then(|s| s.as_str())?;
    let name = obj.get("channelName").and_then(|s| s.as_str())?;
    Some((
        announcements.to_string(),
        channel.to_string(),
        name.to_string(),
    ))
}
