import { describe, expect, it } from 'vitest';
import { CURATED_RPC_URLS, getCuratedRpcUrlsForChain } from './rpc-catalog';

describe('CURATED_RPC_URLS.local', () => {
  it('lists only the localhost Anvil RPC', () => {
    expect(CURATED_RPC_URLS.local).toEqual(['http://localhost:8545']);
  });
});

describe('getCuratedRpcUrlsForChain', () => {
  it('returns a defensive copy for local', () => {
    const urls = getCuratedRpcUrlsForChain('local');
    expect(urls).toEqual(['http://localhost:8545']);
    urls.push('https://example.com');
    expect(CURATED_RPC_URLS.local).toEqual(['http://localhost:8545']);
  });
});
