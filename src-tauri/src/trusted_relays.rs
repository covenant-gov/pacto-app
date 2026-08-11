//! Trusted relay set resolution.
//!
//! Production ships a fixed relay list. Debug builds may redirect it via
//! `PACTO_TRUSTED_RELAYS` so all Nostr/MLS traffic can be routed to a local dev
//! stack instead. The raw list is only reachable through [`trusted_relays`] —
//! nothing else in the crate can see it, so a missed call site is a compile
//! error rather than a silent send to production relays.

use nostr_sdk::RelayUrl;
use std::sync::OnceLock;

/// Today's production relay list. Private: reachable only through the
/// accessors below.
const DEFAULT_TRUSTED_RELAYS: &[&str] = &[
    "wss://jskitty.cat/nostr",
    "wss://asia.vectorapp.io/nostr",
    "wss://nostr.computingcache.com",
];

static TRUSTED_RELAYS_CELL: OnceLock<Vec<RelayUrl>> = OnceLock::new();

/// The resolved trusted relay set. Falls back to the compiled defaults if
/// [`init_from_env`] was never called, so unit tests and non-`run()` entry
/// points still get a usable list.
pub(crate) fn trusted_relays() -> &'static [RelayUrl] {
    TRUSTED_RELAYS_CELL.get_or_init(default_relays).as_slice()
}

/// Resolve the trusted relay set once at startup, reading `PACTO_TRUSTED_RELAYS`.
/// Must run after the repo-root `.env` load and before the first relay use.
#[cfg(debug_assertions)]
pub(crate) fn init_from_env() -> Result<(), String> {
    let relays = resolve_from_env_value(std::env::var("PACTO_TRUSTED_RELAYS").ok())?;
    TRUSTED_RELAYS_CELL
        .set(relays)
        .map_err(|_| "trusted relay set was already resolved before init_from_env ran".to_string())
}

/// Release builds contain no environment read at all: a set `PACTO_TRUSTED_RELAYS`
/// is structurally incapable of redirecting a release build.
#[cfg(not(debug_assertions))]
pub(crate) fn init_from_env() -> Result<(), String> {
    TRUSTED_RELAYS_CELL
        .set(default_relays())
        .map_err(|_| "trusted relay set was already resolved before init_from_env ran".to_string())
}

fn default_relays() -> Vec<RelayUrl> {
    DEFAULT_TRUSTED_RELAYS
        .iter()
        .map(|url| {
            RelayUrl::parse(url).expect("DEFAULT_TRUSTED_RELAYS entries are valid relay URLs")
        })
        .collect()
}

/// Env-value-in, relay-list-out. Pure: no env read, no global state, so it is
/// testable independent of the debug/release [`init_from_env`] split.
fn resolve_from_env_value(raw: Option<String>) -> Result<Vec<RelayUrl>, String> {
    match raw {
        Some(raw) => resolve_override(&raw),
        None => Ok(default_relays()),
    }
}

/// Parse a comma-separated `PACTO_TRUSTED_RELAYS` override. Entries are trimmed
/// and order-preserved; an entry that is empty after trimming is a stray
/// separator and is dropped. Rejects a malformed relay URL by name, and
/// rejects an override that resolves to zero relays outright (empty string,
/// only commas, only whitespace) rather than silently disabling all messaging.
fn resolve_override(raw: &str) -> Result<Vec<RelayUrl>, String> {
    let entries: Vec<&str> = raw
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .collect();

    if entries.is_empty() {
        return Err(format!(
            "PACTO_TRUSTED_RELAYS resolved to zero relays (raw value: {raw:?}); refusing \
             rather than silently disabling all messaging"
        ));
    }

    entries
        .into_iter()
        .map(|entry| {
            RelayUrl::parse(entry)
                .map_err(|e| format!("PACTO_TRUSTED_RELAYS: invalid relay URL {entry:?}: {e}"))
        })
        .collect()
}

/// True when every resolved relay's host is loopback (`localhost`, `127.0.0.1`,
/// `::1`/`[::1]`). Backs the sandbox-only identity refusal: a dev identity may
/// only sign in while the whole relay set stays local.
pub(crate) fn all_relays_local() -> bool {
    all_local(trusted_relays())
}

/// The resolved relays that are not local, formatted for an error message.
pub(crate) fn non_local_relays() -> Vec<String> {
    non_local(trusted_relays())
        .into_iter()
        .map(|url| url.to_string())
        .collect()
}

fn all_local(urls: &[RelayUrl]) -> bool {
    urls.iter().all(is_local_host)
}

fn non_local(urls: &[RelayUrl]) -> Vec<&RelayUrl> {
    urls.iter().filter(|url| !is_local_host(url)).collect()
}

fn is_local_host(url: &RelayUrl) -> bool {
    match url.host() {
        // `.localhost` is reserved for loopback by RFC 6761, and loopback is
        // the whole 127.0.0.0/8 block -- not just 127.0.0.1. Matching the
        // narrow forms would refuse a valid local relay as "non-local".
        Some(url::Host::Domain(domain)) => {
            let domain = domain.to_ascii_lowercase();
            domain == "localhost" || domain.ends_with(".localhost")
        }
        Some(url::Host::Ipv4(addr)) => addr.is_loopback(),
        Some(url::Host::Ipv6(addr)) => addr.is_loopback(),
        None => false,
    }
}

/// Debug-only startup connectivity probe. A no-op unless `PACTO_TRUSTED_RELAYS`
/// was set — the compiled defaults are already known-good production relays.
/// Never kills the process: a GUI app that exits at startup gives an agent no
/// diagnostics to work from, so a failure is a loud log line, not a panic.
#[cfg(debug_assertions)]
pub(crate) fn probe_endpoints_in_background() {
    if std::env::var("PACTO_TRUSTED_RELAYS").is_err() {
        return;
    }
    tauri::async_runtime::spawn(async {
        probe_all(trusted_relays()).await;
    });
}

#[cfg(not(debug_assertions))]
pub(crate) fn probe_endpoints_in_background() {}

#[cfg(debug_assertions)]
async fn probe_all(relays: &[RelayUrl]) {
    const ATTEMPTS: u8 = 3;
    const ATTEMPT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);
    const RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(300);

    let client = nostr_sdk::Client::default();
    for url in relays {
        if let Err(e) = client.add_relay(url.clone()).await {
            log::error!(target: "pacto", "trusted relay probe: failed to register {url}: {e}");
        }
    }

    let mut failed = std::collections::HashMap::new();
    for attempt in 1..=ATTEMPTS {
        let outcome = client.try_connect(ATTEMPT_TIMEOUT).await;
        failed = outcome.failed;
        if failed.is_empty() {
            break;
        }
        if attempt < ATTEMPTS {
            tokio::time::sleep(RETRY_DELAY).await;
        }
    }

    for (url, err) in &failed {
        report_probe_failure(url, err);
    }
    client.remove_all_relays().await;
}

#[cfg(debug_assertions)]
fn report_probe_failure(url: &RelayUrl, err: &str) {
    if url.as_str().starts_with("wss://") && is_local_host(url) {
        let message = format!(
            "trusted relay probe: could not connect to local relay {url} ({err}). Most \
             likely cause: this host does not trust Caddy's local development CA. Run \
             `caddy trust`, then restart the app."
        );
        log::error!(target: "pacto", "{message}");
        eprintln!("[trusted_relays] {message}");
    } else {
        log::warn!(target: "pacto", "trusted relay probe: could not connect to {url}: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RELAY_A: &str = "wss://jskitty.cat/nostr";
    const RELAY_B: &str = "wss://asia.vectorapp.io/nostr";
    const RELAY_C: &str = "wss://nostr.computingcache.com";

    #[test]
    fn default_relays_match_the_literal_list() {
        let urls = default_relays();
        let as_strings: Vec<String> = urls.iter().map(|u| u.to_string()).collect();
        assert_eq!(as_strings, vec![RELAY_A, RELAY_B, RELAY_C]);
    }

    #[test]
    fn unset_env_resolves_to_the_compiled_default_list() {
        let urls = resolve_from_env_value(None).expect("default resolution never fails");
        let as_strings: Vec<String> = urls.iter().map(|u| u.to_string()).collect();
        assert_eq!(as_strings, vec![RELAY_A, RELAY_B, RELAY_C]);
    }

    #[test]
    fn single_url_override_resolves_to_that_one_relay() {
        let urls = resolve_override("wss://localhost:7001").unwrap();
        assert_eq!(urls, vec![RelayUrl::parse("wss://localhost:7001").unwrap()]);
    }

    #[test]
    fn comma_separated_override_trims_and_preserves_order() {
        let urls = resolve_override("  wss://localhost:7001 , wss://example.com/relay  ").unwrap();
        assert_eq!(
            urls,
            vec![
                RelayUrl::parse("wss://localhost:7001").unwrap(),
                RelayUrl::parse("wss://example.com/relay").unwrap(),
            ]
        );
    }

    #[test]
    fn malformed_entry_names_the_offending_entry() {
        let err = resolve_override("wss://localhost:7001, not a url").unwrap_err();
        assert!(
            err.contains("not a url"),
            "error must name the offending entry verbatim: {err}"
        );
    }

    #[test]
    fn empty_string_override_is_rejected() {
        assert!(resolve_override("").is_err());
    }

    #[test]
    fn whitespace_only_override_is_rejected() {
        assert!(resolve_override("   ").is_err());
    }

    #[test]
    fn comma_only_override_is_rejected() {
        assert!(resolve_override(",,,").is_err());
    }

    #[test]
    fn accessor_returns_the_same_value_on_repeated_calls() {
        let first = trusted_relays().to_vec();
        let second = trusted_relays().to_vec();
        assert_eq!(first, second);
    }

    #[test]
    fn all_relays_local_true_only_when_every_host_is_loopback() {
        let local: Vec<RelayUrl> = vec![
            RelayUrl::parse("wss://localhost:7001").unwrap(),
            RelayUrl::parse("wss://127.0.0.1:7001").unwrap(),
            RelayUrl::parse("ws://[::1]:7001").unwrap(),
            // Loopback is the whole 127.0.0.0/8 block, and RFC 6761 reserves
            // `.localhost` aliases for it. Both must count as local or a
            // sandbox-only identity is refused against a valid local relay.
            RelayUrl::parse("ws://127.0.0.2:7002").unwrap(),
            RelayUrl::parse("ws://relay.localhost:7002").unwrap(),
        ];
        assert!(all_local(&local));

        let mixed: Vec<RelayUrl> = vec![
            RelayUrl::parse("wss://localhost:7001").unwrap(),
            RelayUrl::parse("wss://relay.example.com").unwrap(),
        ];
        assert!(!all_local(&mixed));
    }

    #[test]
    fn hosts_that_merely_look_local_are_not_local() {
        // A LAN address and a domain that only ends in the *word* localhost
        // are both routable off-box; treating either as local would let the
        // sandbox-only refusal pass on a non-loopback relay.
        let not_local: Vec<RelayUrl> = vec![
            RelayUrl::parse("ws://192.168.1.10:7002").unwrap(),
            RelayUrl::parse("wss://notlocalhost.example.com").unwrap(),
        ];
        for url in &not_local {
            assert!(
                !all_local(std::slice::from_ref(url)),
                "{url} must not be local"
            );
        }
    }

    #[test]
    fn non_local_relays_lists_only_the_non_loopback_hosts() {
        let mixed: Vec<RelayUrl> = vec![
            RelayUrl::parse("wss://localhost:7001").unwrap(),
            RelayUrl::parse("wss://relay.example.com").unwrap(),
            RelayUrl::parse("wss://127.0.0.1:7002").unwrap(),
            RelayUrl::parse("wss://another.example.org").unwrap(),
        ];
        let names: Vec<String> = non_local(&mixed)
            .into_iter()
            .map(|u| u.to_string())
            .collect();
        assert_eq!(
            names,
            vec!["wss://relay.example.com", "wss://another.example.org"]
        );
    }

    /// Only compiles/runs under `cargo test --release`: the release accessor
    /// contains no environment read to disable, so this is U2d's proof that a
    /// set `PACTO_TRUSTED_RELAYS` cannot redirect a release build. Ignores
    /// `init_from_env`'s own `Result`: another test in this binary may have
    /// already populated the cell with the same compiled defaults (release
    /// `init_from_env` never writes anything else), so either outcome proves
    /// the property under test.
    #[cfg(not(debug_assertions))]
    #[test]
    fn release_accessor_returns_compiled_list_even_with_override_env_set() {
        std::env::set_var("PACTO_TRUSTED_RELAYS", "wss://localhost:7001");
        let _ = init_from_env();
        let as_strings: Vec<String> = trusted_relays().iter().map(|u| u.to_string()).collect();
        assert_eq!(as_strings, vec![RELAY_A, RELAY_B, RELAY_C]);
        std::env::remove_var("PACTO_TRUSTED_RELAYS");
    }
}
