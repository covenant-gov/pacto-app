# Tor transport — "Route Traffic Through Tor"

How Pacto's optional Tor routing setting (issue [#173](https://github.com/covenant-gov/pacto-app/issues/173))
gates outbound backend traffic through one embedded Tor client and one
local SOCKS5 proxy, how the setting persists and applies, what it does not
cover, and how to verify it manually.

**Status:** shipped, default off, desktop only (Android excluded).

---

## 1. Single transport-gating layer (backend only)

`src-tauri/src/net_transport.rs` is the one module every outbound
connection *made by the Rust backend* goes through when this setting
matters. No other backend module constructs a `reqwest::Client` or picks a
Nostr `ConnectionMode` directly. See §6 for what this deliberately does
**not** cover.

```text
reqwest call sites (blossom, net, image_cache, klipy, whisper)
Nostr relay pool
                    \
                     -> net_transport::http_client_builder() / nostr_connection_mode()
                          -> disabled or not yet bootstrapped: direct connection
                          -> enabled + bootstrapped: 127.0.0.1:<ephemeral SOCKS port>
                               -> embedded arti_client::TorClient
                                    -> Tor network
evm/rpc/provider.rs (alloy JSON-RPC providers)
                    -> net_transport::active_socks_addr() (own reqwest instance, see §1.1)
                          -> same local SOCKS port -> same embedded TorClient
```

- `is_enabled() -> bool` — current in-memory flag. Reflects whether Tor is
  *actually* the active transport right now, not the raw persisted
  preference (see §2).
- `nostr_connection_mode() -> nostr_sdk::ConnectionMode` — `direct()` unless
  Tor is enabled **and** the local SOCKS proxy has finished bootstrapping,
  in which case `proxy(addr)`.
- `http_client_builder() -> Result<reqwest::ClientBuilder, String>` —
  pre-wired with a `socks5h://127.0.0.1:<port>` proxy when active (the
  trailing `h` means DNS resolves remotely through Tor, never on the local
  machine), otherwise a bare builder. Returns `Err` instead of a bare
  builder if Tor is supposed to be active but the proxy can't be attached —
  callers must propagate this rather than falling back to an unproxied
  client, or the setting would silently stop applying.
- `apply_persisted_setting()` / the `set_tor_routing_enabled` Tauri command —
  see §2.

Every previously ad-hoc `reqwest::Client::builder()` / `::new()` call site
(`blossom.rs`, `net.rs`, `image_cache.rs`, `klipy.rs`, `whisper.rs`) now
goes through `http_client_builder()` and propagates its error instead of
silently building an unproxied client on failure. The Nostr relay pool goes
through `nostr_connection_mode()` via `async-wsocket`'s `socks` feature —
not `nostr_sdk`'s own separate embedded-Tor feature, so there is exactly
one Arti client instance and one circuit pool for the whole app, never two.

Three call sites (`image_cache.rs`, `klipy.rs`'s two clients) previously
cached a `reqwest::Client` in a `once_cell`/`LazyLock` static. They now
build a fresh client per call instead, specifically so toggling Tor takes
effect on the very next request — a cached static client's connection pool
and proxy config would otherwise be frozen at first use.

### 1.1 The EVM/alloy exception

`evm/rpc/provider.rs`'s JSON-RPC providers (wallet balance/gas reads, tx
broadcasts, receipt polling) are also gated through Tor, but not via
`http_client_builder()`: `alloy` 1.x depends on a different major version
of `reqwest` (0.13) than the rest of this crate (0.12, pinned for its own
compatibility reasons — see the `reqwest` entry in `Cargo.toml`), and
alloy's `ProviderBuilder::connect_reqwest` requires a client of that exact
type. `evm/rpc/provider.rs::tor_aware_http_client` builds a `reqwest 0.13`
client directly, configuring the same local SOCKS address
(`net_transport::active_socks_addr()`) rather than sharing a
`ClientBuilder`. `Cargo.toml`'s `reqwest013` dependency exists solely so
Cargo's per-resolved-version feature unification adds the `socks` feature
to that transitively-pulled `reqwest 0.13` instance too — without it,
`alloy-transport-http`'s own `reqwest` never gets `socks` compiled in and
the same silent-unproxied failure mode described in §1 would apply here.

### The embedded proxy itself

Behind the `tor` Cargo feature (§3), a private submodule of
`net_transport.rs` bootstraps an `arti_client::TorClient` (rustls backend,
onion-service-client enabled) with cache/state directories under
`<app_data_dir>/tor/{cache,state}`, and runs its own loopback-only SOCKS5
server (`fast-socks5`) on an OS-assigned ephemeral port bound to
`127.0.0.1`. Every accepted SOCKS connection is dialed through
`TorClient::connect()` (`IntoTorAddr` for domains, `DangerouslyIntoTorAddr`
for raw IPs) and relayed bidirectionally with `tokio::io::copy_bidirectional`
(what `fast_socks5::server::transfer` wraps internally; called directly so
the byte counts it returns can feed the live status stats in §5). Both HTTP
and Nostr relay traffic point at this one proxy — there is no per-caller
Tor client, only one shared circuit pool.

The local SOCKS listener's accept loop backs off (capped exponential delay)
on transient `accept()` errors and shuts the listener down after too many
consecutive failures, rather than spinning a hot loop. Disabling routing
(`set_tor_routing_enabled(false)` or a persistence rollback) aborts the
accept-loop task and drops the embedded `TorClient`, so "off" actually
stops its background circuit/directory activity instead of leaving it
running until process exit.

---

## 2. Setting lifecycle

- **Persistence:** backend SQLite `settings` table (one DB file per npub, so
  the setting is already per-account), key `route_traffic_through_tor`,
  value `"true"`/`"false"`, via the existing `db::get_sql_setting` /
  `set_sql_setting` commands. **Default off** — unlike the other privacy
  toggles referenced in #170–172, Tor adds real per-request latency, so this
  one is explicit opt-in only.
- **Applied at login, before relays connect:** `net_transport::apply_persisted_setting`
  runs from `complete_login_from_keys` in `src-tauri/src/lib.rs`, before the
  Nostr relay pool is first populated, so the very first relay connection
  already uses the right mode.
- **A failed bootstrap does not silently "half-Tor" traffic.** If the
  persisted preference is on but the embedded client fails to bootstrap at
  login (offline launch, captive portal, censored network), `is_enabled()`
  stays `false` and every backend connection goes direct — exactly as if
  routing were off, never a state where some traffic is proxied and some
  isn't. The failure is recorded and surfaced via `get_tor_status().startup_error`,
  and `net_transport::spawn_login_bootstrap_retry` re-attempts the
  bootstrap twice more (10s, then 30s later), bailing out early if the user
  disables the preference before a retry fires. **The frontend hydrates its
  toggle state from this live `enabled` field (`get_tor_status`), not the
  raw persisted setting** (`src/stores/tor.ts`), so the UI can never show
  "on" while the transport is actually direct.
- **Live toggle:** the `set_tor_routing_enabled(enabled: bool) -> Result<(), String>`
  Tauri command persists the new value, bootstraps the Arti client and SOCKS
  proxy (enable) or tears the embedded client down (disable), then rebuilds
  the live relay pool via `crate::rebuild_relay_pool_connection_mode`
  (`pool().force_remove_all_relays()`, re-populate, `client.connect()`) so
  already-open relay connections pick up the new mode without an app
  restart. If persisting the new value fails, the in-memory transport
  change is rolled back (re-enabled or torn down as appropriate) so the
  backend's actual state can't drift from what got saved.
- **Latency:** first enable can take **tens of seconds**, bounded by a
  90-second bootstrap timeout (`tor::BOOTSTRAP_TIMEOUT`) so a censored or
  offline network can't hang `login` / `set_tor_routing_enabled`
  indefinitely. The frontend shows a connecting/disconnecting state while
  the command is in flight and surfaces the error string on rejection.

---

## 3. Cargo feature gate

`tor` (in `default = ["whisper", "tor"]`) adds `dep:arti-client` (features
`tokio`, `rustls`, `compression`, `flowctl-cc`, `onion-service-client`),
`dep:tor-rtcompat` (features `tokio`, `rustls`), and `dep:fast-socks5`
(`1.0`, MIT licensed; all `default-features = false` except `fast-socks5`).
All three sit under `[target.'cfg(not(target_os = "android"))'.dependencies]`
— **Android is excluded**, mirroring the existing `whisper-rs` gate,
because Arti's mobile support needs an explicit state-directory path this
build doesn't yet plumb through.

Every `net_transport.rs` code path that touches the embedded client (the
`tor` submodule declaration, `active_socks_addr`, `get_tor_status`,
`enable`) is gated on `all(not(target_os = "android"), feature = "tor")`,
**not** `feature = "tor"` alone — since the Cargo feature stays in
`default` regardless of target, gating only on the feature would try to
compile `use arti_client::...` on an Android build that never pulls those
dependencies in. On a build without that combined gate satisfied (Android,
or `--no-default-features`), `set_tor_routing_enabled` returns an error
(e.g. "Tor routing is not available on this build") instead of silently
no-opping, and `get_tor_status().available` reads `false` so the settings
toggle can hide or disable itself instead of offering a control that will
always reject.

---

## 4. Manual verification checklist

Automated CI cannot assert "no direct-to-origin connections happen" — that
requires observing real OS-level sockets. Verify by hand after enabling the
setting in a dev build:

1. Enable the toggle in Settings and wait for the connecting state to clear
   (first bootstrap can take tens of seconds).
2. Trigger outbound traffic of each kind: let Nostr relays reconnect, open a
   DM with a Blossom-attached image, send/receive a Blossom upload, search
   for a GIF, check a wallet balance, and open a DM containing a link a
   contact hasn't previewed before (forces a fresh `fetch_msg_metadata` call,
   which caches `og_image`/favicon through the backend while Tor is on).
3. **`lsof`** — `lsof -i -P -n | grep <pacto-pid>` (or `pgrep` first to find
   the PID). Expect exactly one loopback connection to the local SOCKS port
   (`127.0.0.1:<port>`) plus outbound connections to Tor **guard relays**
   (rotating IPs, port 443/9001-ish, not stable relay/Blossom hosts).
   Profile avatars and link-preview images/favicons should show **no**
   direct connection to their origin host at all: once cached, the webview
   renders a local file (`asset://...`, no network request); the caching
   fetch itself already went through the SOCKS proxy above. A newly-seen
   avatar/preview with no cached path yet renders nothing rather than
   falling back to a direct fetch (see §6) -- give the background cache
   fetch a moment, then re-check.
4. **`nettop`** (macOS) — `sudo nettop -p <pacto-pid>` gives a live
   per-process connection list; cross-check against the relay/Blossom/RPC
   hostnames configured in Settings to confirm none appear as direct
   destinations.
5. **Little Snitch / Wireshark** (optional, more conclusive) — capture or
   rule-log traffic from the Pacto process. Wireshark on the loopback and
   primary interfaces should show TLS to Tor guard IPs only for backend
   traffic; Little Snitch's per-connection log should show the local SOCKS
   hop as the only backend egress path.
6. Disable the toggle and repeat step 3; direct connections to relay/Blossom
   hosts should reappear, confirming the proxy path was actually load-bearing
   and not just present alongside a direct path.

If any step shows a **backend** (Rust-originated) direct connection to a
relay, Blossom, RPC, Klipy, avatar, or link-preview-image host while the
setting is on and bootstrapped, that is a real bypass of the
`net_transport` chokepoint — file it against whichever call site skipped
`http_client_builder()` / `nostr_connection_mode()` /
`evm/rpc/provider.rs`'s `tor_aware_http_client()` /
`image_cache::cache_image()`. See §6 for the one deliberate exception (the
desktop auto-updater).

---

## 5. Live status (nav-bar popover)

Clicking the onion badge that appears in the top nav bar while routing is
enabled opens a popover backed by the `get_tor_status` Tauri command
(`net_transport::get_tor_status`, polled every 15s while the popover is
open — see `TorStatusIndicator.svelte`; "Enabled for" only ever displays
whole minutes, so a faster cadence would just add IPC round-trips). Arti's
public API exposes no traffic or per-circuit latency counters, so the
figures are self-measured:

- **State** — `TorClient::bootstrap_status()`'s `ready_for_traffic()` /
  `as_frac()` / `blocked()`. This can change after the initial bootstrap
  (e.g. a network change), unlike `enabled`, which reflects the live
  transport state (see §2), not the raw persisted preference.
- **Active connections**, **bytes up/down** — tracked by `TorStats` in
  `net_transport.rs`, updated from the SOCKS relay loop:
  `tokio::io::copy_bidirectional`'s return value feeds the byte counters,
  and a `TorConnectionGuard` (RAII, decrements on drop) tracks the open
  count so an errored stream never leaks a phantom connection.
- **Avg. connect latency** — a rolling average (last 20 samples) of how
  long each `TorClient::connect()` call took, timed at the SOCKS relay's own
  call site. This is a real connect-time measurement, not a synthetic ping
  (Tor has no ICMP equivalent through the circuit).

All counters reset (`TorStats::mark_enabled`) whenever routing transitions
from disabled to enabled, so the popover always reads "since Tor was last
turned on".

---

## 6. What this does not cover

This setting is a **transport-layer** control, not a full anonymity or
identity-hiding feature, and it does not extend to every network request
the app makes:

- **Webview-rendered images are covered via backend caching, not by
  proxying the webview.** Profile avatars/banners (`getProfileAvatarSrc` /
  `getProfileBannerSrc` in `src/lib/utils/profile.ts`) and link-preview
  `og_image`/favicon (`LinkPreview.svelte`) render as `<img src>`, which
  the OS webview's own network stack (WKWebView / WebView2 / WebKitGTK)
  would fetch directly if pointed at a remote URL — the embedded SOCKS
  proxy has no way to intercept a webview-originated request, and
  `tauri.conf.json` sets `"csp": null`, so nothing else blocks it either.
  Instead, the backend fetches and caches these images itself (through the
  same Tor-gated `image_cache::cache_image`, on the local filesystem under
  `$APPDATA/cache/**`, served back to the webview via `convertFileSrc` —
  never a remote URL) and the frontend prefers that cached path over the
  remote URL **whenever Tor routing is enabled**, via the shared
  `cachedOrRemoteImageSrc` helper in `profile.ts`. If no cached path exists
  yet, the image is simply omitted rather than falling back to a direct
  fetch — never a partial leak. Two asymmetries to know about:
  - **Avatars/banners** are already cached in the background unconditionally
    (a pre-existing, non-Tor feature — see `profile.rs`), so the caching
    fetch itself only goes through Tor when Tor happens to be enabled at
    the time it runs; a file cached before Tor was ever turned on was
    fetched directly at the time, and is now just read from disk (no new
    network request either way).
  - **Link-preview images** have no such pre-existing caching path, so
    `message::fetch_msg_metadata` only attempts to cache `og_image`/favicon
    when `net_transport::is_enabled()` — while Tor is off, previews keep
    working exactly as before this feature (webview fetches the remote URL
    directly, zero backend involvement).
- **The desktop auto-updater is not routed.** `tauri_plugin_updater`'s
  `check()`/download flow builds its own HTTP client internally; injecting
  a proxy would require overriding the plugin's built-in commands with a
  custom implementation, which this feature does not do. Update checks and
  binary downloads always go direct regardless of this setting.
- **It's transport-only, not identity-hiding.** Nostr relay subscriptions
  still carry the account's real npub, Blossom uploads still carry
  account-linked blob descriptors, and Klipy queries are still attributable
  to a single session. Enabling this setting changes *who sees the
  connecting IP address*, not *who can link the traffic back to the
  account* at the application layer.

---

## See also

- `src-tauri/src/net_transport.rs` — the gating module itself.
- `src-tauri/src/evm/rpc/provider.rs` — the EVM/alloy exception (§1.1).
- `src-tauri/src/image_cache.rs`, `src/lib/utils/profile.ts` — the
  Tor-gated avatar/link-preview image caching described in §6.
- [`messaging/GIF_PROVIDER.md`](../messaging/GIF_PROVIDER.md) §5 — the single
  Klipy egress chokepoint this design generalizes.
- [`README.md`](../README.md) — docs index.
