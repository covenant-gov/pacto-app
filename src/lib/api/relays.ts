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
}

export interface CustomRelay {
  url: string;
  enabled: boolean;
  mode: RelayMode;
}

/** Client-side check before invoking add_custom_relay. Returns an error message or null if OK. */
export function validateRelayUrlInput(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return 'Enter a relay URL.';
  if (!trimmed.startsWith('wss://')) return 'Relay URL must start with wss://';
  const host = trimmed.slice('wss://'.length).replace(/\/+$/, '');
  if (!host) return 'Relay URL must include a host.';
  return null;
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

export async function setRelayEnabled(relay: RelayInfo, enabled: boolean): Promise<boolean> {
  if (relay.is_custom) return toggleCustomRelay(relay.url, enabled);
  if (relay.is_default) return toggleDefaultRelay(relay.url, enabled);
  throw new Error('Unknown relay type');
}
