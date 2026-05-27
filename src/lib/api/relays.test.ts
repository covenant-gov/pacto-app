import { describe, it, expect } from 'vitest';
import { relayModeLabel, relayStatusLabel, validateRelayUrlInput } from './relays';

describe('validateRelayUrlInput', () => {
  it('accepts wss URLs with host', () => {
    expect(validateRelayUrlInput('wss://relay.damus.io')).toBeNull();
    expect(validateRelayUrlInput('  wss://relay.example.com/path  ')).toBeNull();
  });

  it('rejects empty and non-wss URLs', () => {
    expect(validateRelayUrlInput('')).toBeTruthy();
    expect(validateRelayUrlInput('ws://relay.example.com')).toBeTruthy();
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
