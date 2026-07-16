use std::sync::{Arc, LazyLock};
use parking_lot::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use secrecy::{ExposeSecret, SecretBox};
use tauri::Emitter;
use tokio::task::JoinHandle;

/// Default idle auto-lock timeout (15 minutes). Override via the
/// `session_idle_timeout_ms` setting in the account settings table.
const DEFAULT_IDLE_TIMEOUT_MS: u64 = 900_000;

/// High-level session state.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SessionState {
    Locked,
    Unlocked,
}

/// Payload returned by `check_session`.
#[derive(serde::Serialize)]
pub struct SessionStatus {
    pub unlocked: bool,
    pub locked_at: Option<u64>,
}

struct TimerState {
    handle: JoinHandle<()>,
}

struct InnerState {
    key: Option<SecretBox<[u8; 32]>>,
    last_activity: Instant,
    locked_at: Option<SystemTime>,
    timer: Option<TimerState>,
    timeout_ms: u64,
}

/// Owns the secret encryption key, the last-activity timestamp, and the idle
/// auto-lock timer. A single global instance is exposed via `SESSION_MANAGER`
/// and the thin `set_encryption_key`/`clear_encryption_key` wrappers.
#[derive(Clone)]
pub struct SessionManager {
    state: Arc<Mutex<InnerState>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(InnerState {
                key: None,
                last_activity: Instant::now(),
                locked_at: None,
                timer: None,
                timeout_ms: DEFAULT_IDLE_TIMEOUT_MS,
            })),
        }
    }

    pub fn set_timeout_ms(&self, timeout_ms: u64) {
        let mut state = self.state.lock();
        state.timeout_ms = timeout_ms;
    }

    pub fn timeout_ms(&self) -> u64 {
        let state = self.state.lock();
        state.timeout_ms
    }

    /// Store the encryption key, mark the session unlocked, and start the
    /// idle timer. On Unix desktops, attempts to lock the key pages into
    /// memory; failures are logged, reported to the UI via `session_warning`,
    /// and ignored so the unlock still succeeds.
    pub fn set_key(&self, key: [u8; 32]) {
        let mut state = self.state.lock();
        let secret = SecretBox::new(Box::new(key));

        #[cfg(all(desktop, unix))]
        {
            let bytes = secret.expose_secret();
            let ptr = bytes.as_ptr();
            let len = bytes.len();
            // SAFETY: ptr/len describe the in-heap SecretBox allocation.
            unsafe {
                if libc::mlock(ptr as *const libc::c_void, len) != 0 {
                    use std::sync::atomic::{AtomicBool, Ordering};
                    static HAS_LOGGED: AtomicBool = AtomicBool::new(false);
                    if !HAS_LOGGED.swap(true, Ordering::Relaxed) {
                        eprintln!("[Session] Failed to mlock encryption key pages; continuing without memory locking");
                    }
                    self.emit_session_warning("memory_lock_failed");
                }
            }
        }

        state.key = Some(secret);
        state.locked_at = None;
        state.last_activity = Instant::now();
        self.spawn_timer_locked(&mut state);
    }

    /// Zeroize the encryption key and cancel the idle timer. The SecretBox
    /// zeroizes the bytes on drop. On Unix desktops, best-effort `munlock` is
    /// attempted before the key is dropped.
    pub fn clear(&self) {
        let mut state = self.state.lock();
        if let Some(secret) = state.key.take() {
            #[cfg(all(desktop, unix))]
            {
                let bytes = secret.expose_secret();
                let ptr = bytes.as_ptr();
                let len = bytes.len();
                // SAFETY: ptr/len describe the same in-heap allocation passed to mlock.
                unsafe {
                    let _ = libc::munlock(ptr as *const libc::c_void, len);
                }
            }
            state.locked_at = Some(SystemTime::now());
        }
        if let Some(timer) = state.timer.take() {
            timer.handle.abort();
        }
    }

    pub fn is_unlocked(&self) -> bool {
        let state = self.state.lock();
        state.key.is_some()
    }

    pub fn session_state(&self) -> SessionState {
        let state = self.state.lock();
        if state.key.is_some() {
            SessionState::Unlocked
        } else {
            SessionState::Locked
        }
    }

    /// Reset the idle timer. No-op if the session is not currently unlocked.
    pub fn heartbeat(&self) {
        let mut state = self.state.lock();
        if state.key.is_none() {
            return;
        }
        state.last_activity = Instant::now();
        self.spawn_timer_locked(&mut state);
    }

    /// Change the idle timeout to `duration` and restart the timer (if the
    /// session is currently unlocked).
    pub fn lock_after_idle(&self, duration: Duration) {
        self.set_timeout_ms(duration.as_millis() as u64);
        self.heartbeat();
    }

    pub fn current_key(&self) -> Option<[u8; 32]> {
        let state = self.state.lock();
        state.key.as_ref().map(|secret| *secret.expose_secret())
    }

    pub fn locked_at_epoch_ms(&self) -> Option<u64> {
        let state = self.state.lock();
        state.locked_at.map(|t| {
            t.duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64
        })
    }

    fn spawn_timer_locked(&self, state: &mut InnerState) {
        if let Some(timer) = state.timer.take() {
            timer.handle.abort();
        }

        // Tests that run outside a tokio runtime can still call set_key/heartbeat
        // without panicking; the timer only spawns when a runtime is present.
        let runtime_available = tokio::runtime::Handle::try_current().is_ok();
        if !runtime_available {
            return;
        }

        let timeout_ms = state.timeout_ms;
        // NOTE: The timeout value is captured here at spawn time. If
        // set_timeout_ms() changes while this timer is running, the new value
        // only takes effect on the next heartbeat() call, which aborts this
        // task and spawns a fresh one.
        let started_at = state.last_activity;
        let manager = self.clone();
        let handle = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(timeout_ms)).await;
            if manager.last_activity_after(started_at) {
                return;
            }
            manager.clear();
            manager.emit_locked();
        });
        state.timer = Some(TimerState { handle });
    }

    fn last_activity_after(&self, instant: Instant) -> bool {
        let state = self.state.lock();
        state.last_activity > instant
    }

    fn emit_locked(&self) {
        if let Some(handle) = crate::TAURI_APP.get() {
            let _ = handle.emit("session_locked", ());
        }
    }

    fn emit_session_warning(&self, warning: &str) {
        if let Some(handle) = crate::TAURI_APP.get() {
            emit_session_warning_to_handle(handle, warning);
        }
    }
}

fn emit_session_warning_to_handle<R: tauri::Runtime>(handle: &tauri::AppHandle<R>, warning: &str) {
    let _ = handle.emit(
        "session_warning",
        serde_json::json!({ "warning": warning }),
    );
}

/// Global session manager used by the rest of the crate.
pub static SESSION_MANAGER: LazyLock<SessionManager> =
    LazyLock::new(SessionManager::new);

/// Store the encryption key in the secret session container.
pub fn set_encryption_key(key: [u8; 32]) {
    SESSION_MANAGER.set_key(key);
}

/// Clear the encryption key from the session container.
pub fn clear_encryption_key() {
    SESSION_MANAGER.clear();
}

/// Return a copy of the current encryption key, if one is loaded.
pub fn current_encryption_key() -> Option<[u8; 32]> {
    SESSION_MANAGER.current_key()
}

/// Reset the idle timer. Sensitive commands call this at entry.
pub fn heartbeat() {
    SESSION_MANAGER.heartbeat();
}

/// Configure the idle timeout in milliseconds.
pub fn set_timeout_ms(timeout_ms: u64) {
    SESSION_MANAGER.set_timeout_ms(timeout_ms);
}

/// Return the current session state for the frontend.
#[tauri::command]
pub fn check_session() -> SessionStatus {
    let unlocked = SESSION_MANAGER.is_unlocked();
    let locked_at = if unlocked {
        None
    } else {
        SESSION_MANAGER.locked_at_epoch_ms()
    };
    SessionStatus { unlocked, locked_at }
}

/// Reset the idle timer from the frontend.
#[tauri::command]
pub fn session_heartbeat() {
    SESSION_MANAGER.heartbeat();
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::Listener;

    use tokio::time::{sleep, Duration as TokioDuration};

    #[test]
    fn session_set_and_clear() {
        let manager = SessionManager::new();
        assert_eq!(manager.session_state(), SessionState::Locked);
        assert!(!manager.is_unlocked());

        manager.set_key([1u8; 32]);
        assert_eq!(manager.session_state(), SessionState::Unlocked);
        assert!(manager.is_unlocked());
        assert!(manager.current_key().is_some());

        manager.clear();
        assert_eq!(manager.session_state(), SessionState::Locked);
        assert!(!manager.is_unlocked());
        assert!(manager.current_key().is_none());
        assert!(manager.locked_at_epoch_ms().is_some());
    }

    #[tokio::test]
    async fn heartbeat_resets_idle_timer() {
        let manager = SessionManager::new();
        manager.set_timeout_ms(100);
        manager.set_key([2u8; 32]);
        assert!(manager.is_unlocked());

        // Wait long enough that the timer would fire, but heartbeat before it does.
        sleep(TokioDuration::from_millis(60)).await;
        manager.heartbeat();
        sleep(TokioDuration::from_millis(60)).await;
        assert!(
            manager.is_unlocked(),
            "heartbeat should reset the idle timer"
        );

        // Wait longer than the full timeout without activity.
        sleep(TokioDuration::from_millis(150)).await;
        assert!(
            !manager.is_unlocked(),
            "session should auto-lock after idle timeout"
        );
    }

    #[tokio::test]
    async fn multiple_heartbeats_do_not_create_multiple_timers() {
        let manager = SessionManager::new();
        manager.set_timeout_ms(100);
        manager.set_key([3u8; 32]);

        // Rapid heartbeats should only leave one active timer.
        for _ in 0..10 {
            manager.heartbeat();
        }

        sleep(TokioDuration::from_millis(150)).await;
        assert!(
            !manager.is_unlocked(),
            "only the most recent timer should fire"
        );
    }

    #[test]
    fn logout_clears_session() {
        let manager = SessionManager::new();
        manager.set_key([4u8; 32]);
        assert!(manager.is_unlocked());

        manager.clear();
        assert!(!manager.is_unlocked());
        assert!(manager.current_key().is_none());
        assert!(manager.locked_at_epoch_ms().is_some());
    }

    #[test]
    fn check_session_reports_locked_and_unlocked() {
        // Operate on the global session manager like the command does.
        // Force a key cycle so locked_at is set even if the global manager was
        // already locked at the start of this test.
        set_encryption_key([7u8; 32]);
        clear_encryption_key();
        let locked = check_session();
        assert!(!locked.unlocked);
        assert!(locked.locked_at.is_some());

        set_encryption_key([7u8; 32]);
        let unlocked = check_session();
        assert!(unlocked.unlocked);
        assert!(unlocked.locked_at.is_none());

        clear_encryption_key();
        let locked = check_session();
        assert!(!locked.unlocked);
        assert!(locked.locked_at.is_some());
    }

    #[test]
    fn emits_session_warning_event() {
        let app = tauri::test::mock_app();
        let (tx, rx) = std::sync::mpsc::channel::<serde_json::Value>();
        let tx = std::sync::Mutex::new(tx);
        let _ = app.handle().listen("session_warning", move |event| {
            if let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) {
                let _ = tx.lock().unwrap().send(payload);
            }
        });

        emit_session_warning_to_handle(app.handle(), "memory_lock_failed");

        let payload = rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .expect("session_warning event should be emitted");
        assert_eq!(payload["warning"].as_str(), Some("memory_lock_failed"));
    }
}
