import { invoke } from '@tauri-apps/api/core';

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

export interface RelayInfo {
  url: string;
  status: RelayStatus;
  is_default: boolean;
  is_custom: boolean;
  enabled: boolean;
  mode: string;
  failure_reason?: string | null;
}

export interface CustomRelay {
  url: string;
  enabled: boolean;
  mode: RelayMode;
}

/** A single health-check or monitor log entry for a relay. */
export interface RelayLog {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

/** Per-relay health-check metrics. */
export interface RelayMetrics {
  ping_ms?: number | null;
  bytes_up: number;
  bytes_down: number;
  last_check?: number | null;
  events_received: number;
  events_sent: number;
}

/** Read-only TLS certificate metadata for a wss:// relay. */
export interface RelayCertificate {
  subject: string;
  issuer: string;
  not_before: number;
  not_after: number;
  san_list: string[];
  sha256_fingerprint: string;
  key_algorithm: string;
  key_bits: number;
  validation_error?: string | null;
}

/** Result of a throwaway pre-add relay probe. */
export interface ProbeResult {
  status: string;
  rtt_ms?: number | null;
  message?: string | null;
}

/** Known probe status values returned by the backend. */
export type ProbeStatus =
  | 'healthy'
  | 'timeout'
  | 'connection_refused'
  | 'dns_failed'
  | 'not_a_relay'
  | 'protocol_error'
  | 'tls_certificate_expired'
  | 'tls_certificate_invalid'
  | 'tls_failed'
  | 'connection_failed'
  | 'unknown';

/** Client-side check before invoking add_custom_relay. Returns an error message or null if OK. */
export function validateRelayUrlInput(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return 'Enter a relay URL.';

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return 'Relay URL must start with wss:// (ws:// is allowed only for localhost/127.0.0.1 development relays)';
  }

  if (!parsed.host) return 'Relay URL must include a host.';
  if (parsed.username || parsed.password) return 'Relay URL must not contain userinfo.';

  if (parsed.protocol === 'wss:') return null;

  if (parsed.protocol === 'ws:') {
    const host = parsed.hostname;
    const isLocalhost = host === 'localhost';
    const isLoopback = host === '127.0.0.1';
    if (isLocalhost || isLoopback) return null;
  }

  return 'Relay URL must start with wss:// (ws:// is allowed only for localhost/127.0.0.1 development relays)';
}

export function relayModeLabel(mode: string): string {
  switch (mode) {
    case 'read':
      return 'Read only';
    case 'write':
      return 'Write only';
    default:
      return 'Read & write';
  }
}

export function relayStatusLabel(status: string): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting';
    case 'pending':
      return 'Pending';
    case 'initialized':
      return 'Initialized';
    case 'disconnected':
      return 'Disconnected';
    case 'terminated':
      return 'Terminated';
    case 'banned':
      return 'Banned';
    case 'sleeping':
      return 'Sleeping';
    case 'disabled':
      return 'Disabled';
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

export async function getRelayLogs(url: string, _limit = 20): Promise<RelayLog[]> {
  return invoke<RelayLog[]>('get_relay_logs', { url });
}

export async function getRelayMetrics(url: string): Promise<RelayMetrics> {
  return invoke<RelayMetrics>('get_relay_metrics', { url });
}

export async function getRelayCertificate(url: string): Promise<RelayCertificate | null> {
  return invoke<RelayCertificate | null>('get_relay_certificate', { url });
}

export async function probeRelay(url: string): Promise<ProbeResult> {
  return invoke<ProbeResult>('probe_relay', { url });
}

export async function setRelayEnabled(relay: RelayInfo, enabled: boolean): Promise<boolean> {
  if (relay.is_custom) return toggleCustomRelay(relay.url, enabled);
  if (relay.is_default) return toggleDefaultRelay(relay.url, enabled);
  throw new Error('Unknown relay type');
}
