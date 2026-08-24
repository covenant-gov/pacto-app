import { describe, expect, it } from 'vitest';
import { rpcReadErrorKind, uniqueRpcReadErrorKinds } from './rpc-read-error';

const ALLNODES_429 =
  'HTTP error 429 with body: {"jsonrpc":"2.0","error":{"code":-32005,"message":"Rate limit exceeded. To obtain higher limits, please request a personal token or a dedicated node: https://www.allnodes.com/publicnode"},"id":31}';

describe('rpcReadErrorKind', () => {
  it('classifies the Allnodes Sepolia 429 body as rate_limited', () => {
    expect(rpcReadErrorKind(ALLNODES_429)).toBe('rate_limited');
  });

  it('classifies HTTP 429 and -32005 without the Allnodes host', () => {
    expect(rpcReadErrorKind('HTTP error 429')).toBe('rate_limited');
    expect(rpcReadErrorKind('jsonrpc error code -32005')).toBe('rate_limited');
  });

  it('classifies RPC_CONNECT JSON as unreachable', () => {
    expect(
      rpcReadErrorKind(
        '{"code":"RPC_CONNECT","message":"tried 5 URL(s), last error: RPC connect timeout"}',
      ),
    ).toBe('unreachable');
  });

  it('classifies connect timeout and tried-N-URLs copy as unreachable', () => {
    expect(rpcReadErrorKind('RPC connect timeout')).toBe('unreachable');
    expect(rpcReadErrorKind('tried 3 URL(s), last error: invalid RPC URL')).toBe('unreachable');
  });

  it('returns null for non-RPC chain errors', () => {
    expect(rpcReadErrorKind('Not allowed for your role.')).toBeNull();
    expect(rpcReadErrorKind('execution reverted: Unauthorized')).toBeNull();
    expect(rpcReadErrorKind('INVALID_TREASURY_AUTHORITY')).toBeNull();
    expect(rpcReadErrorKind('')).toBeNull();
    expect(rpcReadErrorKind(null)).toBeNull();
  });
});

describe('uniqueRpcReadErrorKinds', () => {
  it('dedupes identical rate-limit errors from parallel reads', () => {
    expect(uniqueRpcReadErrorKinds(ALLNODES_429, ALLNODES_429)).toEqual(['rate_limited']);
  });

  it('keeps distinct transport kinds in first-seen order', () => {
    expect(
      uniqueRpcReadErrorKinds(
        ALLNODES_429,
        '{"code":"RPC_CONNECT","message":"tried 5 URL(s), last error: RPC connect timeout"}',
      ),
    ).toEqual(['rate_limited', 'unreachable']);
  });

  it('ignores non-RPC chain errors', () => {
    expect(
      uniqueRpcReadErrorKinds(
        'Not allowed for your role.',
        ALLNODES_429,
        'execution reverted: Unauthorized',
      ),
    ).toEqual(['rate_limited']);
  });
});
