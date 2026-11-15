import { describe, expect, it } from 'vitest';
import { pactoNftCatalog } from './pacto-nft-catalog';

describe('pactoNftCatalog', () => {
  it('lists the username NFT contract on sepolia', () => {
    const rows = pactoNftCatalog('sepolia');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('username');
    expect(rows[0]?.contract.startsWith('0x')).toBe(true);
  });

  it('returns no entries on networks without a username NFT', () => {
    expect(pactoNftCatalog('arbitrum')).toEqual([]);
  });
});
