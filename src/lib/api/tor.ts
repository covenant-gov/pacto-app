import { invoke } from './index';

/**
 * Backend: `set_tor_routing_enabled`. Persists the preference and applies it live —
 * bootstraps the embedded Tor client + local SOCKS proxy on enable and rebuilds the
 * Nostr relay pool. Can take tens of seconds on first enable (Tor circuit bootstrap)
 * and rejects with a string error when Tor is unavailable or bootstrap fails.
 */
export async function setTorRoutingEnabled(enabled: boolean): Promise<void> {
  await invoke('set_tor_routing_enabled', { enabled });
}

/**
 * Live status snapshot for the nav-bar popover. `bytes_up`/`bytes_down` and
 * `active_connections` are self-tracked by the backend's loopback SOCKS
 * relay (Arti exposes no traffic counters); `avg_connect_latency_ms` is the
 * rolling average of recent `TorClient::connect()` calls. `bootstrapped` can
 * go false again after a successful bootstrap (e.g. a network change) even
 * while `enabled` stays true.
 */
export interface TorStatus {
  available: boolean;
  enabled: boolean;
  bootstrapped: boolean;
  bootstrap_fraction: number;
  blocked_reason: string | null;
  active_connections: number;
  bytes_up: number;
  bytes_down: number;
  avg_connect_latency_ms: number | null;
  enabled_seconds: number | null;
}

/** Backend: `get_tor_status`. Cheap in-memory read, safe to poll while a status popover is open. */
export async function getTorStatus(): Promise<TorStatus> {
  return await invoke<TorStatus>('get_tor_status');
}
