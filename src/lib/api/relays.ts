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

export interface RelayInfo {
  url: string;
  status: RelayStatus;
  is_default: boolean;
  is_custom: boolean;
  enabled: boolean;
  mode: string;
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

export interface RelayLog {
  timestamp: number;
  level: string;
  message: string;
}

export async function getRelayMetrics(url: string): Promise<RelayMetrics> {
  return invoke<RelayMetrics>('get_relay_metrics', { url });
}

export async function getRelayLogs(url: string): Promise<RelayLog[]> {
  return invoke<RelayLog[]>('get_relay_logs', { url });
}

/** True once the health-check loop has recorded a ping or last-check time for this relay. */
export function hasRelayHealthData(metrics: RelayMetrics): boolean {
  return metrics.ping_ms !== null || metrics.last_check !== null;
}
