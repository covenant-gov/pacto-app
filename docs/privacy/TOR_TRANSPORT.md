# Tor transport — "Route Traffic Through Tor"

How Pacto's optional Tor routing setting (issue [#173](https://github.com/covenant-gov/pacto-app/issues/173))
gates every outbound TCP connection through one embedded Tor client and one
local SOCKS5 proxy, how the setting persists and applies, and how to verify
it manually.

**Status:** shipped, default off, desktop only (Android excluded).

---

## 1. Single transport-gating layer

`src-tauri/src/net_transport.rs` is the one module every outbound connection
in the backend goes through when this setting matters. No other module
constructs a `reqwest::Client` or picks a Nostr `ConnectionMode` directly.

```text
reqwest call sites (blossom, net, image_cache, klipy, whisper, evm/*)
Nostr relay pool
                    \
                     -> net_transport::http_client_builder() / nostr_connection_mode()
                          -> disabled or not yet bootstrapped: direct connection
                          -> enabled + bootstrapped: 127.0.0.1:<ephemeral SOCKS port>
                               -> embedded arti_client::TorClient
                                    -> Tor network
```

- `is_enabled() -> bool` — current in-memory flag.
- `nostr_connection_mode() -> nostr_sdk::ConnectionMode` — `direct()` unless
  Tor is enabled **and** the local SOCKS proxy has finished bootstrapping,
  in which case `proxy(addr)`.
- `http_client_builder() -> reqwest::ClientBuilder` — pre-wired with a
  `socks5h://127.0.0.1:<port>` proxy when active (the trailing `h` means DNS
  resolves remotely through Tor, never on the local machine), otherwise a
  bare builder.
- `apply_persisted_setting()` / the `set_tor_routing_enabled` Tauri command —
  see §2.

Every previously ad-hoc `reqwest::Client::builder()` / `::new()` call site
(`blossom.rs`, `net.rs`, `image_cache.rs`, `klipy.rs`, `whisper.rs`,
`evm/sponsor_userop.rs`, `evm/wallet_prices.rs`) now goes through
`http_client_builder()`. The Nostr relay pool goes through
`nostr_connection_mode()` via `async-wsocket`'s `socks` feature — not
`nostr_sdk`'s own separate embedded-Tor feature, so there is exactly one Arti
client instance and one circuit pool for the whole app, never two.

Three call sites (`image_cache.rs`, `klipy.rs`'s two clients,
`evm/sponsor_userop.rs`'s bundler client) previously cached a `reqwest::Client`
in a `once_cell`/`LazyLock` static. They now build a fresh client per call
instead, specifically so toggling Tor takes effect on the very next request —
a cached static client's connection pool and proxy config would otherwise be
frozen at first use.

### The embedded proxy itself

Behind the `tor` Cargo feature (§3), a private submodule of
`net_transport.rs` bootstraps an `arti_client::TorClient` (rustls backend,
onion-service-client enabled) with cache/state directories under
`<app_data_dir>/tor/{cache,state}`, and runs its own loopback-only SOCKS5
server (`fast-socks5`) on an OS-assigned ephemeral port bound to
`127.0.0.1`. Every accepted SOCKS connection is dialed through
`TorClient::connect()` (`IntoTorAddr` for domains, `DangerouslyIntoTorAddr`
for raw IPs) and relayed bidirectionally with `fast_socks5::server::transfer`.
Both HTTP and Nostr relay traffic point at this one proxy — there is no
per-caller Tor client, only one shared circuit pool.

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
  already uses the right mode. A bootstrap failure at login is logged, not
  fatal — login still succeeds and relay connectivity degrades the same way
  an unreachable relay set already does today.
- **Live toggle:** the `set_tor_routing_enabled(enabled: bool) -> Result<(), String>`
  Tauri command persists the new value, bootstraps the Arti client and SOCKS
  proxy (enable) or flips the in-memory flag off (disable), then rebuilds the
  live relay pool via `crate::rebuild_relay_pool_connection_mode`
  (`pool().force_remove_all_relays()`, re-populate, `client.connect()`) so
  already-open relay connections pick up the new mode without an app
  restart.
- **Latency:** first enable can take **tens of seconds** (Tor circuit
  bootstrap). The frontend must show a connecting/bootstrapping state while
  the command is in flight and surface the error string on rejection.

---

## 3. Cargo feature gate

`tor` (in `default = ["whisper", "tor"]`) adds
`dep:arti-client`, `dep:tor-rtcompat` (both pinned `0.45`,
`default-features = false`, features `tokio`, `rustls`, `compression`,
`flowctl-cc`, `onion-service-client`) and `dep:fast-socks5` (`1.0`, MIT
licensed). All three sit under
`[target.'cfg(not(target_os = "android"))'.dependencies]` — **Android is
excluded**, mirroring the existing `whisper-rs` gate, because Arti's mobile
support needs an explicit state-directory path this build doesn't yet
plumb through. On a build without the `tor` feature (Android),
`set_tor_routing_enabled` returns an error (e.g. "Tor routing is not
available on this build") instead of silently no-opping.

---

## 4. Manual verification checklist

Automated CI cannot assert "no direct-to-origin connections happen" — that
requires observing real OS-level sockets. Verify by hand after enabling the
setting in a dev build:

1. Enable the toggle in Settings and wait for the connecting state to clear
   (first bootstrap can take tens of seconds).
2. Trigger outbound traffic of each kind: let Nostr relays reconnect, open a
   DM with a Blossom-attached image, view a link preview, send/receive a
   Blossom upload.
3. **`lsof`** — `lsof -i -P -n | grep <pacto-pid>` (or `pgrep` first to find
   the PID). Expect exactly one loopback connection to the local SOCKS port
   (`127.0.0.1:<port>`) plus outbound connections to Tor **guard relays**
   (rotating IPs, port 443/9001-ish, not stable relay/Blossom hosts). You
   should **not** see direct connections to known Nostr relay or Blossom
   server IPs/hostnames.
4. **`nettop`** (macOS) — `sudo nettop -p <pacto-pid>` gives a live
   per-process connection list; cross-check against the relay/Blossom
   hostnames configured in Settings to confirm none appear as direct
   destinations.
5. **Little Snitch / Wireshark** (optional, more conclusive) — capture or
   rule-log traffic from the Pacto process. Wireshark on the loopback and
   primary interfaces should show TLS to Tor guard IPs only; Little Snitch's
   per-connection log should show the local SOCKS hop as the only egress
   path, with no rule hits for relay/Blossom hosts on the real interface.
6. Disable the toggle and repeat step 3; direct connections to relay/Blossom
   hosts should reappear, confirming the proxy path was actually load-bearing
   and not just present alongside a direct path.

If any step shows a direct connection to a relay, Blossom host, image/link
preview host, or Klipy while the setting is on, that is a real bypass of the
`net_transport` chokepoint — file it against whichever call site skipped
`http_client_builder()` / `nostr_connection_mode()`.

---

## See also

- `src-tauri/src/net_transport.rs` — the gating module itself.
- [`messaging/GIF_PROVIDER.md`](../messaging/GIF_PROVIDER.md) §5 — the single
  Klipy egress chokepoint this design generalizes.
- [`README.md`](../README.md) — docs index.
