import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { invoke } from './index';

export type RelayMode = 'read' | 'write' | 'both';

export type RelayStatus =
  | 'initialized'
  | 'pending'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'terminated'
  | 'banned'
  | 'sleeping'
  | 'disabled';

export type RelayFailureCode =
  | 'dns_failed'
  | 'connection_refused'
  | 'network_unreachable'
  | 'timed_out'
  | 'tls_failed'
  | 'protocol_error'
  | 'auth_required'
  | 'not_a_relay'
  | 'invalid_url'
  | 'unknown';

export interface RelayFailure {
  code: RelayFailureCode;
  detail: string | null;
}

export interface RelayInfo {
  url: string;
  status: RelayStatus;
  is_default: boolean;
  is_custom: boolean;
  enabled: boolean;
  mode: string;
  /** Absent (not `null`) whenever the relay's live status reads connected. */
  failure_reason?: RelayFailure;
}

export interface CustomRelay {
  url: string;
  enabled: boolean;
  mode: RelayMode;
}

/** Client-side check before invoking add_custom_relay. Returns an error message or null if OK. */
export function validateRelayUrlInput(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return get(t)('lib.relay.url.empty');

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return get(t)('lib.relay.url.invalidProtocol');
  }

  if (!parsed.host) return get(t)('lib.relay.url.noHost');
  if (parsed.username || parsed.password) return get(t)('lib.relay.url.userinfo');

  if (parsed.protocol === 'wss:') return null;

  if (parsed.protocol === 'ws:') {
    const host = parsed.hostname;
    const isLocalhost = host === 'localhost';
    const isLoopback = host === '127.0.0.1';
    if (isLocalhost || isLoopback) return null;
  }

  return get(t)('lib.relay.url.invalidProtocol');
}

export function relayModeLabel(mode: string): string {
  switch (mode) {
    case 'read':
      return get(t)('lib.relay.mode.read');
    case 'write':
      return get(t)('lib.relay.mode.write');
    default:
      return get(t)('lib.relay.mode.both');
  }
}

export function relayStatusLabel(status: string): string {
  switch (status) {
    case 'connected':
      return get(t)('lib.relay.status.connected');
    case 'connecting':
      return get(t)('lib.relay.status.connecting');
    case 'pending':
      return get(t)('lib.relay.status.pending');
    case 'initialized':
      return get(t)('lib.relay.status.initialized');
    case 'disconnected':
      return get(t)('lib.relay.status.disconnected');
    case 'terminated':
      return get(t)('lib.relay.status.terminated');
    case 'banned':
      return get(t)('lib.relay.status.banned');
    case 'sleeping':
      return get(t)('lib.relay.status.sleeping');
    case 'disabled':
      return get(t)('lib.relay.status.disabled');
    default:
      return status;
  }
}

export async function listRelays(): Promise<RelayInfo[]> {
  return invoke<RelayInfo[]>('get_relays');
}

export async function addCustomRelay(url: string, mode: RelayMode = 'both'): Promise<CustomRelay> {
  return invoke<CustomRelay>('add_custom_relay', { url, mode });
}

export async function removeCustomRelay(url: string): Promise<boolean> {
  return invoke<boolean>('remove_custom_relay', { url });
}

export async function toggleCustomRelay(url: string, enabled: boolean): Promise<boolean> {
  return invoke<boolean>('toggle_custom_relay', { url, enabled });
}

export async function toggleDefaultRelay(url: string, enabled: boolean): Promise<boolean> {
  return invoke<boolean>('toggle_default_relay', { url, enabled });
}

export async function setRelayEnabled(relay: RelayInfo, enabled: boolean): Promise<boolean> {
  if (relay.is_custom) return toggleCustomRelay(relay.url, enabled);
  if (relay.is_default) return toggleDefaultRelay(relay.url, enabled);
  throw new Error('Unknown relay type');
}

export interface RelayMetrics {
  ping_ms: number | null;
  bytes_up: number;
  bytes_down: number;
  last_check: number | null;
  events_received: number;
  events_sent: number;
}

export type RelayLogLevel = 'info' | 'warn' | 'error';

export interface RelayLog {
  timestamp: number;
  level: RelayLogLevel;
  message: string;
}

export async function getRelayMetrics(url: string): Promise<RelayMetrics> {
  return invoke<RelayMetrics>('get_relay_metrics', { url });
}

export async function getRelayLogs(url: string): Promise<RelayLog[]> {
  return invoke<RelayLog[]>('get_relay_logs', { url });
}

/** Starts the backend's relay status/health-check monitor loop. Safe to call multiple times; the backend dedupes. */
export async function monitorRelayConnections(): Promise<boolean> {
  return invoke<boolean>('monitor_relay_connections');
}

/** True once the health-check loop has recorded a ping or last-check time for this relay. */
export function hasRelayHealthData(metrics: RelayMetrics): boolean {
  return metrics.ping_ms !== null || metrics.last_check !== null;
}

export type ProbeResult =
  | { outcome: 'reachable'; round_trip_ms: number }
  | { outcome: 'unreachable'; failure: RelayFailure };

export type ExpiryVerdict = 'valid' | 'expiring_soon' | 'expired';

/** Certificate metadata plus a freshly computed expiry verdict (R9, KTD10 -- the 30-day
 *  threshold and expiry classification live only in the backend; this type never recomputes
 *  them). `trust_not_evaluated` is always `true`: this panel reports what the certificate
 *  claims about itself, never a trust verdict (R14). */
export interface RelayCertificate {
  subject: string;
  issuer: string;
  not_before: number;
  not_after: number;
  san_dns_names: string[];
  public_key_algorithm: string;
  public_key_bits: number;
  sha256_fingerprint: string;
  trust_not_evaluated: true;
  expiry_verdict: ExpiryVerdict;
}

/** Manual pre-add probe (R4-R7, R13): resolves, connects, and runs one read-only query
 *  against a candidate URL without joining the live relay pool or writing anything. */
export async function probeRelay(url: string): Promise<ProbeResult> {
  return invoke<ProbeResult>('probe_relay', { url });
}

/** Fetches the certificate a `wss://` relay presents over an isolated handshake (R8-R10).
 *  `null` covers every non-certificate outcome -- a `ws://` URL, an unreachable host, and a
 *  stalled handshake are all indistinguishable to the panel. */
export async function getRelayCertificate(url: string): Promise<RelayCertificate | null> {
  return invoke<RelayCertificate | null>('get_relay_certificate', { url });
}

/** Maps a classified failure code to its label, falling back to the raw code for a value
 *  this catalog doesn't recognize yet rather than rendering blank. Shared by the relay-list
 *  failure reason and the probe's unreachable outcome -- both carry the same `RelayFailure`. */
export function relayFailureLabel(code: string): string {
  switch (code) {
    case 'dns_failed':
      return get(t)('lib.relay.failure.dnsFailed');
    case 'connection_refused':
      return get(t)('lib.relay.failure.connectionRefused');
    case 'network_unreachable':
      return get(t)('lib.relay.failure.networkUnreachable');
    case 'timed_out':
      return get(t)('lib.relay.failure.timedOut');
    case 'tls_failed':
      return get(t)('lib.relay.failure.tlsFailed');
    case 'protocol_error':
      return get(t)('lib.relay.failure.protocolError');
    case 'auth_required':
      return get(t)('lib.relay.failure.authRequired');
    case 'not_a_relay':
      return get(t)('lib.relay.failure.notARelay');
    case 'invalid_url':
      return get(t)('lib.relay.failure.invalidUrl');
    case 'unknown':
      return get(t)('lib.relay.failure.unknown');
    default:
      return code;
  }
}

/** Maps a probe outcome to its display label -- the success message includes the backend's
 *  measured round-trip time; a failure delegates to {@link relayFailureLabel}. */
export function probeResultLabel(result: ProbeResult): string {
  if (result.outcome === 'reachable') {
    return get(t)('settings.relayProbeSuccess', { values: { ms: result.round_trip_ms } });
  }
  return relayFailureLabel(result.failure.code);
}

/** Maps the backend's computed expiry verdict to its label. The 30-day threshold and the
 *  verdict itself are backend-owned (KTD10); this never recomputes them. */
export function relayCertExpiryLabel(verdict: string): string {
  switch (verdict) {
    case 'valid':
      return get(t)('settings.relayCertExpiryValid');
    case 'expiring_soon':
      return get(t)('settings.relayCertExpiryWarning');
    case 'expired':
      return get(t)('settings.relayCertExpiryExpired');
    default:
      return verdict;
  }
}
