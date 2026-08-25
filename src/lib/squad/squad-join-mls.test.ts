import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  clearJoinRequestRespondInFlight,
  formatJoinInboxDm,
  formatJoinResponseDm,
  formatMlsJoinRequest,
  formatMlsJoinRequestResponse,
  isExpectedNonHolderJoinInboxSyncError,
  isJoinRequestRespondInFlight,
  joinRequestRespondInFlight,
  joinRequestRespondInFlightRevision,
  markJoinRequestRespondInFlight,
  mergeJoinRequestsFromMlsMessages,
  parseJoinInboxDm,
  parseJoinInboxResponseDm,
  resetJoinRequestRespondInFlight,
  JOIN_INBOX_DM_SCHEMA,
  JOIN_INBOX_RESPONSE_DM_SCHEMA,
  SQUAD_JOIN_REQUEST_SCHEMA,
} from './squad-join-mls';

describe('squad-join-mls wire', () => {
  it('formats bot join dm', () => {
    const raw = formatJoinInboxDm({
      requestId: 'r1',
      squadId: 's1',
      squadName: 'Pirates',
      broadcastEventId: 'e1',
    });
    const parsed = JSON.parse(raw);
    expect(parsed.schema).toBe(JOIN_INBOX_DM_SCHEMA);
    expect(parsed.requestId).toBe('r1');
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
    expect(parsed.schema).toBe(JOIN_INBOX_RESPONSE_DM_SCHEMA);
    expect(parsed.status).toBe('rejected');
  });

  it('parses bot join response dm and rejects invalid status/fields', () => {
    expect(
      parseJoinInboxResponseDm(
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
    expect(parseJoinInboxResponseDm(null)).toBeNull();
    expect(parseJoinInboxResponseDm('plain')).toBeNull();
    expect(parseJoinInboxResponseDm('{')).toBeNull();
    expect(parseJoinInboxResponseDm(JSON.stringify({ schema: JOIN_INBOX_DM_SCHEMA }))).toBeNull();
    expect(
      parseJoinInboxResponseDm(
        JSON.stringify({
          schema: JOIN_INBOX_RESPONSE_DM_SCHEMA,
          status: 'pending',
          squadId: 's1',
          requestId: 'r1',
        }),
      ),
    ).toBeNull();
    expect(
      parseJoinInboxResponseDm(
        JSON.stringify({
          schema: JOIN_INBOX_RESPONSE_DM_SCHEMA,
          status: 'rejected',
          squadId: '  ',
          requestId: 'r1',
        }),
      ),
    ).toBeNull();
    expect(
      parseJoinInboxResponseDm(
        JSON.stringify({
          schema: JOIN_INBOX_RESPONSE_DM_SCHEMA,
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
      parseJoinInboxDm(
        JSON.stringify({
          schema: JOIN_INBOX_DM_SCHEMA,
          requestId: 'r1',
          squadId: 's1',
          broadcastEventId: 'e1',
        }),
      ),
    ).toEqual({
      requestId: 'r1',
      squadId: 's1',
      squadName: 's1',
      broadcastEventId: 'e1',
      requesterNpub: '',
      createdAt: 0,
    });
    expect(parseJoinInboxDm(undefined)).toBeNull();
    expect(parseJoinInboxDm('{bad')).toBeNull();
    expect(
      parseJoinInboxDm(
        JSON.stringify({
          schema: JOIN_INBOX_DM_SCHEMA,
          squadId: 's1',
          broadcastEventId: 'e1',
        }),
      ),
    ).toBeNull();
    expect(
      parseJoinInboxDm(
        JSON.stringify({
          schema: JOIN_INBOX_DM_SCHEMA,
          squadId: '',
          broadcastEventId: 'e1',
        }),
      ),
    ).toBeNull();
    expect(
      parseJoinInboxDm(
        JSON.stringify({
          schema: JOIN_INBOX_DM_SCHEMA,
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

describe('isExpectedNonHolderJoinInboxSyncError', () => {
  it('silences true non-holder denials but surfaces init/stale for holders', () => {
    expect(isExpectedNonHolderJoinInboxSyncError('Only Join inbox holders can perform this action')).toBe(true);
    expect(isExpectedNonHolderJoinInboxSyncError('No local Join inbox key (not a holder on this device)')).toBe(
      true
    );
    expect(isExpectedNonHolderJoinInboxSyncError('Local Join inbox key is stale — ask a holder to re-share')).toBe(
      false
    );
    expect(isExpectedNonHolderJoinInboxSyncError('Join inbox not initialized — open Join inbox settings first')).toBe(
      false
    );
    expect(isExpectedNonHolderJoinInboxSyncError('MLS offline')).toBe(false);
  });
});

describe('join request respond in-flight', () => {
  beforeEach(() => {
    resetJoinRequestRespondInFlight();
  });

  afterEach(() => {
    resetJoinRequestRespondInFlight();
  });

  it('marks, checks, and clears request event ids', () => {
    const before = get(joinRequestRespondInFlightRevision);
    expect(isJoinRequestRespondInFlight('evt-1')).toBe(false);

    markJoinRequestRespondInFlight('evt-1');
    expect(isJoinRequestRespondInFlight('evt-1')).toBe(true);
    expect(get(joinRequestRespondInFlight).has('evt-1')).toBe(true);
    expect(get(joinRequestRespondInFlightRevision)).toBe(before + 1);

    clearJoinRequestRespondInFlight('evt-1');
    expect(isJoinRequestRespondInFlight('evt-1')).toBe(false);
    expect(get(joinRequestRespondInFlightRevision)).toBe(before + 2);
  });

  it('reset clears in-flight set', () => {
    markJoinRequestRespondInFlight('evt-1');
    resetJoinRequestRespondInFlight();
    expect(isJoinRequestRespondInFlight('evt-1')).toBe(false);
    expect(get(joinRequestRespondInFlight).size).toBe(0);
    expect(get(joinRequestRespondInFlightRevision)).toBe(0);
  });
});
