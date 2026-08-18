import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { initI18n, DEFAULT_LOCALE } from '../i18n';
import {
  validateRelayUrlInput,
  relayModeLabel,
  listRelays,
  addCustomRelay,
  removeCustomRelay,
  toggleCustomRelay,
  toggleDefaultRelay,
  setRelayEnabled,
  getRelayMetrics,
  getRelayLogs,
  hasRelayHealthData,
  probeRelay,
  getRelayCertificate,
  relayFailureLabel,
  probeResultLabel,
  relayCertExpiryLabel,
  type RelayMetrics,
  type RelayFailureCode,
  type ExpiryVerdict,
} from './relays';

vi.mock('@tauri-apps/api/core');

const mockedInvoke = vi.mocked(invoke);

beforeEach(async () => {
  mockedInvoke.mockReset();
  await initI18n(DEFAULT_LOCALE);
});


describe('validateRelayUrlInput', () => {
  it('accepts wss URLs with host', () => {
    expect(validateRelayUrlInput('wss://relay.damus.io')).toBeNull();
    expect(validateRelayUrlInput('  wss://relay.example.com/path  ')).toBeNull();
  });

  it('accepts ws:// localhost dev relays', () => {
    expect(validateRelayUrlInput('ws://localhost:7000')).toBeNull();
    expect(validateRelayUrlInput('ws://localhost')).toBeNull();
    expect(validateRelayUrlInput('ws://127.0.0.1:7000')).toBeNull();
  });

  it('rejects empty and non-local ws:// URLs', () => {
    expect(validateRelayUrlInput('')).toBeTruthy();
    expect(validateRelayUrlInput('ws://relay.example.com')).toBeTruthy();
    expect(validateRelayUrlInput('ws://localhost.evil.com')).toBeTruthy();
    expect(validateRelayUrlInput('ws://user@localhost:7000')).toBeTruthy();
    expect(validateRelayUrlInput('https://relay.example.com')).toBeTruthy();
    expect(validateRelayUrlInput('wss://')).toBeTruthy();
  });
});

describe('relayModeLabel', () => {
  it('maps known modes', () => {
    expect(relayModeLabel('read')).toBe('Read only');
    expect(relayModeLabel('write')).toBe('Write only');
    expect(relayModeLabel('both')).toBe('Read & write');
  });
});

describe('setRelayEnabled', () => {
  it('routes custom relays to toggleCustomRelay', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    const result = await setRelayEnabled(
      { url: 'wss://custom', status: 'connected', is_default: false, is_custom: true, enabled: true, mode: 'both' },
      false
    );
    expect(mockedInvoke).toHaveBeenCalledWith('toggle_custom_relay', {
      url: 'wss://custom',
      enabled: false,
    });
    expect(result).toBe(true);
  });

  it('routes default relays to toggleDefaultRelay', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    const result = await setRelayEnabled(
      { url: 'wss://default', status: 'connected', is_default: true, is_custom: false, enabled: true, mode: 'both' },
      false
    );
    expect(mockedInvoke).toHaveBeenCalledWith('toggle_default_relay', {
      url: 'wss://default',
      enabled: false,
    });
    expect(result).toBe(true);
  });

  it('throws for unknown relay type', async () => {
    await expect(
      setRelayEnabled(
        { url: 'wss://unknown', status: 'connected', is_default: false, is_custom: false, enabled: true, mode: 'both' },
        false
      )
    ).rejects.toThrow('Unknown relay type');
  });
});

describe('relay command wrappers', () => {
  it('listRelays sends get_relays', async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    const result = await listRelays();
    expect(mockedInvoke).toHaveBeenCalledWith('get_relays');
    expect(result).toEqual([]);
  });

  it('addCustomRelay sends add_custom_relay with default mode', async () => {
    const relay = { url: 'wss://custom', enabled: true, mode: 'both' as const };
    mockedInvoke.mockResolvedValueOnce(relay);
    const result = await addCustomRelay('wss://custom');
    expect(mockedInvoke).toHaveBeenCalledWith('add_custom_relay', {
      url: 'wss://custom',
      mode: 'both',
    });
    expect(result).toEqual(relay);
  });

  it('addCustomRelay passes custom mode', async () => {
    mockedInvoke.mockResolvedValueOnce({ url: 'wss://custom', enabled: true, mode: 'read' as const });
    await addCustomRelay('wss://custom', 'read');
    expect(mockedInvoke).toHaveBeenCalledWith('add_custom_relay', {
      url: 'wss://custom',
      mode: 'read',
    });
  });

  it('removeCustomRelay sends remove_custom_relay', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    const result = await removeCustomRelay('wss://custom');
    expect(mockedInvoke).toHaveBeenCalledWith('remove_custom_relay', { url: 'wss://custom' });
    expect(result).toBe(true);
  });

  it('toggleCustomRelay sends toggle_custom_relay', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    const result = await toggleCustomRelay('wss://custom', true);
    expect(mockedInvoke).toHaveBeenCalledWith('toggle_custom_relay', {
      url: 'wss://custom',
      enabled: true,
    });
    expect(result).toBe(true);
  });

  it('toggleDefaultRelay sends toggle_default_relay', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    const result = await toggleDefaultRelay('wss://default', false);
    expect(mockedInvoke).toHaveBeenCalledWith('toggle_default_relay', {
      url: 'wss://default',
      enabled: false,
    });
    expect(result).toBe(true);
  });

  it('getRelayMetrics sends get_relay_metrics', async () => {
    const metrics = {
      ping_ms: 42,
      bytes_up: 0,
      bytes_down: 0,
      last_check: 1700000000,
      events_received: 0,
      events_sent: 0,
    };
    mockedInvoke.mockResolvedValueOnce(metrics);
    const result = await getRelayMetrics('wss://relay.example.com');
    expect(mockedInvoke).toHaveBeenCalledWith('get_relay_metrics', { url: 'wss://relay.example.com' });
    expect(result).toEqual(metrics);
  });

  it('getRelayLogs sends get_relay_logs', async () => {
    const logs = [{ timestamp: 1700000000, level: 'info', message: 'Status changed to connected' }];
    mockedInvoke.mockResolvedValueOnce(logs);
    const result = await getRelayLogs('wss://relay.example.com');
    expect(mockedInvoke).toHaveBeenCalledWith('get_relay_logs', { url: 'wss://relay.example.com' });
    expect(result).toEqual(logs);
  });

  it('probeRelay sends probe_relay with the url and passes the result through', async () => {
    const result = { outcome: 'reachable' as const, round_trip_ms: 87 };
    mockedInvoke.mockResolvedValueOnce(result);
    const got = await probeRelay('wss://relay.example.com');
    expect(mockedInvoke).toHaveBeenCalledWith('probe_relay', { url: 'wss://relay.example.com' });
    expect(got).toEqual(result);
  });

  it('getRelayCertificate sends get_relay_certificate with the url and passes the result through', async () => {
    const cert = {
      subject: 'CN=relay.example.com',
      issuer: 'CN=relay.example.com',
      not_before: 1_700_000_000,
      not_after: 1_800_000_000,
      san_dns_names: ['relay.example.com'],
      public_key_algorithm: 'EC',
      public_key_bits: 256,
      sha256_fingerprint: 'ab:cd',
      trust_not_evaluated: true as const,
      expiry_verdict: 'valid' as const,
    };
    mockedInvoke.mockResolvedValueOnce(cert);
    const got = await getRelayCertificate('wss://relay.example.com');
    expect(mockedInvoke).toHaveBeenCalledWith('get_relay_certificate', {
      url: 'wss://relay.example.com',
    });
    expect(got).toEqual(cert);
  });

  it('getRelayCertificate passes through a null result for a non-certificate outcome', async () => {
    mockedInvoke.mockResolvedValueOnce(null);
    const got = await getRelayCertificate('ws://localhost:7000');
    expect(got).toBeNull();
  });
});

describe('hasRelayHealthData', () => {
  const base: RelayMetrics = {
    ping_ms: null,
    bytes_up: 0,
    bytes_down: 0,
    last_check: null,
    events_received: 0,
    events_sent: 0,
  };

  it('returns false when never checked', () => {
    expect(hasRelayHealthData(base)).toBe(false);
  });

  it('returns true when ping_ms is set', () => {
    expect(hasRelayHealthData({ ...base, ping_ms: 42 })).toBe(true);
  });

  it('returns true when last_check is set', () => {
    expect(hasRelayHealthData({ ...base, last_check: 1700000000 })).toBe(true);
  });
});


describe('relayFailureLabel', () => {
  const codes: RelayFailureCode[] = [
    'dns_failed',
    'connection_refused',
    'network_unreachable',
    'timed_out',
    'tls_failed',
    'protocol_error',
    'auth_required',
    'not_a_relay',
    'invalid_url',
    'unknown',
  ];

  it('maps every failure code to a distinct, non-empty label', () => {
    const labels = codes.map((code) => relayFailureLabel(code));
    expect(labels.every((label) => label.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(codes.length);
  });

  it('falls back to the raw code for an unrecognized value', () => {
    expect(relayFailureLabel('some_future_code')).toBe('some_future_code');
  });
});

describe('probeResultLabel', () => {
  it('includes the round-trip time for a reachable result', () => {
    const label = probeResultLabel({ outcome: 'reachable', round_trip_ms: 123 });
    expect(label).toContain('123');
  });

  it('delegates to relayFailureLabel for an unreachable result', () => {
    const label = probeResultLabel({
      outcome: 'unreachable',
      failure: { code: 'dns_failed', detail: null },
    });
    expect(label).toBe(relayFailureLabel('dns_failed'));
  });
});

describe('relayCertExpiryLabel', () => {
  const verdicts: ExpiryVerdict[] = ['valid', 'expiring_soon', 'expired'];

  it('maps every verdict to a distinct, non-empty label', () => {
    const labels = verdicts.map((v) => relayCertExpiryLabel(v));
    expect(labels.every((label) => label.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(verdicts.length);
  });

  it('falls back to the raw value for an unrecognized verdict', () => {
    expect(relayCertExpiryLabel('some_future_verdict')).toBe('some_future_verdict');
  });
});
