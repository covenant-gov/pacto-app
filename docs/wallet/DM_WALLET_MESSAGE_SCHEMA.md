# DM wallet messages — JSON schema

This document defines the **machine-readable `content`** for two DM-only message kinds used by the WalletBar flows:

| Wire `type` value           | Purpose |
|----------------------------|---------|
| `wallet_tx_request`        | Sender asks the counterparty to pay (or acknowledges terms of a payment request). Rendered as a **request card** in the thread. |
| `wallet_tx_announcement`   | Posted **only after** a successful on-chain receipt (see [TRANSACTION_LIFECYCLE.md](./TRANSACTION_LIFECYCLE.md)). Renders as a **transaction / announcement card**. |

They are **not** the same envelope as squad/network **`# announcements`** messages (`parseAnnouncement` in `src/lib/announcements.ts`). Wallet DM payloads live in **1:1 DM threads** and use the same general idea as other structured DMs (`squad_invite`, `channel_in_squad`, …): **one JSON object** in `content`, UTF-8, with a top-level `type` string discriminator.

---

## Versioning

- Every object includes **`version`** (integer). The current spec is **`version: 1`**.
- Clients **must** reject (do not render as wallet UI) objects with **`version`** greater than the highest version they implement (forward compatibility).
- Implementations **require** **`version === 1`** for these wallet types; missing or other values are treated as plain text, not wallet cards.

---

## Shared enums

### `network`

Must match **`SupportedChainId`** in `src/lib/wallet/chains.ts` (and rows in `wallet-assets.json`):

| Value       | Meaning              |
|------------|----------------------|
| `mainnet`  | Ethereum mainnet     |
| `optimism` | OP Mainnet           |
| `sepolia`  | Ethereum Sepolia     |

### `asset`

Must match **`WalletAssetCode`** in `src/lib/wallet/assets.ts`:

| Value  | Meaning        |
|--------|----------------|
| `ETH`  | Native ETH     |
| `USDC` | ERC-20 USDC    |
| `USDT` | ERC-20 USDT    |

### Amounts

- Field **`amount`** is always a **decimal string** in **human units** (e.g. `"0.1"`, `"12.345678"`), not a JSON number.
- Rationale: avoids floating-point drift; matches backend “decimal string” input described alongside the WalletBar product spec.
- Restrictions for v1:
  - Non-empty after trim.
  - Match `^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$` (no sign, no scientific notation); allows a leading-dot fraction (e.g. `".00001"`).
  - Reasonable length cap (e.g. ≤ 32 characters) to bound message size.

### Identifiers

- **`request_id`**: opaque string, **unique per request** in normal use. Implementations should use a **UUID** (e.g. RFC 4122 string) unless a shorter collision-resistant id is agreed.
- **`tx_hash`**: `0x` + 64 hexadecimal characters (EIP-119).

### Nostr npubs

- **`from_npub`** / **`to_npub`**: bech32 `npub1…` strings as used elsewhere in Pacto.

---

## `wallet_tx_request` (v1)

Posted by the user who **creates** the request. The **recipient** is the other participant in the DM (inferable from the MLS/DM context); parsers **should not** rely on optional duplicate fields for identity.

| Field         | Type    | Required | Description |
|---------------|---------|----------|-------------|
| `version`     | number  | yes      | Must be `1`. |
| `type`        | string  | yes      | Must be `wallet_tx_request`. |
| `request_id`  | string  | yes      | Unique id for idempotency and linking to announcements. |
| `network`     | string  | yes      | `mainnet` \| `optimism` \| `sepolia`. |
| `asset`       | string  | yes      | `ETH` \| `USDC` \| `USDT`. |
| `amount`      | string  | yes      | Human decimal amount (see above). |
| `from_evm_address` | string | yes | Posting user’s **active** EVM signer: `0x` + 40 hex. |
| `created_at_ms` | number | no     | Unix ms when the client created the request (for display ordering). |

### Example (compact, production)

```json
{"version":1,"type":"wallet_tx_request","request_id":"550e8400-e29b-41d4-a716-446655440000","network":"sepolia","asset":"ETH","amount":"0.05","from_evm_address":"0x1111111111111111111111111111111111111111","created_at_ms":1710000000000}
```

---

## `wallet_tx_announcement` (v1)

Posted **only** after a **successful** transaction receipt. Carries everything needed to render “A sent **amount** **asset** on **network**” plus explorer linkage.

| Field          | Type   | Required | Description |
|----------------|--------|----------|-------------|
| `version`      | number | yes      | Must be `1`. |
| `type`         | string | yes      | Must be `wallet_tx_announcement`. |
| `network`      | string | yes      | `mainnet` \| `optimism` \| `sepolia`. |
| `asset`        | string | yes      | `ETH` \| `USDC` \| `USDT`. |
| `amount`       | string | yes      | Human decimal amount (should match what was sent). |
| `tx_hash`      | string | yes      | `0x` + 64 hex. |
| `from_npub`    | string | yes      | Sender’s npub. |
| `to_npub`      | string | yes      | Recipient’s npub. |
| `from_evm_address` | string | yes | EVM account that **signed** the transfer: `0x` + 40 hex (should match on-chain `from`). |
| `request_id`   | string | no       | If present, ties this transfer to a prior `wallet_tx_request` (e.g. “paid this request”). |
| `block_number` | string | no       | Decimal string block number from receipt (optional; avoids JS int issues if very large). |

**Note:** There is no separate `status` field for MVP: **presence** of a valid `wallet_tx_announcement` in the chat implies **confirmed** success, per [TRANSACTION_LIFECYCLE.md](./TRANSACTION_LIFECYCLE.md).

### Example (compact, production)

```json
{"version":1,"type":"wallet_tx_announcement","network":"sepolia","asset":"USDC","amount":"10.00","tx_hash":"0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789","from_npub":"npub1sender…","to_npub":"npub1recipient…","from_evm_address":"0x1111111111111111111111111111111111111111","request_id":"550e8400-e29b-41d4-a716-446655440000","block_number":"12345678"}
```

---

## Message size and transport

- Keep the JSON **compact** (no unnecessary whitespace) in production.
- Typical v1 payloads are **hundreds of bytes** UTF-8. Stay **well under ~2 KiB** for `content` so limits on Nostr events, relays, and the Pacto backend remain safe. Do **not** embed large memos or blobs in v1; if needed later, use a separate field with a strict max length (e.g. 200 characters) and document it in a new **version**.

---

## Wire format summary

1. `content` is a **single JSON object** (not an array, not double-encoded).
2. Parsing: trim leading/trailing whitespace; `JSON.parse` the whole string; validate `type`, `version`, and required fields.
3. Invalid or unknown **`type`** / **`version`**: treat as normal text (do not render wallet cards).

---

## Request card state (client)

- **Accepted / declined:** Persisted per account (npub-scoped lists of DM **message ids**), same pattern as channel invite decisions. Toggling choice updates both lists so a message id is not simultaneously accepted and declined. **Decline** does **not** post a DM: only local/UI state (and a client toast for the person who declined); the requester sees the updated card when they sync the thread.
- **Fulfilled (paid):** Derived from the **thread message list**: if any message parses as `wallet_tx_announcement` and its optional `request_id` equals the request’s `request_id`, the matching request card shows **Paid** for everyone in the DM. This updates automatically when new messages arrive (sync). Announcements **without** `request_id` do not mark any request fulfilled.
- **Idempotency:** Appending to accept/decline lists is a no-op if the id is already present.

---

## Implementations

- **TypeScript:** `src/lib/wallet/dm-messages.ts` — `parseWalletTxRequest`, `parseWalletTxAnnouncement`, `formatWalletTxRequest`, `formatWalletTxAnnouncement`, `getFulfilledWalletRequestIdsFromMessages`.
- **Tests:** `src/lib/wallet/dm-messages.test.ts` (`npm run test`).
- **UI:** `WalletTxRequestCard` / `WalletTxAnnouncementCard` in `src/components/wallet/`; rendered by `DmMessageRouter.svelte` (mounted from `DmThread.svelte`).

---

## See also

- [README.md](./README.md) — index of wallet docs.
- [../shell/LAYOUT.md](../shell/LAYOUT.md) — `DmMessageRouter` and dashboard component map.
