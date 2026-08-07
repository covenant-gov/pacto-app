import { describe, expect, it } from 'vitest';
import {
  formatBotJoinDm,
  formatJoinResponseDm,
  formatMlsJoinRequest,
  formatMlsJoinRequestResponse,
  isExpectedNonHolderBotSyncError,
  mergeJoinRequestsFromMlsMessages,
  parseBotJoinDm,
  parseBotJoinResponseDm,
  SQUAD_BOT_JOIN_DM_SCHEMA,
  SQUAD_BOT_JOIN_RESPONSE_DM_SCHEMA,
  SQUAD_JOIN_REQUEST_SCHEMA,
} from './squad-join-mls';

describe('squad-join-mls wire', () => {
  it('formats bot join dm', () => {
    const raw = formatBotJoinDm({
      squadId: 's1',
      squadName: 'Pirates',
      broadcastEventId: 'e1',
    });
    const parsed = JSON.parse(raw);
    expect(parsed.schema).toBe(SQUAD_BOT_JOIN_DM_SCHEMA);
    expect(parsed.squadId).toBe('s1');
  });

  it('formats join response dm', () => {
    const raw = formatJoinResponseDm({
      squadId: 's1',
      squadName: 'Pirates',
      requestId: 'r1',
      status: 'rejected',
    });
    const parsed = JSON.parse(raw);
    expect(parsed.schema).toBe(SQUAD_BOT_JOIN_RESPONSE_DM_SCHEMA);
    expect(parsed.status).toBe('rejected');
  });

  it('parses bot join response dm and rejects invalid status/fields', () => {
    expect(
      parseBotJoinResponseDm(
        formatJoinResponseDm({
          squadId: 's1',
          squadName: 'Pirates',
          requestId: 'r1',
          status: 'accepted',
        }),
      ),
    ).toEqual({
      squadId: 's1',
      squadName: 'Pirates',
      requestId: 'r1',
      status: 'accepted',
    });
    expect(parseBotJoinResponseDm(null)).toBeNull();
    expect(parseBotJoinResponseDm('plain')).toBeNull();
    expect(parseBotJoinResponseDm('{')).toBeNull();
    expect(parseBotJoinResponseDm(JSON.stringify({ schema: SQUAD_BOT_JOIN_DM_SCHEMA }))).toBeNull();
    expect(
      parseBotJoinResponseDm(
        JSON.stringify({
          schema: SQUAD_BOT_JOIN_RESPONSE_DM_SCHEMA,
          status: 'pending',
          squadId: 's1',
          requestId: 'r1',
        }),
      ),
    ).toBeNull();
    expect(
      parseBotJoinResponseDm(
        JSON.stringify({
          schema: SQUAD_BOT_JOIN_RESPONSE_DM_SCHEMA,
          status: 'rejected',
          squadId: '  ',
          requestId: 'r1',
        }),
      ),
    ).toBeNull();
    expect(
      parseBotJoinResponseDm(
        JSON.stringify({
          schema: SQUAD_BOT_JOIN_RESPONSE_DM_SCHEMA,
          status: 'rejected',
          squadId: 's1',
          squadName: '',
          requestId: 'r1',
        }),
      ),
    ).toEqual({
      squadId: 's1',
      squadName: 's1',
      requestId: 'r1',
      status: 'rejected',
    });
  });

  it('parses bot join dm and fills optional defaults', () => {
    expect(
      parseBotJoinDm(
        JSON.stringify({
          schema: SQUAD_BOT_JOIN_DM_SCHEMA,
          squadId: 's1',
          broadcastEventId: 'e1',
        }),
      ),
    ).toEqual({
      requestId: '',
      squadId: 's1',
      squadName: 's1',
      broadcastEventId: 'e1',
      requesterNpub: '',
      createdAt: 0,
    });
    expect(parseBotJoinDm(undefined)).toBeNull();
    expect(parseBotJoinDm('{bad')).toBeNull();
    expect(
      parseBotJoinDm(
        JSON.stringify({
          schema: SQUAD_BOT_JOIN_DM_SCHEMA,
          squadId: '',
          broadcastEventId: 'e1',
        }),
      ),
    ).toBeNull();
    expect(
      parseBotJoinDm(
        JSON.stringify({
          schema: SQUAD_BOT_JOIN_DM_SCHEMA,
          squadId: 's1',
          squadName: 'Pirates',
          broadcastEventId: 'e1',
          requestId: 'r1',
          requesterNpub: 'npub1req',
          createdAt: 99,
        }),
      ),
    ).toMatchObject({ squadName: 'Pirates', createdAt: 99, requestId: 'r1' });
  });

  it('merges pending requests and applies first response', () => {
    const req = formatMlsJoinRequest({
      requestId: 'r1',
      squadId: 's1',
      squadName: 'Pirates',
      broadcastEventId: 'e1',
      requesterNpub: 'npub1req',
      createdAt: 10,
      forwardedByNpub: 'npub1holder',
    });
    const resp = formatMlsJoinRequestResponse({
      requestId: 'r1',
      squadId: 's1',
      status: 'accepted',
      responderNpub: 'npub1holder',
      respondedAt: 20,
    });
    const pending = mergeJoinRequestsFromMlsMessages([
      { content: req, at: 10 },
      { content: resp, at: 20 },
    ]);
    expect(pending).toEqual([]);
  });

  it('keeps pending when no response', () => {
    const req = formatMlsJoinRequest({
      requestId: 'r2',
      squadId: 's1',
      squadName: 'Pirates',
      broadcastEventId: 'e1',
      requesterNpub: 'npub1req',
      createdAt: 10,
      forwardedByNpub: 'npub1holder',
    });
    const pending = mergeJoinRequestsFromMlsMessages([{ content: req, at: 10 }]);
    expect(pending).toHaveLength(1);
    expect(pending[0].eventId).toBe('r2');
    expect(pending[0].status).toBe('pending');
  });

  it('first response wins', () => {
    const req = formatMlsJoinRequest({
      requestId: 'r3',
      squadId: 's1',
      squadName: 'Pirates',
      broadcastEventId: 'e1',
      requesterNpub: 'npub1req',
      createdAt: 10,
      forwardedByNpub: 'npub1a',
    });
    const accept = formatMlsJoinRequestResponse({
      requestId: 'r3',
      squadId: 's1',
      status: 'accepted',
      responderNpub: 'npub1a',
      respondedAt: 11,
    });
    const reject = formatMlsJoinRequestResponse({
      requestId: 'r3',
      squadId: 's1',
      status: 'rejected',
      responderNpub: 'npub1b',
      respondedAt: 12,
    });
    const pending = mergeJoinRequestsFromMlsMessages([
      { content: req, at: 10 },
      { content: accept, at: 11 },
      { content: reject, at: 12 },
    ]);
    expect(pending).toEqual([]);
    expect(JSON.parse(accept).schema).toBeDefined();
    expect(SQUAD_JOIN_REQUEST_SCHEMA).toContain('join_request');
  });

  it('merge skips invalid wires and fills request defaults', () => {
    const pending = mergeJoinRequestsFromMlsMessages([
      { content: null, at: 1 },
      { content: 'plain', at: 2 },
      { content: JSON.stringify({ schema: SQUAD_JOIN_REQUEST_SCHEMA, requestId: 'r4' }), at: 3 },
      {
        content: JSON.stringify({
          schema: SQUAD_JOIN_REQUEST_SCHEMA,
          requestId: 'r5',
          squadId: 's1',
          requesterNpub: 'npub1req',
        }),
        at: 5,
      },
      {
        content: JSON.stringify({
          schema: SQUAD_JOIN_REQUEST_SCHEMA,
          requestId: 'r5',
          squadId: 's1',
          requesterNpub: 'npub1other',
          squadName: 'Ignored dup',
        }),
        at: 6,
      },
      {
        content: JSON.stringify({
          schema: 'pacto.other.v1',
          requestId: 'r6',
          squadId: 's1',
          requesterNpub: 'npub1req',
        }),
        at: 7,
      },
      {
        content: JSON.stringify({
          schema: 'pacto.squad.join_request_response.v1',
          requestId: 'orphan',
          status: 'accepted',
        }),
        at: 8,
      },
      {
        content: JSON.stringify({
          schema: 'pacto.squad.join_request_response.v1',
          requestId: 'r5',
          status: 'wat',
        }),
        at: 9,
      },
      { content: '{', at: undefined },
    ]);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      eventId: 'r5',
      squadName: 'Squad',
      broadcastEventId: '',
      createdAt: 5,
      status: 'pending',
    });
  });
});

describe('isExpectedNonHolderBotSyncError', () => {
  it('treats holder/secret errors as expected for non-holders', () => {
    expect(isExpectedNonHolderBotSyncError('Only bot key holders can perform this action')).toBe(true);
    expect(isExpectedNonHolderBotSyncError('Local bot secret required')).toBe(true);
    expect(isExpectedNonHolderBotSyncError('Bot not initialized')).toBe(true);
    expect(isExpectedNonHolderBotSyncError('stale keypackage')).toBe(true);
    expect(isExpectedNonHolderBotSyncError('MLS offline')).toBe(false);
  });
});
