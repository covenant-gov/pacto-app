import { describe, expect, it } from 'vitest';
import {
  formatBotJoinDm,
  formatJoinResponseDm,
  formatMlsJoinRequest,
  formatMlsJoinRequestResponse,
  isExpectedNonHolderBotSyncError,
  mergeJoinRequestsFromMlsMessages,
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
});

describe('isExpectedNonHolderBotSyncError', () => {
  it('treats holder/secret errors as expected for non-holders', () => {
    expect(isExpectedNonHolderBotSyncError('Only bot key holders can perform this action')).toBe(true);
    expect(isExpectedNonHolderBotSyncError('Local bot secret required')).toBe(true);
    expect(isExpectedNonHolderBotSyncError('MLS offline')).toBe(false);
  });
});
