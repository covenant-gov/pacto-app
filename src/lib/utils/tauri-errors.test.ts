import { describe, it, expect, beforeEach } from 'vitest';
import { initI18n, DEFAULT_LOCALE } from '../i18n';
import { getInvokeErrorMessage, friendlyMessage } from './tauri-errors';

beforeEach(async () => {
  await initI18n(DEFAULT_LOCALE);
});

describe('getInvokeErrorMessage', () => {
  it('returns fallback for null/undefined', () => {
    expect(getInvokeErrorMessage(null)).toBe('Something went wrong');
    expect(getInvokeErrorMessage(undefined)).toBe('Something went wrong');
    expect(getInvokeErrorMessage(undefined, 'Custom fallback')).toBe('Custom fallback');
  });

  it('returns string errors trimmed', () => {
    expect(getInvokeErrorMessage('  oops  ')).toBe('oops');
  });

  it('unwraps stringified wallet_err_json to message', () => {
    expect(
      getInvokeErrorMessage('{"code":"ACL_DENIED","message":"Requires Captain hat."}')
    ).toBe('Requires Captain hat.');
  });

  it('unwraps wallet_err_json nested in Error.message', () => {
    expect(
      getInvokeErrorMessage(new Error('{"code":"ACL_DENIED","message":"Requires Captain hat."}'))
    ).toBe('Requires Captain hat.');
  });

  it('unwraps nested wallet_err_json message payloads', () => {
    expect(
      getInvokeErrorMessage(
        '{"code":"SPONSOR_READ","message":"{\\"code\\":\\"ETH_CALL_FAILED\\",\\"message\\":\\"execution reverted\\"}"}'
      )
    ).toBe('execution reverted');
  });

  it('falls back when string error is empty/whitespace', () => {
    expect(getInvokeErrorMessage('   ', 'fallback')).toBe('fallback');
    expect(getInvokeErrorMessage('')).toBe('Something went wrong');
  });

  it('extracts message from plain object', () => {
    expect(getInvokeErrorMessage({ message: '  backend error  ' })).toBe('backend error');
  });

  it('extracts error from plain object', () => {
    expect(getInvokeErrorMessage({ error: '  backend error  ' })).toBe('backend error');
  });

  it('extracts message from nested data', () => {
    expect(getInvokeErrorMessage({ data: { message: '  nested  ' } })).toBe('nested');
  });

  it('extracts error from nested data', () => {
    expect(getInvokeErrorMessage({ data: { error: '  nested  ' } })).toBe('nested');
  });

  it('extracts message from Error instance', () => {
    expect(getInvokeErrorMessage(new Error('  error instance  '))).toBe('error instance');
  });

  it('prefers message over error', () => {
    expect(getInvokeErrorMessage({ message: 'first', error: 'second' })).toBe('first');
  });

  it('returns fallback when no recognizable field exists', () => {
    expect(getInvokeErrorMessage({ code: 500 })).toBe('Something went wrong');
  });
});

describe('friendlyMessage', () => {
  it('passes through unknown generic messages', () => {
    expect(friendlyMessage('some error')).toBe('some error');
  });

  it('maps invalid npub in dm_send context', () => {
    expect(friendlyMessage('invalid npub', 'dm_send')).toBe(
      'Please enter a valid npub (starts with npub1).'
    );
    expect(friendlyMessage('Invalid Pubkey', 'dm_send')).toBe(
      'Please enter a valid npub (starts with npub1).'
    );
  });

  it('maps not initialized in dm_send context', () => {
    expect(friendlyMessage('client not initialized', 'dm_send')).toBe('Please log in first.');
  });

  it('maps missing required key / invalid args in dm_send context', () => {
    expect(friendlyMessage('missing required key', 'dm_send')).toBe(
      'Invalid request. Please try again.'
    );
    expect(friendlyMessage('Invalid args', 'dm_send')).toBe('Invalid request. Please try again.');
  });

  it('localizes the relay-unreachable key-package abort and keeps the member list', () => {
    const raw =
      'Network error: could not reach the relays to check key packages for: npub1qqqqqqq…, npub1zzzzzzz…';
    expect(friendlyMessage(raw)).toBe(
      "Couldn't reach the relays to check whether npub1qqqqqqq…, npub1zzzzzzz… can be added. Nothing was created — try again."
    );
  });

  it('maps reverted sponsor eth_call errors to the balance-load copy', () => {
    expect(
      friendlyMessage(
        '{"code":"ETH_CALL_FAILED","message":"server returned an error response: error code 3: execution reverted"}',
        'sponsor'
      )
    ).toBe('Could not load sponsor balance.');
    expect(friendlyMessage('execution reverted', 'sponsor')).toBe('Could not load sponsor balance.');
    expect(friendlyMessage('execution reverted')).toBe('execution reverted');
  });
});
