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
