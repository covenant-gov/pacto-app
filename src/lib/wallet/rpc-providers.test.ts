import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildAlchemyRpcUrl,
  resolveProviderPrimaryRpcUrl,
  resolveProviderRpcUrls,
} from './rpc-providers';

describe('rpc providers', () => {
  const env = import.meta.env as ImportMetaEnv & Record<string, string | undefined>;

  beforeEach(() => {
    delete env.ALCHEMY_RPC_KEY;
  });

  afterEach(() => {
    delete env.ALCHEMY_RPC_KEY;
  });

  it('builds Alchemy URLs per chain host', () => {
    expect(buildAlchemyRpcUrl('mainnet', 'demo-key')).toBe(
      'https://eth-mainnet.g.alchemy.com/v2/demo-key',
    );
    expect(buildAlchemyRpcUrl('sepolia', 'demo-key')).toBe(
      'https://eth-sepolia.g.alchemy.com/v2/demo-key',
    );
    expect(buildAlchemyRpcUrl('arbitrum', 'demo-key')).toBe(
      'https://arb-mainnet.g.alchemy.com/v2/demo-key',
    );
  });

  it('resolves primary URL when ALCHEMY_RPC_KEY is set', () => {
    env.ALCHEMY_RPC_KEY = 'my-key';
    expect(resolveProviderPrimaryRpcUrl('arbitrum')).toBe(
      'https://arb-mainnet.g.alchemy.com/v2/my-key',
    );
  });

  it('appends curated fallbacks after provider primary', () => {
    env.ALCHEMY_RPC_KEY = 'my-key';
    const urls = resolveProviderRpcUrls('sepolia');
    expect(urls[0]).toBe('https://eth-sepolia.g.alchemy.com/v2/my-key');
    expect(urls.length).toBeGreaterThan(1);
    expect(urls).toContain('https://ethereum-sepolia-rpc.publicnode.com');
  });
});
