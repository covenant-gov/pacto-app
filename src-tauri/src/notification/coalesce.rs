//! Per-chat burst coalescing for Interrupt-tier notifications (R11, R12;
//! KTD1, KTD2). The OS notification plugin carries an `id` field but never
//! uses it for banner replacement on any desktop platform, and grouping is
//! Android-only (KTD1), so collapsing a burst into one banner has to happen
//! here rather than in the OS.
//!
//! State machine (chat-keyed, per KTD2 — never sender-keyed):
//!
//! ```text
//! Idle --> Open: first Interrupt for a chat opens a window
//! Open --> Open: further Interrupts increment the pending count
//! Open --> Flushed: window elapses -> one banner carrying the count
//! Open --> Preempted: a mention arrives -> pending summary dropped,
//!                      the mention's own banner emits at once
//! ```
//!
//! Holds its own state (`WINDOWS`) rather than reaching into `crate::STATE`
//! — this is the module's own bookkeeping, not a `lib.rs` global (KTD11).
//! The map's value type carries no `AppHandle`, so it stays non-generic
//! even though the functions below are generic over `R: Runtime` (needed
//! for testability against `tauri::test::mock_app`); each `AppHandle<R>`
//! is only ever captured by a per-call spawned task, never stored in the
//! shared map.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::LazyLock;

use tauri::{AppHandle, Runtime};
use tokio::sync::Mutex as TokioMutex;
use tokio::time::Duration;

use super::emit::{send_banner, window_focused, SingleEventNotification};

/// Coalescing window length. A single named constant per the plan — short
/// enough that the added latency on a DM is imperceptible, tunable without
/// touching the state machine.
const COALESCE_WINDOW: Duration = Duration::from_secs(4);

struct ChatWindow {
    pending_count: u32,
    generation: u64,
    /// The first event's own banner, used verbatim if the window closes
    /// having seen only that one event (no collapsing needed).
    single: SingleEventNotification,
}

static WINDOWS: LazyLock<TokioMutex<HashMap<String, ChatWindow>>> =
    LazyLock::new(|| TokioMutex::new(HashMap::new()));
static NEXT_GENERATION: AtomicU64 = AtomicU64::new(0);

/// Register a non-mention Interrupt for `chat_id`. Opens a window on the
/// first call for a chat (spawning the flush task that owns emission) or
/// increments the pending count of an already-open window. Never emits
/// synchronously — the spawned flush task does that when the window closes.
pub async fn register_interrupt<R: Runtime>(
    handle: AppHandle<R>,
    chat_id: String,
    chat_display_name: String,
    single: SingleEventNotification,
) {
    let mut windows = WINDOWS.lock().await;
    if let Some(window) = windows.get_mut(&chat_id) {
        window.pending_count += 1;
        return;
    }

    let generation = NEXT_GENERATION.fetch_add(1, Ordering::Relaxed);
    windows.insert(
        chat_id.clone(),
        ChatWindow {
            pending_count: 1,
            generation,
            single,
        },
    );
    drop(windows);

    tokio::spawn(async move {
        tokio::time::sleep(COALESCE_WINDOW).await;
        flush(handle, chat_id, chat_display_name, generation).await;
    });
}

/// A mention arrived for `chat_id`. Drop any pending summary for this chat
/// (its flush task, if one is scheduled, will see a generation mismatch and
/// no-op) and emit the mention's own banner immediately, subject to its own
/// focus check (a member who has since focused the app should not still get
/// banner + sound for a message they may already be looking at).
pub async fn preempt_and_emit<R: Runtime>(
    handle: AppHandle<R>,
    chat_id: &str,
    single: SingleEventNotification,
) {
    {
        let mut windows = WINDOWS.lock().await;
        windows.remove(chat_id);
    }

    if window_focused(&handle) {
        return;
    }
    send_banner(&handle, &single.title, &single.body);
}

async fn flush<R: Runtime>(
    handle: AppHandle<R>,
    chat_id: String,
    chat_display_name: String,
    generation: u64,
) {
    let window = {
        let mut windows = WINDOWS.lock().await;
        match windows.get(&chat_id) {
            Some(w) if w.generation == generation => windows.remove(&chat_id),
            _ => None, // preempted, or (defensively) already flushed
        }
    };
    let Some(window) = window else { return };

    // Re-checked at flush per the coalescer's acceptance scenario: a window
    // that opens unfocused but flushes after the app regains focus emits
    // nothing — the member has since seen the chat.
    if window_focused(&handle) {
        return;
    }

    if window.pending_count <= 1 {
        send_banner(&handle, &window.single.title, &window.single.body);
    } else {
        send_banner(
            &handle,
            &chat_display_name,
            &format!("{} new messages", window.pending_count),
        );
    }
}

/// Test-only introspection so `emit`'s tests can assert on coalescer state
/// without reaching into this module's private map directly.
#[cfg(test)]
pub(crate) async fn has_window(chat_id: &str) -> bool {
    WINDOWS.lock().await.contains_key(chat_id)
}

#[cfg(test)]
mod tests {
    use super::*;

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
            title: "Test Chat".to_string(),
            body: body.to_string(),
        }
    }

    /// The `tauri::test` mock runtime cannot observe a delivered OS banner,
    /// so these tests assert on the coalescer's own bookkeeping (window
    /// presence and pending_count) — the state that emission is driven by.
    #[tokio::test]
    async fn six_rapid_interrupts_leave_one_window_with_count_six() {
        // Covers AE2's setup: a burst collapses into a single pending window.
        let handle = test_handle();
        let chat_id = "chat-burst".to_string();

        for _ in 0..6 {
            register_interrupt(
                handle.clone(),
                chat_id.clone(),
                "Burst Chat".to_string(),
                single("hi"),
            )
            .await;
        }

        let windows = WINDOWS.lock().await;
        let window = windows.get(&chat_id).expect("window should still be open");
        assert_eq!(window.pending_count, 6);
    }

    #[tokio::test]
    async fn interrupts_for_different_chats_open_separate_windows() {
        // KTD2: the collapse key is the chat, not the sender — two chats
        // must never share one window.
        let handle = test_handle();
        register_interrupt(
            handle.clone(),
            "chat-a".to_string(),
            "A".to_string(),
            single("hi"),
        )
        .await;
        register_interrupt(
            handle.clone(),
            "chat-b".to_string(),
            "B".to_string(),
            single("hi"),
        )
        .await;

        let windows = WINDOWS.lock().await;
        assert!(windows.contains_key("chat-a"));
        assert!(windows.contains_key("chat-b"));
    }

    #[tokio::test]
    async fn preempt_removes_the_pending_window() {
        let handle = test_handle();
        let chat_id = "chat-preempt".to_string();
        register_interrupt(
            handle.clone(),
            chat_id.clone(),
            "Chat".to_string(),
            single("hi"),
        )
        .await;
        {
            let windows = WINDOWS.lock().await;
            assert!(windows.contains_key(&chat_id));
        }

        preempt_and_emit(handle, &chat_id, single("mention")).await;

        let windows = WINDOWS.lock().await;
        assert!(
            !windows.contains_key(&chat_id),
            "preemption must drop the pending window"
        );
    }

    #[tokio::test]
    async fn window_flushes_and_clears_after_its_duration() {
        let handle = test_handle();
        let chat_id = "chat-flush".to_string();
        register_interrupt(
            handle.clone(),
            chat_id.clone(),
            "Chat".to_string(),
            single("hi"),
        )
        .await;

        tokio::time::sleep(COALESCE_WINDOW + Duration::from_millis(200)).await;

        let windows = WINDOWS.lock().await;
        assert!(
            !windows.contains_key(&chat_id),
            "a flushed window must not linger"
        );
    }

    #[tokio::test]
    async fn an_event_arriving_after_flush_opens_a_fresh_window() {
        let handle = test_handle();
        let chat_id = "chat-refresh".to_string();
        register_interrupt(
            handle.clone(),
            chat_id.clone(),
            "Chat".to_string(),
            single("first"),
        )
        .await;
        tokio::time::sleep(COALESCE_WINDOW + Duration::from_millis(200)).await;

        register_interrupt(
            handle.clone(),
            chat_id.clone(),
            "Chat".to_string(),
            single("second"),
        )
        .await;

        let windows = WINDOWS.lock().await;
        let window = windows
            .get(&chat_id)
            .expect("a new window should have opened");
        assert_eq!(
            window.pending_count, 1,
            "the closed window's count must not carry over"
        );
    }
}
