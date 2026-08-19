//! One tier-aware notification emit, replacing the three duplicated mute
//! gates and seven scattered `show_notification_generic` call sites (KTD4).
//!
//! Leaf per KTD11: takes the already-resolved app handle as a parameter
//! rather than fetching `crate::TAURI_APP` itself, so this module has no
//! initialization-ordering dependency on `lib.rs`.
//!
//! Generic over `R: Runtime` (rather than the concrete `AppHandle` alias
//! `lib.rs` uses) purely so it is testable against `tauri::test::mock_app`,
//! which produces an `AppHandle<MockRuntime>` — the same shape session.rs's
//! `emit_session_warning_to_handle` uses for the same reason.

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_notification::NotificationExt;

use crate::chat::NotificationLevel;
use crate::notification::severity::{resolve_tier, EventKind, Tier};

use super::coalesce;

/// What a non-collapsed Interrupt banner says: the shape a single event —
/// or a mention preempting a pending summary — keeps today (sender/chat
/// name + real content). Only the *collapsed* summary banner is
/// content-constrained (see `coalesce::flush`) — that constraint is a
/// privacy boundary, not a copy choice: banner content leaves the app's
/// encryption envelope and lands in OS notification centers, lock screens,
/// and system logs.
#[derive(Debug, Clone)]
pub struct SingleEventNotification {
    pub title: String,
    pub body: String,
}

/// Resolve the tier for one event and, if it is Interrupt, route it through
/// the coalescer. Record and Passive return immediately — no banner, no
/// sound, no coalescer bookkeeping. Every notification-producing call site
/// in `lib.rs` routes through this single entry point instead of building
/// notification data and calling the OS helper directly.
///
/// `chat_id` keys the coalescer (KTD2: per chat, never per sender).
/// `chat_display_name` is what a *collapsed* summary banner shows if this
/// event ends up joining a burst.
#[allow(clippy::too_many_arguments)]
pub async fn emit<R: Runtime>(
    handle: &AppHandle<R>,
    kind: EventKind,
    level: NotificationLevel,
    is_own: bool,
    mention_hit: bool,
    chat_id: &str,
    chat_display_name: &str,
    single: SingleEventNotification,
) {
    let tier = resolve_tier(kind, level, is_own, mention_hit);
    if tier != Tier::Interrupt {
        return;
    }

    // Ahead of the coalescer: a focused window costs nothing at all, not
    // even a coalescer entry.
    if window_focused(handle) {
        return;
    }

    if mention_hit {
        // R12: a mention preempts any pending generic summary for its chat
        // so it is never buried in a collapsed count.
        coalesce::preempt_and_emit(handle.clone(), chat_id, single).await;
    } else {
        coalesce::register_interrupt(
            handle.clone(),
            chat_id.to_string(),
            chat_display_name.to_string(),
            single,
        )
        .await;
    }
}

/// True when the app's main webview currently has focus. Shared by `emit`
/// (the ahead-of-coalescer gate) and `coalesce` (the flush-time and
/// preempt-time re-checks).
pub(super) fn window_focused<R: Runtime>(handle: &AppHandle<R>) -> bool {
    handle
        .webview_windows()
        .iter()
        .next()
        .map(|(_, window)| window.is_focused().unwrap_or(false))
        .unwrap_or(false)
}

/// Show the OS banner. Never propagates a failure — KTD12: a notification
/// failure is logged and skipped, never surfaced to whatever triggered it.
pub(super) fn send_banner<R: Runtime>(handle: &AppHandle<R>, title: &str, body: &str) {
    handle
        .notification()
        .builder()
        .title(title)
        .body(body)
        .large_body(body)
        .show()
        .unwrap_or_else(|e| eprintln!("Failed to send notification: {}", e));

    // Sound fires once per emitted banner, not once per collapsed event
    // (R6: the per-chat level gates sound too, not only the global mute
    // switch — `play_notification_if_enabled` reads the global mute
    // setting and the banner above is unaffected by it, matching R3's
    // "mute silences sound without affecting counts").
    #[cfg(desktop)]
    {
        let handle_clone = handle.clone();
        std::thread::spawn(move || {
            if let Err(e) = crate::audio::play_notification_if_enabled(&handle_clone) {
                eprintln!("Failed to play notification sound: {}", e);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notification::severity::EventKind;
    use NotificationLevel::*;

    fn test_handle() -> AppHandle<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .plugin(tauri_plugin_notification::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap()
            .handle()
            .clone()
    }

    fn single(body: &str) -> SingleEventNotification {
        SingleEventNotification {
            title: "Chat".to_string(),
            body: body.to_string(),
        }
    }

    #[tokio::test]
    async fn record_tier_never_reaches_the_coalescer() {
        let handle = test_handle();
        // Ordinary group message at Mentions-only resolves Record, not
        // Interrupt — emit() must return before touching the coalescer.
        emit(
            &handle,
            EventKind::GroupMessage,
            Mentions,
            false,
            false,
            "chat-record",
            "Chat",
            single("hi"),
        )
        .await;

        assert!(!coalesce::has_window("chat-record").await);
    }

    #[tokio::test]
    async fn passive_tier_never_reaches_the_coalescer() {
        let handle = test_handle();
        emit(
            &handle,
            EventKind::GroupMessage,
            All,
            true,
            false,
            "chat-passive",
            "Chat",
            single("hi"),
        )
        .await;

        assert!(!coalesce::has_window("chat-passive").await);
    }

    #[tokio::test]
    async fn own_events_never_interrupt_regardless_of_level() {
        let handle = test_handle();
        for level in [Nothing, Mentions, All] {
            emit(
                &handle,
                EventKind::DirectMessage,
                level,
                true,
                false,
                "chat-own",
                "Chat",
                single("hi"),
            )
            .await;
        }

        assert!(!coalesce::has_window("chat-own").await);
    }

    #[tokio::test]
    async fn interrupt_tier_opens_a_coalescer_window() {
        let handle = test_handle();
        emit(
            &handle,
            EventKind::DirectMessage,
            Mentions,
            false,
            false,
            "chat-interrupt",
            "Chat",
            single("hi"),
        )
        .await;

        assert!(coalesce::has_window("chat-interrupt").await);
    }

    #[tokio::test]
    async fn a_mention_never_opens_a_pending_window_it_emits_immediately_instead() {
        let handle = test_handle();
        emit(
            &handle,
            EventKind::GroupMessage,
            Mentions,
            false,
            true,
            "chat-mention",
            "Chat",
            single("hi"),
        )
        .await;

        // A mention preempts rather than joining a window (R12) — it never
        // leaves a pending entry of its own behind.
        assert!(!coalesce::has_window("chat-mention").await);
    }
}
