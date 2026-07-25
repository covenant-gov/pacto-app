// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DmMessage } from '../../stores/dm';

const mockFetchMsgMetadata = vi.fn();
const mockDmError = vi.fn();

vi.mock('../api/nostr', () => ({
  fetchMsgMetadata: (...args: unknown[]) => mockFetchMsgMetadata(...args),
}));

vi.mock('../utils/dm-debug', () => ({
  dmError: (...args: unknown[]) => mockDmError(...args),
}));

import { requestLinkPreview, clearLinkPreviewRequests } from './link-preview';

function msg(overrides: Partial<DmMessage> = {}): DmMessage {
  return {
    id: 'm1',
    content: 'check https://example.com out',
    at: 0,
    mine: false,
    ...overrides,
  };
}

describe('requestLinkPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchMsgMetadata.mockResolvedValue(true);
    clearLinkPreviewRequests();
  });

  it('fetches metadata for a message with a URL and no existing preview', () => {
    requestLinkPreview('chat1', msg());
    expect(mockFetchMsgMetadata).toHaveBeenCalledWith('chat1', 'm1');
  });

  it('does not fetch for a message without a URL', () => {
    requestLinkPreview('chat1', msg({ content: 'no links here' }));
    expect(mockFetchMsgMetadata).not.toHaveBeenCalled();
  });

  it('does not fetch when preview metadata is already present', () => {
    requestLinkPreview(
      'chat1',
      msg({ preview_metadata: { domain: 'example.com' } })
    );
    expect(mockFetchMsgMetadata).not.toHaveBeenCalled();
  });

  it('does not fetch for a pending (unconfirmed) message', () => {
    requestLinkPreview('chat1', msg({ pending: true }));
    expect(mockFetchMsgMetadata).not.toHaveBeenCalled();
  });

  it('does not fetch twice for the same message id, even across separate calls', () => {
    requestLinkPreview('chat1', msg());
    requestLinkPreview('chat1', msg());
    expect(mockFetchMsgMetadata).toHaveBeenCalledTimes(1);
  });

  it('backfills previews for messages loaded from history, not just live events', () => {
    // Simulates a chat-open / load-older call site loading a batch of historical
    // messages that never got their preview fetched before the app last quit.
    const historicalBatch = [
      msg({ id: 'h1', content: 'https://a.example.com' }),
      msg({ id: 'h2', content: 'no url' }),
      msg({ id: 'h3', content: 'https://b.example.com', preview_metadata: { domain: 'b.example.com' } }),
    ];
    historicalBatch.forEach((m) => requestLinkPreview('chat1', m));
    expect(mockFetchMsgMetadata).toHaveBeenCalledTimes(1);
    expect(mockFetchMsgMetadata).toHaveBeenCalledWith('chat1', 'h1');
  });

  it('clearLinkPreviewRequests resets the dedupe set so a message can be re-requested', () => {
    requestLinkPreview('chat1', msg());
    clearLinkPreviewRequests();
    requestLinkPreview('chat1', msg());
    expect(mockFetchMsgMetadata).toHaveBeenCalledTimes(2);
  });

  it('reports fetch failures via dmError instead of throwing', async () => {
    mockFetchMsgMetadata.mockRejectedValueOnce(new Error('network down'));
    requestLinkPreview('chat1', msg());
    await Promise.resolve();
    await Promise.resolve();
    expect(mockDmError).toHaveBeenCalledWith('fetchMsgMetadata', expect.any(Error));
  });

  it('caps concurrent fetches and drains the queue as earlier ones resolve', async () => {
    const resolvers: Array<() => void> = [];
    mockFetchMsgMetadata.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(() => resolve());
        })
    );

    const messages = Array.from({ length: 5 }, (_, i) =>
      msg({ id: `q${i}`, content: `https://example.com/${i}` })
    );
    messages.forEach((m) => requestLinkPreview('chat1', m));

    // MAX_CONCURRENT_FETCHES is 3: only the first 3 fire immediately, the rest queue.
    expect(mockFetchMsgMetadata).toHaveBeenCalledTimes(3);

    resolvers[0]();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockFetchMsgMetadata).toHaveBeenCalledTimes(4);

    resolvers[1]();
    resolvers[2]();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockFetchMsgMetadata).toHaveBeenCalledTimes(5);
  });
});
