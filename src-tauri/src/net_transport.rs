//! Shared outbound-transport gate for the "Route Traffic Through Tor"
//! preference.
//!
//! Disabled by default. When enabled, an embedded Arti client bootstraps and
//! serves a loopback-only SOCKS5 proxy; every reqwest client this crate
//! builds and the Nostr relay pool point at that proxy instead of connecting
//! directly. Both call [`http_client_builder`] / [`nostr_connection_mode`]
//! fresh per use rather than caching a client, so a toggle takes effect on
//! the next connection without a process restart.
//!
//! [`http_client_builder`] fails closed: if Tor is supposed to be active but
//! the local proxy can't be wired into the client, callers get an error
//! instead of an unproxied `reqwest::Client` that would leak the request.
//! A failed bootstrap at login behaves the same way -- traffic stays direct
//! (never silently "half-Tor'd"), the failure is recorded in
//! [`TorStatusDto::startup_error`], and a bounded background retry
//! re-attempts the bootstrap a couple of times. See `apply_persisted_setting`.
//!
//! See docs/privacy/TOR_TRANSPORT.md.

use std::collections::VecDeque;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::LazyLock;
use std::time::Instant;

use nostr_sdk::prelude::ConnectionMode;
use parking_lot::Mutex;
use tauri::Runtime;

/// Per-account SQL setting key (see `db::get_sql_setting` / `set_sql_setting`).
pub const SETTING_KEY: &str = "route_traffic_through_tor";

/// In-memory mirror of the persisted setting, applied at login and updated
/// by `set_tor_routing_enabled`.
static TOR_ENABLED: AtomicBool = AtomicBool::new(false);

/// Set when a login-time (or automatic retry) bootstrap attempt fails while
/// the persisted preference is on. Cleared on the next successful `enable()`.
/// Surfaced via [`TorStatusDto::startup_error`] so the UI can explain why
/// `enabled` reads `false` despite the user having turned the setting on,
/// instead of the frontend trusting the raw persisted value and showing a
/// toggle that's on while traffic is actually direct.
static LOGIN_BOOTSTRAP_ERROR: Mutex<Option<String>> = Mutex::new(None);

/// Cap on connect-latency samples kept for the rolling average shown in the
/// status popover -- recent circuit connects, not a lifetime history.
const LATENCY_SAMPLE_CAP: usize = 20;

/// Live traffic/latency counters for the embedded Tor client, updated by the
/// SOCKS relay loop in `tor::serve_socks_connection`. Reset whenever routing
/// transitions from disabled to enabled (`mark_enabled`), so the figures
/// always read "since Tor was last turned on" rather than accumulating
/// across an earlier session.
struct TorStats {
    bytes_up: AtomicU64,
    bytes_down: AtomicU64,
    active_connections: AtomicU64,
    enabled_at: Mutex<Option<Instant>>,
    recent_connect_latencies_ms: Mutex<VecDeque<u64>>,
}

static TOR_STATS: LazyLock<TorStats> = LazyLock::new(|| TorStats {
    bytes_up: AtomicU64::new(0),
    bytes_down: AtomicU64::new(0),
    active_connections: AtomicU64::new(0),
    enabled_at: Mutex::new(None),
    recent_connect_latencies_ms: Mutex::new(VecDeque::new()),
});

impl TorStats {
    fn mark_enabled(&self) {
        self.bytes_up.store(0, Ordering::SeqCst);
        self.bytes_down.store(0, Ordering::SeqCst);
        self.active_connections.store(0, Ordering::SeqCst);
        self.recent_connect_latencies_ms.lock().clear();
        *self.enabled_at.lock() = Some(Instant::now());
    }

    fn mark_disabled(&self) {
        *self.enabled_at.lock() = None;
    }

    fn add_bytes(&self, up: u64, down: u64) {
        self.bytes_up.fetch_add(up, Ordering::Relaxed);
        self.bytes_down.fetch_add(down, Ordering::Relaxed);
    }

    fn record_latency_ms(&self, ms: u64) {
        let mut samples = self.recent_connect_latencies_ms.lock();
        if samples.len() >= LATENCY_SAMPLE_CAP {
            samples.pop_front();
        }
        samples.push_back(ms);
    }

    /// Increments the live connection count and returns a guard that
    /// decrements it on drop -- including on early return or panic inside
    /// `serve_socks_connection` -- so an errored stream never leaks a
    /// phantom connection in the popover.
    fn connection_started(&self) -> TorConnectionGuard<'_> {
        self.active_connections.fetch_add(1, Ordering::SeqCst);
        TorConnectionGuard { stats: self }
    }
}

struct TorConnectionGuard<'a> {
    stats: &'a TorStats,
}

impl Drop for TorConnectionGuard<'_> {
    fn drop(&mut self) {
        self.stats.active_connections.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Whether Tor routing is the active transport mode right now.
pub fn is_enabled() -> bool {
    TOR_ENABLED.load(Ordering::SeqCst)
}

/// Connection mode the Nostr relay pool should use for newly added relays.
/// Falls back to direct if Tor is disabled, unavailable on this build
/// (`tor` feature off, e.g. Android), or not yet bootstrapped.
pub fn nostr_connection_mode() -> ConnectionMode {
    match active_socks_addr() {
        Some(addr) => ConnectionMode::proxy(addr),
        None => ConnectionMode::direct(),
    }
}

/// A `reqwest::ClientBuilder` pre-wired for the current transport mode.
/// Callers still set their own timeouts / user agent / etc. Every call site
/// that previously called `reqwest::Client::builder()` directly should call
/// this instead so Tor gating stays centralized.
///
/// Returns `Err` instead of a bare builder if Tor routing is enabled and
/// bootstrapped but the local SOCKS proxy can't be attached to the client --
/// sending the request unproxied in that state would defeat the setting.
pub fn http_client_builder() -> Result<reqwest::ClientBuilder, String> {
    let builder = reqwest::Client::builder();
    match active_socks_addr() {
        Some(addr) => reqwest::Proxy::all(format!("socks5h://{addr}"))
            .map(|proxy| builder.proxy(proxy))
            .map_err(|e| {
                format!("Tor routing is enabled but the local proxy could not be configured: {e}")
            }),
        None => Ok(builder),
    }
}

/// `Some(addr)` only once Tor routing is enabled *and* the embedded client's
/// local SOCKS proxy has finished bootstrapping. Crate-visible (not just
/// `http_client_builder`'s internal use) because `evm/rpc/provider.rs`
/// needs the raw address too: alloy's JSON-RPC HTTP client pulls in a
/// different major `reqwest` version than the rest of this crate, so it
/// can't share a `ClientBuilder` built by `http_client_builder` and
/// configures its own proxy from this address instead.
pub(crate) fn active_socks_addr() -> Option<SocketAddr> {
    if !is_enabled() {
        return None;
    }
    #[cfg(all(not(target_os = "android"), feature = "tor"))]
    {
        tor::bootstrapped_addr()
    }
    #[cfg(not(all(not(target_os = "android"), feature = "tor")))]
    {
        None
    }
}

/// Snapshot of live Tor routing status for the settings toggle and the
/// nav-bar status popover. `bootstrapped`/`bootstrap_fraction`/
/// `blocked_reason` reflect the embedded client's own health (it can
/// degrade after initial bootstrap, e.g. on a network change). `enabled`
/// is the live transport state (`is_enabled()`), not the raw persisted
/// preference -- see `startup_error` below for when they disagree.
#[derive(serde::Serialize, Clone, Debug)]
pub struct TorStatusDto {
    /// False on builds without the `tor` feature (e.g. Android), where
    /// routing can never be enabled.
    pub available: bool,
    pub enabled: bool,
    pub bootstrapped: bool,
    pub bootstrap_fraction: f32,
    pub blocked_reason: Option<String>,
    pub active_connections: u64,
    pub bytes_up: u64,
    pub bytes_down: u64,
    pub avg_connect_latency_ms: Option<u64>,
    pub enabled_seconds: Option<u64>,
    /// Set when the persisted preference is on but the most recent bootstrap
    /// attempt (at login or during an automatic retry) failed. `enabled` is
    /// the source of truth for whether traffic is actually routed through
    /// Tor right now; this only explains why it can read `false` despite the
    /// user having turned the setting on.
    pub startup_error: Option<String>,
}

#[tauri::command]
pub fn get_tor_status() -> TorStatusDto {
    let enabled_seconds = TOR_STATS.enabled_at.lock().map(|at| at.elapsed().as_secs());
    let avg_connect_latency_ms = {
        let samples = TOR_STATS.recent_connect_latencies_ms.lock();
        if samples.is_empty() {
            None
        } else {
            Some(samples.iter().sum::<u64>() / samples.len() as u64)
        }
    };

    #[cfg(all(not(target_os = "android"), feature = "tor"))]
    let (available, bootstrapped, bootstrap_fraction, blocked_reason) = match tor::bootstrap_info()
    {
        Some(info) => (true, info.ready_for_traffic, info.fraction, info.blocked_reason),
        None => (true, false, 0.0, None),
    };
    #[cfg(not(all(not(target_os = "android"), feature = "tor")))]
    let (available, bootstrapped, bootstrap_fraction, blocked_reason) = (false, false, 0.0, None);

    TorStatusDto {
        available,
        enabled: is_enabled(),
        bootstrapped,
        bootstrap_fraction,
        blocked_reason,
        active_connections: TOR_STATS.active_connections.load(Ordering::SeqCst),
        bytes_up: TOR_STATS.bytes_up.load(Ordering::Relaxed),
        bytes_down: TOR_STATS.bytes_down.load(Ordering::Relaxed),
        avg_connect_latency_ms,
        enabled_seconds,
        startup_error: LOGIN_BOOTSTRAP_ERROR.lock().clone(),
    }
}

/// Read the persisted per-account setting and apply it. Called once after
/// account login/switch, before the relay pool is first populated, so the
/// first `connect()` already uses the right connection mode.
///
/// A bootstrap failure here is not fatal to login, but it is not silently
/// "fine" either: `TOR_ENABLED` stays `false` (traffic goes direct, exactly
/// as if routing were off -- never a half-proxied state), the failure is
/// recorded so `get_tor_status().startup_error` can surface it, and
/// [`spawn_login_bootstrap_retry`] re-attempts the bootstrap a couple of
/// times with backoff before giving up (the user can also just toggle the
/// setting off and back on to retry immediately).
pub async fn apply_persisted_setting<R: Runtime>(app: &tauri::AppHandle<R>) {
    let enabled = crate::db::get_sql_setting(app.clone(), SETTING_KEY.to_string())
        .unwrap_or(None)
        .map(|v| v == "true")
        .unwrap_or(false);

    if !enabled {
        TOR_ENABLED.store(false, Ordering::SeqCst);
        *LOGIN_BOOTSTRAP_ERROR.lock() = None;
        return;
    }

    if let Err(e) = enable(app).await {
        eprintln!("[Tor] Failed to bootstrap embedded Tor client at login: {e}");
        *LOGIN_BOOTSTRAP_ERROR.lock() = Some(e);
        spawn_login_bootstrap_retry(app.clone());
    }
}

/// Retries a failed login-time bootstrap a couple of times with backoff.
/// Bails out early if routing already ended up enabled through another path
/// (e.g. the user manually toggled it on while a retry was pending) or the
/// user disabled the preference before a retry fires -- a retry must never
/// resurrect a setting the user explicitly turned off in the meantime.
fn spawn_login_bootstrap_retry<R: Runtime>(app: tauri::AppHandle<R>) {
    #[cfg(all(not(target_os = "android"), feature = "tor"))]
    {
        tokio::spawn(async move {
            const RETRY_DELAYS: [std::time::Duration; 2] = [
                std::time::Duration::from_secs(10),
                std::time::Duration::from_secs(30),
            ];
            for delay in RETRY_DELAYS {
                tokio::time::sleep(delay).await;
                if is_enabled() {
                    return;
                }
                let still_wanted =
                    crate::db::get_sql_setting(app.clone(), SETTING_KEY.to_string())
                        .unwrap_or(None)
                        .map(|v| v == "true")
                        .unwrap_or(false);
                if !still_wanted {
                    return;
                }
                match enable(&app).await {
                    Ok(()) => {
                        crate::rebuild_relay_pool_connection_mode(&app).await;
                        return;
                    }
                    Err(e) => {
                        eprintln!("[Tor] Retry failed to bootstrap embedded Tor client: {e}");
                        *LOGIN_BOOTSTRAP_ERROR.lock() = Some(e);
                    }
                }
            }
        });
    }
    #[cfg(not(all(not(target_os = "android"), feature = "tor")))]
    {
        let _ = app;
    }
}

/// Persist and apply the "Route Traffic Through Tor" setting. Bootstraps (on
/// enable) or tears down the embedded client (on disable), then rebuilds the
/// live Nostr relay pool -- if logged in -- so already-open relay connections
/// pick up the new mode without restarting the app.
#[tauri::command]
pub async fn set_tor_routing_enabled<R: Runtime>(
    handle: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<(), String> {
    let was_enabled = is_enabled();

    if enabled {
        enable(&handle).await?;
    } else {
        TOR_ENABLED.store(false, Ordering::SeqCst);
        TOR_STATS.mark_disabled();
        shutdown_embedded_client();
    }

    if let Err(e) = crate::db::set_sql_setting(
        handle.clone(),
        SETTING_KEY.to_string(),
        enabled.to_string(),
    ) {
        // Persistence failed: undo the in-memory transport change so it
        // matches what's actually saved (and what the frontend's optimistic
        // toggle reverts to on this error) instead of drifting from it.
        if enabled {
            TOR_ENABLED.store(false, Ordering::SeqCst);
            TOR_STATS.mark_disabled();
            shutdown_embedded_client();
        } else if was_enabled {
            let _ = enable(&handle).await;
        }
        return Err(e);
    }

    crate::rebuild_relay_pool_connection_mode(&handle).await;

    Ok(())
}

/// Bootstraps the embedded Arti client + local SOCKS proxy (idempotent; a
/// second call while already bootstrapped is a no-op) and marks Tor routing
/// enabled. Errors when the `tor` feature isn't compiled in (e.g. Android).
#[cfg_attr(
    not(all(not(target_os = "android"), feature = "tor")),
    allow(unused_variables)
)]
async fn enable<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    #[cfg(all(not(target_os = "android"), feature = "tor"))]
    {
        tor::ensure_bootstrapped(app).await?;
        TOR_ENABLED.store(true, Ordering::SeqCst);
        TOR_STATS.mark_enabled();
        *LOGIN_BOOTSTRAP_ERROR.lock() = None;
        Ok(())
    }
    #[cfg(not(all(not(target_os = "android"), feature = "tor")))]
    {
        Err("Tor routing is not available on this build".to_string())
    }
}

/// Stops the local SOCKS listener and drops the embedded Tor client so
/// disabling routing actually stops it instead of leaving it running (and
/// the loopback listener reachable) in the background until process exit.
fn shutdown_embedded_client() {
    #[cfg(all(not(target_os = "android"), feature = "tor"))]
    tor::shutdown();
}

#[cfg(all(not(target_os = "android"), feature = "tor"))]
mod tor {
    use std::net::SocketAddr;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::time::Duration;

    use arti_client::config::{CfgPath, TorClientConfigBuilder};
    use arti_client::{DangerouslyIntoTorAddr, TorClient, TorClientConfig};
    use fast_socks5::server::Socks5ServerProtocol;
    use fast_socks5::util::target_addr::TargetAddr;
    use fast_socks5::{ReplyError, Socks5Command};
    use tauri::{Manager, Runtime};
    use tokio::net::{TcpListener, TcpStream};
    use tokio::task::JoinHandle;
    use tor_rtcompat::PreferredRuntime;

    /// Time budget for the initial Tor circuit bootstrap. Arti retries
    /// directory fetches with its own backoff rather than failing fast, so
    /// without a cap a censored/offline network can hang `enable()` --
    /// and with it `login` / `set_tor_routing_enabled` -- indefinitely.
    const BOOTSTRAP_TIMEOUT: Duration = Duration::from_secs(90);

    /// Backoff applied to the local SOCKS listener's accept loop after a
    /// transient `accept()` error (e.g. temporary fd exhaustion), so a
    /// persistent error condition degrades to a bounded retry rate instead
    /// of a hot spin.
    const ACCEPT_ERROR_BASE_BACKOFF: Duration = Duration::from_millis(50);
    const ACCEPT_ERROR_MAX_BACKOFF: Duration = Duration::from_secs(5);
    /// After this many consecutive `accept()` errors the listener is treated
    /// as unrecoverable (e.g. its underlying fd was closed) and the loop
    /// shuts itself down rather than spinning forever.
    const MAX_CONSECUTIVE_ACCEPT_ERRORS: u32 = 10;

    /// Live embedded-client state: the bootstrapped `TorClient`, the local
    /// SOCKS listener's address, and a handle to its accept-loop task. Every
    /// field is `None` until the first successful bootstrap, and reset back
    /// to `None` by [`shutdown`] when routing is disabled so "off" actually
    /// stops the client and closes the listener rather than leaving both
    /// running in the background.
    struct TorState {
        client: Option<Arc<TorClient<PreferredRuntime>>>,
        socks_addr: Option<SocketAddr>,
        accept_task: Option<JoinHandle<()>>,
    }

    static STATE: parking_lot::Mutex<TorState> = parking_lot::Mutex::new(TorState {
        client: None,
        socks_addr: None,
        accept_task: None,
    });

    /// Serializes calls to [`ensure_bootstrapped`] so two concurrent enable
    /// attempts (e.g. the settings toggle and the nav-bar popover) can't
    /// both start a bootstrap. Never held across the `STATE` lock.
    static BOOTSTRAP_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    /// The local SOCKS proxy address, once bootstrap has completed.
    pub(super) fn bootstrapped_addr() -> Option<SocketAddr> {
        STATE.lock().socks_addr
    }

    /// Snapshot of the embedded client's bootstrap health, if it has been
    /// initialized at least once this process.
    pub(super) struct BootstrapInfo {
        pub(super) ready_for_traffic: bool,
        pub(super) fraction: f32,
        pub(super) blocked_reason: Option<String>,
    }

    pub(super) fn bootstrap_info() -> Option<BootstrapInfo> {
        let state = STATE.lock();
        let client = state.client.as_ref()?;
        let status = client.bootstrap_status();
        Some(BootstrapInfo {
            ready_for_traffic: status.ready_for_traffic(),
            fraction: status.as_frac(),
            blocked_reason: status.blocked().map(|b| b.to_string()),
        })
    }

    /// Bootstraps the embedded Tor client and starts the local SOCKS5
    /// listener if either isn't already running. Returns once both are
    /// ready to accept connections.
    pub(super) async fn ensure_bootstrapped<R: Runtime>(
        app: &tauri::AppHandle<R>,
    ) -> Result<(), String> {
        let _guard = BOOTSTRAP_LOCK.lock().await;

        if STATE.lock().client.is_some() {
            return Ok(());
        }

        let data_dir = arti_data_dir(app)?;
        let client = tokio::time::timeout(BOOTSTRAP_TIMEOUT, init_tor_client(data_dir))
            .await
            .map_err(|_| "Timed out waiting for the Tor circuit to bootstrap".to_string())?
            .map_err(|e| format!("Failed to bootstrap Tor: {e}"))?;

        let (addr, task) = start_socks_proxy(client.clone())
            .await
            .map_err(|e| format!("Failed to start local Tor proxy: {e}"))?;

        let mut state = STATE.lock();
        state.client = Some(client);
        state.socks_addr = Some(addr);
        state.accept_task = Some(task);
        Ok(())
    }

    /// Stops the local SOCKS listener and drops the embedded Tor client so
    /// disabling routing stops its background activity (circuit building,
    /// directory fetches) instead of leaving it running until process exit.
    /// A later `enable()` re-bootstraps from scratch.
    pub(super) fn shutdown() {
        let mut state = STATE.lock();
        if let Some(task) = state.accept_task.take() {
            task.abort();
        }
        state.socks_addr = None;
        state.client = None;
    }

    fn arti_data_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
        app.path()
            .app_data_dir()
            .map(|dir| dir.join("tor"))
            .map_err(|e| format!("Failed to resolve app data dir: {e}"))
    }

    async fn init_tor_client(data_dir: PathBuf) -> Result<Arc<TorClient<PreferredRuntime>>, String> {
        let mut config = TorClientConfigBuilder::default();

        // .onion relays (ConnectionTarget::Onion) resolve over the same client.
        config.address_filter().allow_onion_addrs(true);

        let cache_dir = CfgPath::new(path_string(&data_dir.join("cache")));
        let state_dir = CfgPath::new(path_string(&data_dir.join("state")));
        config.storage().cache_dir(cache_dir).state_dir(state_dir);

        let config: TorClientConfig = config.build().map_err(|e| e.to_string())?;
        TorClient::builder()
            .config(config)
            .create_bootstrapped()
            .await
            .map_err(|e| e.to_string())
    }

    fn path_string(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    /// Binds a loopback-only, ephemeral-port SOCKS5 listener and spawns its
    /// accept loop. Every accepted connection is proxied through the given,
    /// already-bootstrapped Tor client.
    async fn start_socks_proxy(
        client: Arc<TorClient<PreferredRuntime>>,
    ) -> Result<(SocketAddr, JoinHandle<()>), String> {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|e| format!("Failed to bind local SOCKS listener: {e}"))?;
        let addr = listener
            .local_addr()
            .map_err(|e| format!("Failed to read local SOCKS listener address: {e}"))?;

        let task = tokio::spawn(async move {
            let mut consecutive_errors: u32 = 0;
            loop {
                match listener.accept().await {
                    Ok((socket, _)) => {
                        consecutive_errors = 0;
                        let client = client.clone();
                        tokio::spawn(async move {
                            if let Err(e) = serve_socks_connection(socket, client).await {
                                log::debug!(target: "pacto", "[Tor] SOCKS connection ended: {e}");
                            }
                        });
                    }
                    Err(e) => {
                        consecutive_errors += 1;
                        log::warn!(target: "pacto", "[Tor] Local SOCKS listener accept error: {e}");
                        if consecutive_errors >= MAX_CONSECUTIVE_ACCEPT_ERRORS {
                            log::error!(
                                target: "pacto",
                                "[Tor] Local SOCKS listener failing repeatedly ({consecutive_errors} consecutive errors); shutting it down"
                            );
                            let mut state = STATE.lock();
                            state.accept_task = None;
                            state.socks_addr = None;
                            state.client = None;
                            return;
                        }
                        let backoff = ACCEPT_ERROR_BASE_BACKOFF
                            .saturating_mul(1u32 << consecutive_errors.min(6))
                            .min(ACCEPT_ERROR_MAX_BACKOFF);
                        tokio::time::sleep(backoff).await;
                    }
                }
            }
        });

        Ok((addr, task))
    }

    /// Handles a single client connection to the local SOCKS5 proxy: performs
    /// the (unauthenticated, loopback-only) SOCKS5 handshake, dials the
    /// requested target through the embedded Tor client, and then relays
    /// bytes bidirectionally until either side closes.
    async fn serve_socks_connection(
        socket: TcpStream,
        client: Arc<TorClient<PreferredRuntime>>,
    ) -> Result<(), String> {
        let _conn_guard = super::TOR_STATS.connection_started();

        let (proto, cmd, target_addr) = Socks5ServerProtocol::accept_no_auth(socket)
            .await
            .map_err(|e| e.to_string())?
            .read_command()
            .await
            .map_err(|e| e.to_string())?;

        if cmd != Socks5Command::TCPConnect {
            let _ = proto.reply_error(&ReplyError::CommandNotSupported).await;
            return Err(format!("unsupported SOCKS command: {cmd:?}"));
        }

        let connect_started = std::time::Instant::now();
        let tor_stream = match &target_addr {
            TargetAddr::Ip(addr) => {
                let tor_addr = addr
                    .into_tor_addr_dangerously()
                    .map_err(|e| e.to_string())?;
                client.connect(tor_addr).await
            }
            TargetAddr::Domain(host, port) => client.connect((host.as_str(), *port)).await,
        };

        let mut tor_stream = match tor_stream {
            Ok(stream) => {
                super::TOR_STATS.record_latency_ms(connect_started.elapsed().as_millis() as u64);
                stream
            }
            Err(e) => {
                let _ = proto.reply_error(&ReplyError::HostUnreachable).await;
                return Err(e.to_string());
            }
        };

        // The bound address in a SOCKS5 success reply is informational only
        // for a CONNECT proxy; clients (reqwest, async-wsocket) don't act on
        // it, so an unspecified address is fine here.
        let bind_addr: SocketAddr = "0.0.0.0:0".parse().expect("valid socket addr literal");
        let mut inbound = proto
            .reply_success(bind_addr)
            .await
            .map_err(|e| e.to_string())?;

        // `tokio::io::copy_bidirectional` is what `fast_socks5::server::transfer`
        // wraps internally; calling it directly gets us the byte counts each
        // direction copied, which double as the traffic figures for the status
        // popover.
        match tokio::io::copy_bidirectional(&mut inbound, &mut tor_stream).await {
            Ok((up, down)) => super::TOR_STATS.add_bytes(up, down),
            Err(e) => log::debug!(target: "pacto", "[Tor] transfer error: {e}"),
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `TOR_ENABLED` / `TOR_STATS` are process-wide statics; serialize tests
    /// that touch them so a thread-per-test runner (`cargo test`, unlike
    /// `cargo nextest`'s process-per-test) can't interleave them.
    static TEST_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

    #[test]
    fn disabled_by_default() {
        let _guard = TEST_LOCK.lock();
        assert!(!is_enabled());
    }

    #[test]
    fn direct_mode_when_disabled() {
        let _guard = TEST_LOCK.lock();
        TOR_ENABLED.store(false, Ordering::SeqCst);
        assert_eq!(nostr_connection_mode(), ConnectionMode::direct());
    }

    #[test]
    fn http_client_builder_succeeds_when_disabled() {
        let _guard = TEST_LOCK.lock();
        TOR_ENABLED.store(false, Ordering::SeqCst);
        // No proxy configured: building a bare client must succeed.
        assert!(http_client_builder().unwrap().build().is_ok());
    }

    #[test]
    fn direct_mode_when_enabled_but_not_yet_bootstrapped() {
        let _guard = TEST_LOCK.lock();
        // Enabling the flag alone (without a running SOCKS proxy) must never
        // silently claim Tor routing is active -- callers fall back to
        // direct rather than pointing at a proxy that isn't listening.
        TOR_ENABLED.store(true, Ordering::SeqCst);
        let mode = nostr_connection_mode();
        TOR_ENABLED.store(false, Ordering::SeqCst);
        assert_eq!(mode, ConnectionMode::direct());
    }

    #[test]
    fn tor_stats_marks_enabled_and_resets_counters() {
        let _guard = TEST_LOCK.lock();
        TOR_STATS.add_bytes(100, 200);
        TOR_STATS.record_latency_ms(50);
        TOR_STATS.mark_enabled();
        assert_eq!(TOR_STATS.bytes_up.load(Ordering::SeqCst), 0);
        assert_eq!(TOR_STATS.bytes_down.load(Ordering::SeqCst), 0);
        assert!(TOR_STATS.recent_connect_latencies_ms.lock().is_empty());
        assert!(TOR_STATS.enabled_at.lock().is_some());
        TOR_STATS.mark_disabled();
        assert!(TOR_STATS.enabled_at.lock().is_none());
    }

    #[test]
    fn tor_stats_add_bytes_accumulates() {
        let _guard = TEST_LOCK.lock();
        TOR_STATS.mark_enabled();
        TOR_STATS.add_bytes(10, 20);
        TOR_STATS.add_bytes(5, 5);
        assert_eq!(TOR_STATS.bytes_up.load(Ordering::SeqCst), 15);
        assert_eq!(TOR_STATS.bytes_down.load(Ordering::SeqCst), 25);
        TOR_STATS.mark_disabled();
    }

    #[test]
    fn tor_stats_connection_guard_tracks_active_count() {
        let _guard = TEST_LOCK.lock();
        TOR_STATS.mark_enabled();
        assert_eq!(TOR_STATS.active_connections.load(Ordering::SeqCst), 0);
        {
            let _conn = TOR_STATS.connection_started();
            assert_eq!(TOR_STATS.active_connections.load(Ordering::SeqCst), 1);
        }
        assert_eq!(TOR_STATS.active_connections.load(Ordering::SeqCst), 0);
        TOR_STATS.mark_disabled();
    }

    #[test]
    fn tor_stats_latency_samples_cap_and_evict_oldest() {
        let _guard = TEST_LOCK.lock();
        TOR_STATS.mark_enabled();
        for ms in 1..=(LATENCY_SAMPLE_CAP as u64 + 5) {
            TOR_STATS.record_latency_ms(ms);
        }
        let samples = TOR_STATS.recent_connect_latencies_ms.lock();
        assert_eq!(samples.len(), LATENCY_SAMPLE_CAP);
        // The oldest samples (1..=5) are evicted once the cap is exceeded.
        assert_eq!(*samples.front().unwrap(), 6);
        drop(samples);
        TOR_STATS.mark_disabled();
    }

    #[test]
    fn get_tor_status_reflects_disabled_state() {
        let _guard = TEST_LOCK.lock();
        TOR_ENABLED.store(false, Ordering::SeqCst);
        TOR_STATS.mark_disabled();
        let status = get_tor_status();
        assert!(!status.enabled);
        assert_eq!(status.enabled_seconds, None);
    }

    #[test]
    fn get_tor_status_reports_avg_latency_and_enabled_seconds_once_enabled() {
        let _guard = TEST_LOCK.lock();
        TOR_ENABLED.store(true, Ordering::SeqCst);
        TOR_STATS.mark_enabled();
        TOR_STATS.record_latency_ms(100);
        TOR_STATS.record_latency_ms(200);
        let status = get_tor_status();
        assert!(status.enabled);
        assert_eq!(status.avg_connect_latency_ms, Some(150));
        assert!(status.enabled_seconds.is_some());
        TOR_ENABLED.store(false, Ordering::SeqCst);
        TOR_STATS.mark_disabled();
    }
}
