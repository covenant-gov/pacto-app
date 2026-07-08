import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  validateRelayUrlInput,
  relayModeLabel,
  listRelays,
  addCustomRelay,
  removeCustomRelay,
  toggleCustomRelay,
  toggleDefaultRelay,
  setRelayEnabled,
} from './relays';

vi.mock('@tauri-apps/api/core');

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset();
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
});

