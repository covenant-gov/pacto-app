//! Shared outbound-transport gate for the "Route Traffic Through Tor"
//! preference (#173).
//!
//! Disabled by default. When enabled, an embedded Arti client bootstraps and
//! serves a loopback-only SOCKS5 proxy; every reqwest client this crate
//! builds and the Nostr relay pool point at that proxy instead of connecting
//! directly. Both call [`http_client_builder`] / [`nostr_connection_mode`]
//! fresh per use rather than caching a client, so a toggle takes effect on
//! the next connection without a process restart.
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
/// this instead so Tor gating stays centralized (see #173).
pub fn http_client_builder() -> reqwest::ClientBuilder {
    let builder = reqwest::Client::builder();
    match active_socks_addr() {
        Some(addr) => match reqwest::Proxy::all(format!("socks5h://{addr}")) {
            Ok(proxy) => builder.proxy(proxy),
            Err(e) => {
                eprintln!("[Tor] Failed to configure local SOCKS proxy for reqwest: {e}");
                builder
            }
        },
        None => builder,
    }
}

/// `Some(addr)` only once Tor routing is enabled *and* the embedded client's
/// local SOCKS proxy has finished bootstrapping.
fn active_socks_addr() -> Option<SocketAddr> {
    if !is_enabled() {
        return None;
    }
    #[cfg(feature = "tor")]
    {
        tor::bootstrapped_addr()
    }
    #[cfg(not(feature = "tor"))]
    {
        None
    }
}

/// Snapshot of live Tor routing status for the settings toggle and the
/// nav-bar status popover. `bootstrapped`/`bootstrap_fraction`/
/// `blocked_reason` reflect the embedded client's own health (it can
/// degrade after initial bootstrap, e.g. on a network change) and are
/// distinct from `enabled`, which only reflects the persisted preference.
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

    #[cfg(feature = "tor")]
    let (available, bootstrapped, bootstrap_fraction, blocked_reason) = match tor::bootstrap_info()
    {
        Some(info) => (true, info.ready_for_traffic, info.fraction, info.blocked_reason),
        None => (true, false, 0.0, None),
    };
    #[cfg(not(feature = "tor"))]
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
    }
}

/// Read the persisted per-account setting and apply it. Called once after
/// account login/switch, before the relay pool is first populated, so the
/// first `connect()` already uses the right connection mode. Bootstrap
/// failure is logged, not fatal: login still proceeds and relay connectivity
/// degrades the same way a fully unreachable relay set already does.
pub async fn apply_persisted_setting<R: Runtime>(app: &tauri::AppHandle<R>) {
    let enabled = crate::db::get_sql_setting(app.clone(), SETTING_KEY.to_string())
        .unwrap_or(None)
        .map(|v| v == "true")
        .unwrap_or(false);

    if !enabled {
        TOR_ENABLED.store(false, Ordering::SeqCst);
        return;
    }

    if let Err(e) = enable(app).await {
        eprintln!("[Tor] Failed to bootstrap embedded Tor client at login: {e}");
    }
}

/// Persist and apply the "Route Traffic Through Tor" setting. Bootstraps (on
/// enable) or flips the in-memory flag (on disable), then rebuilds the live
/// Nostr relay pool -- if logged in -- so already-open relay connections
/// pick up the new mode without restarting the app.
#[tauri::command]
pub async fn set_tor_routing_enabled<R: Runtime>(
    handle: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<(), String> {
    if enabled {
        enable(&handle).await?;
    } else {
        TOR_ENABLED.store(false, Ordering::SeqCst);
        TOR_STATS.mark_disabled();
    }

    crate::db::set_sql_setting(
        handle.clone(),
        SETTING_KEY.to_string(),
        enabled.to_string(),
    )?;

    crate::rebuild_relay_pool_connection_mode(&handle).await;

    Ok(())
}

/// Bootstraps the embedded Arti client + local SOCKS proxy (idempotent; a
/// second call while already bootstrapped is a no-op) and marks Tor routing
/// enabled. Errors when the `tor` feature isn't compiled in (e.g. Android).
#[cfg_attr(not(feature = "tor"), allow(unused_variables))]
async fn enable<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    #[cfg(feature = "tor")]
    {
        tor::ensure_bootstrapped(app).await?;
        TOR_ENABLED.store(true, Ordering::SeqCst);
        TOR_STATS.mark_enabled();
        Ok(())
    }
    #[cfg(not(feature = "tor"))]
    {
        Err("Tor routing is not available on this build".to_string())
    }
}

#[cfg(feature = "tor")]
mod tor {
    use std::net::SocketAddr;
    use std::path::{Path, PathBuf};

    use arti_client::config::{CfgPath, TorClientConfigBuilder};
    use arti_client::{DangerouslyIntoTorAddr, TorClient, TorClientConfig};
    use fast_socks5::server::Socks5ServerProtocol;
    use fast_socks5::util::target_addr::TargetAddr;
    use fast_socks5::{ReplyError, Socks5Command};
    use tauri::{Manager, Runtime};
    use tokio::net::{TcpListener, TcpStream};
    use tokio::sync::OnceCell;
    use tor_rtcompat::PreferredRuntime;

    static TOR_CLIENT: OnceCell<std::sync::Arc<TorClient<PreferredRuntime>>> = OnceCell::const_new();
    static SOCKS_ADDR: OnceCell<SocketAddr> = OnceCell::const_new();

    /// The local SOCKS proxy address, once bootstrap has completed.
    pub(super) fn bootstrapped_addr() -> Option<SocketAddr> {
        SOCKS_ADDR.get().copied()
    }

    /// Snapshot of the embedded client's bootstrap health, if it has been
    /// initialized at least once this process.
    pub(super) struct BootstrapInfo {
        pub(super) ready_for_traffic: bool,
        pub(super) fraction: f32,
        pub(super) blocked_reason: Option<String>,
    }

    pub(super) fn bootstrap_info() -> Option<BootstrapInfo> {
        let client = TOR_CLIENT.get()?;
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
        let data_dir = arti_data_dir(app)?;

        TOR_CLIENT
            .get_or_try_init(|| init_tor_client(data_dir))
            .await
            .map_err(|e| format!("Failed to bootstrap Tor: {e}"))?;

        SOCKS_ADDR
            .get_or_try_init(start_socks_proxy)
            .await
            .map_err(|e| format!("Failed to start local Tor proxy: {e}"))?;

        Ok(())
    }

    fn arti_data_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
        app.path()
            .app_data_dir()
            .map(|dir| dir.join("tor"))
            .map_err(|e| format!("Failed to resolve app data dir: {e}"))
    }

    async fn init_tor_client(
        data_dir: PathBuf,
    ) -> Result<std::sync::Arc<TorClient<PreferredRuntime>>, String> {
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
    /// accept loop. Every accepted connection is proxied through the
    /// already-bootstrapped `TOR_CLIENT`.
    async fn start_socks_proxy() -> Result<SocketAddr, String> {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|e| format!("Failed to bind local SOCKS listener: {e}"))?;
        let addr = listener
            .local_addr()
            .map_err(|e| format!("Failed to read local SOCKS listener address: {e}"))?;

        tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((socket, _)) => {
                        tokio::spawn(async move {
                            if let Err(e) = serve_socks_connection(socket).await {
                                log::debug!(target: "pacto", "[Tor] SOCKS connection ended: {e}");
                            }
                        });
                    }
                    Err(e) => {
                        log::warn!(target: "pacto", "[Tor] Local SOCKS listener accept error: {e}");
                    }
                }
            }
        });

        Ok(addr)
    }

    /// Handles a single client connection to the local SOCKS5 proxy: performs
    /// the (unauthenticated, loopback-only) SOCKS5 handshake, dials the
    /// requested target through the embedded Tor client, and then relays
    /// bytes bidirectionally until either side closes.
    async fn serve_socks_connection(socket: TcpStream) -> Result<(), String> {
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

        let client = TOR_CLIENT.get().ok_or("Tor client not bootstrapped")?;
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

    #[test]
    fn disabled_by_default() {
        assert!(!is_enabled());
    }

    #[test]
    fn direct_mode_when_disabled() {
        TOR_ENABLED.store(false, Ordering::SeqCst);
        assert_eq!(nostr_connection_mode(), ConnectionMode::direct());
    }

    #[test]
    fn http_client_builder_succeeds_when_disabled() {
        TOR_ENABLED.store(false, Ordering::SeqCst);
        // No proxy configured: building a bare client must succeed.
        assert!(http_client_builder().build().is_ok());
    }

    #[test]
    fn direct_mode_when_enabled_but_not_yet_bootstrapped() {
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
        TOR_STATS.mark_enabled();
        TOR_STATS.add_bytes(10, 20);
        TOR_STATS.add_bytes(5, 5);
        assert_eq!(TOR_STATS.bytes_up.load(Ordering::SeqCst), 15);
        assert_eq!(TOR_STATS.bytes_down.load(Ordering::SeqCst), 25);
        TOR_STATS.mark_disabled();
    }

    #[test]
    fn tor_stats_connection_guard_tracks_active_count() {
        TOR_STATS.mark_enabled();
        assert_eq!(TOR_STATS.active_connections.load(Ordering::SeqCst), 0);
        {
            let _guard = TOR_STATS.connection_started();
            assert_eq!(TOR_STATS.active_connections.load(Ordering::SeqCst), 1);
        }
        assert_eq!(TOR_STATS.active_connections.load(Ordering::SeqCst), 0);
        TOR_STATS.mark_disabled();
    }

    #[test]
    fn tor_stats_latency_samples_cap_and_evict_oldest() {
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
        TOR_ENABLED.store(false, Ordering::SeqCst);
        TOR_STATS.mark_disabled();
        let status = get_tor_status();
        assert!(!status.enabled);
        assert_eq!(status.enabled_seconds, None);
    }

    #[test]
    fn get_tor_status_reports_avg_latency_and_enabled_seconds_once_enabled() {
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
