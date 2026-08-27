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

use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};

use nostr_sdk::prelude::ConnectionMode;
use tauri::Runtime;

/// Per-account SQL setting key (see `db::get_sql_setting` / `set_sql_setting`).
pub const SETTING_KEY: &str = "route_traffic_through_tor";

/// In-memory mirror of the persisted setting, applied at login and updated
/// by `set_tor_routing_enabled`.
static TOR_ENABLED: AtomicBool = AtomicBool::new(false);

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
    use fast_socks5::server::{transfer, Socks5ServerProtocol};
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
        let tor_stream = match &target_addr {
            TargetAddr::Ip(addr) => {
                let tor_addr = addr
                    .into_tor_addr_dangerously()
                    .map_err(|e| e.to_string())?;
                client.connect(tor_addr).await
            }
            TargetAddr::Domain(host, port) => client.connect((host.as_str(), *port)).await,
        };

        let tor_stream = match tor_stream {
            Ok(stream) => stream,
            Err(e) => {
                let _ = proto.reply_error(&ReplyError::HostUnreachable).await;
                return Err(e.to_string());
            }
        };

        // The bound address in a SOCKS5 success reply is informational only
        // for a CONNECT proxy; clients (reqwest, async-wsocket) don't act on
        // it, so an unspecified address is fine here.
        let bind_addr: SocketAddr = "0.0.0.0:0".parse().expect("valid socket addr literal");
        let inbound = proto
            .reply_success(bind_addr)
            .await
            .map_err(|e| e.to_string())?;

        transfer(inbound, tor_stream).await;
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
}
