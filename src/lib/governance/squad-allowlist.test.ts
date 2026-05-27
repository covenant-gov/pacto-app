import { describe, expect, it } from 'vitest';
import {
  buildAllowlistAnnouncePayload,
  findAllowlistLabel,
  formatAllowlistAnnounceMessage,
  squadAllowlistEntryId,
  type SquadContractAllowlistRow,
} from './squad-allowlist';

const PARENT = 'test-parent-mls-id';
const ROW: SquadContractAllowlistRow = {
  id: squadAllowlistEntryId(PARENT, 'sepolia', '0x1111111111111111111111111111111111111111'),
  parentId: PARENT,
  chain: 'sepolia',
  contractAddress: '0x1111111111111111111111111111111111111111',
  label: 'Test protocol',
  addedByNpub: 'npub1test',
  createdAtMs: 1,
  updatedAtMs: 1,
};

describe('squad allowlist helpers', () => {
  it('builds stable entry ids', () => {
    expect(squadAllowlistEntryId(PARENT, 'sepolia', '0xAAA')).toContain('allowlist-');
    expect(squadAllowlistEntryId(PARENT, 'sepolia', '0xaaa')).toContain('0xaaa');
  });

  it('formats announce wire message', () => {
    const payload = buildAllowlistAnnouncePayload({ parentId: PARENT, action: 'upsert', row: ROW });
    const raw = formatAllowlistAnnounceMessage(payload);
    const parsed = JSON.parse(raw) as { type: string; pacto_virtual_bucket: string };
    expect(parsed.type).toBe('squad_contract_allowlist_updated');
    expect(parsed.pacto_virtual_bucket).toBe('inbox');
  });

  it('finds label for matching target', () => {
    expect(findAllowlistLabel([ROW], 'sepolia', ROW.contractAddress)).toBe('Test protocol');
    expect(findAllowlistLabel([ROW], 'mainnet', ROW.contractAddress)).toBeNull();
  });
});
