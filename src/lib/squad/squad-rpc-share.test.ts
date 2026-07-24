import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatSquadRpcUpdated,
  parseSquadRpcUpdated,
  SQUAD_RPC_UPDATED_TYPE,
} from './squad-rpc-share';
import { defaultPublicSlot, unsetSlot, urlSlot } from './squad-rpc';

vi.mock('../api/nostr', () => ({
  sendDmMessage: vi.fn(),
}));

describe('squad-rpc-share', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formats and parses squad_rpc_updated without user default fields', () => {
    const rpc1 = urlSlot('https://primary.example/rpc')!;
    const rpc2 = defaultPublicSlot();
    const raw = formatSquadRpcUpdated({
      parentId: 'gid-1',
      config: { chain: 'sepolia', rpc1, rpc2 },
    });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.type).toBe(SQUAD_RPC_UPDATED_TYPE);
    expect(parsed.payload).toEqual({
      parent_id: 'gid-1',
      chain: 'sepolia',
      rpc1,
      rpc2,
    });
    expect(parseSquadRpcUpdated(raw)).toEqual({
      parent_id: 'gid-1',
      chain: 'sepolia',
      rpc1,
      rpc2,
    });
  });

  it('rejects invalid payloads', () => {
    expect(parseSquadRpcUpdated('{"type":"other"}')).toBeNull();
    expect(
      parseSquadRpcUpdated(
        JSON.stringify({
          type: SQUAD_RPC_UPDATED_TYPE,
          payload: { parent_id: 'x', chain: 'mainnet', rpc1: unsetSlot(), rpc2: unsetSlot() },
        }),
      ),
    ).toBeNull();
  });

  it('rejects mismatched payload version', () => {
    const rpc1 = urlSlot('https://primary.example/rpc')!;
    const rpc2 = defaultPublicSlot();
    const raw = formatSquadRpcUpdated({
      parentId: 'gid-1',
      config: { chain: 'sepolia', rpc1, rpc2 },
    });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    parsed.version = 999;
    expect(parseSquadRpcUpdated(JSON.stringify(parsed))).toBeNull();
  });
});
