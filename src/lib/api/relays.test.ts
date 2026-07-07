import { describe, it, expect } from 'vitest';
import { relayModeLabel, relayStatusLabel, validateRelayUrlInput } from './relays';

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

describe('relayStatusLabel', () => {
  it('maps connected and disabled', () => {
    expect(relayStatusLabel('connected')).toBe('Connected');
    expect(relayStatusLabel('disabled')).toBe('Disabled');
  });
});
