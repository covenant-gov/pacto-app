# Squad bot join inbox (wire sketch)

Private Commons join: requesters **DM the squad bot**; holders fan out into MLS. No public Kind 30078 join request/response.

## Channel backing

`#join-requests` is a **virtual bucket** on the **announcements MLS group** (same physical `groupId` as `#announcements` / `#personal-alerts` / `#polls`).

| Sidebar | Wire bucket | Notes |
|---------|-------------|--------|
| `#announcements` | `announcements` | Includes bot metadata + key-rotated notices |
| `#join-requests` | `join_requests` | Pending + accept/reject state |
| `#personal-alerts` | `inbox` | Rotate-key prompts for holders |
| `#polls` | `polls` | Unchanged |

Normative enum: [`docs/mls/VIRTUAL_CHANNEL_ROUTING_ADR.md`](../mls/VIRTUAL_CHANNEL_ROUTING_ADR.md).

## MLS JSON schemas (v1)

All MLS JSON messages set `pacto_virtual_bucket` and, when tags are available, matching `pacto_bucket`.

### `pacto.squad_bot.meta.v1` → `announcements`

Public-to-squad bot roster (no private key):

```json
{
  "schema": "pacto.squad_bot.meta.v1",
  "pacto_virtual_bucket": "announcements",
  "squadId": "<announcements MLS group id>",
  "botNpub": "npub1…",
  "holders": ["npub1…"],
  "keyEpoch": 1,
  "updatedAt": 1710000000
}
```

Latest epoch wins for UI (replaceable by epoch, not by Nostr `d`).

### `pacto.squad_bot.key_rotated.v1` → `announcements`

Squad-wide notice after rotate:

```json
{
  "schema": "pacto.squad_bot.key_rotated.v1",
  "pacto_virtual_bucket": "announcements",
  "squadId": "<id>",
  "botNpub": "npub1…",
  "keyEpoch": 2,
  "rotatedByNpub": "npub1…",
  "updatedAt": 1710000000
}
```

### `pacto.squad_bot.rotate_prompt.v1` → `inbox`

Personal-alerts nudge when a holder is removed (remaining holders):

```json
{
  "schema": "pacto.squad_bot.rotate_prompt.v1",
  "pacto_virtual_bucket": "inbox",
  "squadId": "<id>",
  "keyEpoch": 1,
  "reason": "holder_removed",
  "removedHolderNpub": "npub1…",
  "updatedAt": 1710000000
}
```

### `pacto.squad.bot_join_dm.v1` → NIP-17 to bot

Requester → bot (gift wrap). Holders unwrap with bot keys and fan out to MLS:

```json
{
  "schema": "pacto.squad.bot_join_dm.v1",
  "squadId": "<id>",
  "squadName": "…",
  "broadcastEventId": "<commons event id>"
}
```

`requestId` for MLS fan-out is the inner rumor event id (stable across holders).

### `pacto.squad.join_request.v1` → `join_requests`

Fan-out after a holder unwraps a bot DM (dedupe on `requestId`):

```json
{
  "schema": "pacto.squad.join_request.v1",
  "pacto_virtual_bucket": "join_requests",
  "requestId": "<stable id from DM or hash>",
  "squadId": "<id>",
  "requesterNpub": "npub1…",
  "broadcastEventId": "<commons event id>",
  "squadName": "…",
  "status": "pending",
  "createdAt": 1710000000,
  "forwardedByNpub": "npub1…"
}
```

### `pacto.squad.join_request_response.v1` → `join_requests`

First write wins while status is still pending:

```json
{
  "schema": "pacto.squad.join_request_response.v1",
  "pacto_virtual_bucket": "join_requests",
  "requestId": "<same as request>",
  "squadId": "<id>",
  "status": "accepted",
  "responderNpub": "npub1…",
  "respondedAt": 1710000001
}
```

`status`: `accepted` | `rejected`.

### `pacto.squad.bot_join_response.v1` → NIP-17 to requester

After accept/reject, the operator sends a private DM to the requester (same gift-wrap path as other DMs):

```json
{
  "schema": "pacto.squad.bot_join_response.v1",
  "squadId": "<id>",
  "squadName": "…",
  "requestId": "<same as MLS request>",
  "status": "accepted"
}
```

Accept still delivers the MLS welcome + squad invite DM separately.

## Bot key share (not MLS group plaintext)

NIP-17 DM from rotating holder → each current holder npub:

```json
{
  "schema": "pacto.squad_bot.key_share.v1",
  "squadId": "<id>",
  "botNpub": "npub1…",
  "keyEpoch": 2,
  "nsec": "nsec1…"
}
```

Store nsec only in account-encrypted local storage. Never put `nsec` in MLS content visible to all members.

## Commons

Squad discovery broadcasts are **signed by the bot**. Requesters DM the card author (bot npub), same pattern as user→user Commons DM.

After **key rotation**, the next broadcast uses the new bot npub. Stale cards may still point at the previous bot until they expire or a holder cancels and rebroadcasts.

## Related

Holder Settings UI and bot init are in-app. Public Kind 30078 join request/response is retired; join is bot DM + MLS only.
