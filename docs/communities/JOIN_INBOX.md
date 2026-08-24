# Join inbox (wire)

Private Commons join: requesters **DM the squad Join inbox** (shared Nostr identity); holders fan out into MLS. No public Kind 30078 join request/response.

**Terms:** **Join inbox** / **Join inbox key** (nsec) / **Join inbox npub** / **Join inbox holders**. Do not confuse with EVM **squad key** (roster signer).

## Init and ownership

- `join_inbox_init` runs at **squad create** (creator = sole holder). It refuses to mint when the announcements MLS group already has other members and the caller is not the group creator.
- Settings **Initialize** may sync first; mint only if the solo/creator gate allows. Opening Settings never auto-mints.
- Same-`keyEpoch` MLS meta cannot replace `inboxNpub`. Higher epoch is a real rotate. Same-epoch overwrite of holders with a different inbox npub is rejected.
- Split fingerprint (`secret.inbox_npub != meta.inbox_npub` at the same epoch): holder sync / Settings reload reclaim the local secret, bump epoch, and republish public meta.
- Squad state sync republishes **public** `pacto.squad.join_inbox.meta.v1` only (no nsec).

## Channel backing

`join_requests` is a **virtual bucket** on the **announcements MLS group** (same physical `groupId` as `#announcements` / `#personal-alerts` / `#polls`). UI surfaces pending requests under **`#settings` → Squad → Join requests**.

| UI / wire | Bucket | Notes |
|---------|--------|--------|
| `#announcements` | `announcements` | Includes Join inbox meta + key-rotated notices |
| Join requests (Settings) | `join_requests` | Pending + accept/reject state |
| Alerts (Settings) | `inbox` | Rotate-key prompts for holders |
| `#polls` | `polls` | Unchanged |

Normative enum: [`docs/mls/VIRTUAL_CHANNEL_ROUTING_ADR.md`](../mls/VIRTUAL_CHANNEL_ROUTING_ADR.md).

## MLS JSON schemas (v1)

All MLS JSON messages set `pacto_virtual_bucket` and, when tags are available, matching `pacto_bucket`.

### `pacto.squad.join_inbox.meta.v1` → `announcements`

Public-to-squad roster (no private key):

```json
{
  "schema": "pacto.squad.join_inbox.meta.v1",
  "pacto_virtual_bucket": "announcements",
  "squadId": "<announcements MLS group id>",
  "inboxNpub": "npub1…",
  "holders": ["npub1…"],
  "keyEpoch": 1,
  "updatedAt": 1710000000
}
```

Higher epoch wins for identity; same epoch may update holders only when `inboxNpub` matches.

### `pacto.squad.join_inbox.key_rotated.v1` → `announcements`

```json
{
  "schema": "pacto.squad.join_inbox.key_rotated.v1",
  "pacto_virtual_bucket": "announcements",
  "squadId": "<id>",
  "inboxNpub": "npub1…",
  "keyEpoch": 2,
  "rotatedByNpub": "npub1…",
  "updatedAt": 1710000000
}
```

### `pacto.squad.join_inbox.rotate_prompt.v1` → `inbox`

```json
{
  "schema": "pacto.squad.join_inbox.rotate_prompt.v1",
  "pacto_virtual_bucket": "inbox",
  "squadId": "<id>",
  "keyEpoch": 1,
  "reason": "holder_removed",
  "removedHolderNpub": "npub1…",
  "updatedAt": 1710000000
}
```

### `pacto.squad.join_inbox_dm.v1` → NIP-17 to Join inbox

Requester → inbox (gift wrap). Holders unwrap and fan out to MLS:

```json
{
  "schema": "pacto.squad.join_inbox_dm.v1",
  "requestId": "<requester-generated UUID>",
  "squadId": "<id>",
  "squadName": "…",
  "broadcastEventId": "<commons event id>"
}
```

### `pacto.squad.join_request.v1` → `join_requests`

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

### `pacto.squad.join_inbox_response.v1` → NIP-17 to requester

```json
{
  "schema": "pacto.squad.join_inbox_response.v1",
  "squadId": "<id>",
  "squadName": "…",
  "requestId": "<same as MLS request>",
  "status": "accepted"
}
```

## Join inbox key share (not MLS group plaintext)

```json
{
  "schema": "pacto.squad.join_inbox.key_share.v1",
  "squadId": "<id>",
  "inboxNpub": "npub1…",
  "keyEpoch": 2,
  "nsec": "nsec1…"
}
```

Store nsec only in account-encrypted local storage. Never put `nsec` in MLS content. Key share without local meta stores the secret only; it does not invent a holders list.

## Commons

Squad discovery broadcasts are **signed by the Join inbox identity**. Requesters DM the card author (inbox npub).

After **key rotation**, the next broadcast uses the new inbox npub. Stale cards may still point at the previous npub until they expire or a holder cancels and rebroadcasts.

## Related

Holder Settings UI and Join inbox init are in-app. Only Join inbox holders with a local secret Accept/Reject. Captain / Squad Admin as holder authority is a later feature.
