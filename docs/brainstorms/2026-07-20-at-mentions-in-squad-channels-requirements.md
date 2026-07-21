---
date: 2026-07-20
topic: at-mentions-in-squad-channels
---

# Requirements: @ Mentions in Squad Channels

## Summary

Add @ mentions to Pacto squad channels. A member typing `@` in the composer sees a member-selection interface (inline autocomplete or fuzzy command palette); selecting one inserts a structured mention into a JSON envelope that is encrypted inside the MLS group message. The receiving client renders the mention as a styled tag, highlights the message if the current user's npub appears in the `mentions` array, and surfaces a personal squad-hub alert. v1 is scoped to squad channels only; the backend never parses the mention list.

## Problem Frame

Pacto squad channels currently have no way to address a specific member inside a group message. In high-volume squads, members resort to quoting a message, typing an npub, or sending a separate DM to get someone's attention. This fragments conversation, slows coordination, and works against the Private group coordination track's goal of replacing siloed chat tools. The existing composer is a plain textarea, the roster is already loaded, and the rendering pipeline is markdown-based, but none of these pieces are wired for mentions yet.

## Key Decisions

- **Structured payload inside MLS ciphertext.** The message body and a `mentions` array travel together inside the encrypted MLS group content. No mention metadata is visible outside the ciphertext.
- **Two composition modes are supported.** The primary path is an inline autocomplete overlay over the textarea; a fuzzy command palette (Go-to-Member style) triggered by `@` is also supported as an alternative interaction.
- **Custom `marked` extension for rendering.** Mentions are rendered by extending `marked` rather than by injecting raw HTML before markdown parsing, keeping the security boundary in one place and avoiding edge cases like mentions inside code blocks.
- **Frontend-only notification in v1.** The receiving client checks `mentions` against its own npub and triggers a local highlight and squad-hub alert. No backend push notification or server-side parsing happens in v1.

## Actors

- **A1. Sender** — A squad member composing a message who wants to get another member's attention.
- **A2. Mentioned recipient** — The squad member whose npub appears in the `mentions` array.
- **A3. Other member** — A squad member who sees the message but is not named in `mentions`.

## Requirements

### Composition

- R1. Typing `@` at a word boundary in the squad composer opens a member selection interface.
- R2. The default interface is an inline autocomplete overlay anchored to the textarea cursor.
- R3. The composer also supports a fuzzy command palette (Go-to-Member style) triggered by `@` that lists squad members and inserts a mention token when one is selected.
- R4. The selection interface lists candidates from the current squad's `membersByGroupId` and `$profiles` store, searchable by nickname, name, display name, and shortened npub.
- R5. Selecting a candidate inserts a mention token into the composer. The visible text is `@alias`; the canonical target is the member's npub.
- R6. Multiple mentions are allowed in a single message.

### Wire format and encryption

- R7. Squad messages use a JSON envelope with two fields: `body` (the human-readable text) and `mentions` (an array of mention objects).
- R8. Each mention object contains at least `npub` (canonical target) and `alias` (display handle used at send time).
- R9. The JSON envelope is encrypted inside the MLS group message. No mention list, alias, or npub appears in plaintext outside the ciphertext.
- R10. The wire format change is gated to squad messages and does not affect existing DMs or historical squad messages.

### Rendering

- R11. The `marked` renderer renders a mention as a safe inline element: `<span class="mention" data-npub="npub1...">@alias</span>`.
- R12. Mention rendering must survive the existing Markdown → Linkify → DOMPurify → Twemoji → DOMPurify pipeline without creating an XSS surface.
- R13. A mention inside a code block, preformatted text, or inline code is rendered as literal text, not as a mention tag.
- R14. The rendered alias is resolved from the current `$profiles` store at render time, so profile changes update the visible name without changing the underlying npub.

### Notification and highlight

- R15. After decrypting a squad message, the client checks whether the current user's npub appears in `mentions`.
- R16. If the current user is mentioned, the message receives a visible highlight class in the message list.
- R17. If the current user is mentioned, the corresponding squad channel increments a personal alert in the squad-hub alert store and renders a badge in `Channel.svelte`.
- R18. The backend does not parse, store, or act on the mention list.

## Key Flows

### F1. Compose and send a mention

- **Trigger:** A1 focuses the squad composer and types `@`.
- **Actors:** A1.
- **Steps:**
  1. Client detects `@` and opens a member-selection interface (inline autocomplete or fuzzy command palette) sourced from `membersByGroupId` + `$profiles`.
  2. A1 selects a candidate. The composer inserts `@alias` with the npub bound as the mention target.
  3. A1 sends the message. The client produces a JSON envelope `{ body, mentions }` and encrypts it inside the MLS group message.
  4. The message is published to the MLS group as a Kind 444 event with the encrypted payload.
- **Outcome:** A2 and other members receive the encrypted message; no plaintext mention metadata is visible to relays.

### F2. Receive and render a mention addressed to me

- **Trigger:** A2 receives a decrypted `mls_message_new` event whose `mentions` array contains A2's npub.
- **Actors:** A2.
- **Steps:**
  1. Client decrypts the message and parses the JSON envelope.
  2. The `marked` extension renders the mention as a `<span class="mention">` tag.
  3. Client applies a highlight class to the message row.
  4. Client increments the personal alert for the squad and updates the channel badge.
- **Outcome:** A2 sees a highlighted message and a badge indicating they were mentioned.

### F3. Receive a mention addressed to someone else

- **Trigger:** A3 receives a decrypted message whose `mentions` array does not contain A3's npub.
- **Actors:** A3.
- **Steps:**
  1. Client decrypts the message and renders the mention tag normally.
  2. Client does not apply a highlight or personal alert for A3.
- **Outcome:** A3 sees the mention rendered but receives no notification.

## Acceptance Examples

- AE1. **Autocomplete disambiguation.** Given two squad members with the same nickname "Alex", when A1 types `@Alex`, the autocomplete shows both entries with their distinct avatars and npub suffixes. Selecting one inserts the correct mention.

- AE2. **Stable identity across profile changes.** Given a message that mentions A2 with `alias: "Alice"`, when A2 later changes their display name to "Alicia", the existing message renders as `@Alicia` because the rendered alias is resolved from the current `$profiles` store by npub.

- AE3. **Mention inside code is literal.** Given A1 sends a message containing ` `@npub1...` ` (inside backticks), the rendered output shows literal monospace text, not a styled mention tag, and no alert is generated.

- AE4. **No metadata leakage.** Given A1 mentions A2 in a squad message, when a relay inspects the published Kind 444 event, the relay sees only the group `h` tag and ciphertext; the `mentions` array, alias, and target npub are not visible.

## Scope Boundaries

### Deferred for later

- DMs.
- `@all`, `@here`, or role-based mentions.
- Native OS push notifications for mentions.
- Message editing that preserves or updates mention lists.
- A plaintext fallback wire format for non-Pacto clients.
- Backend analytics, search indexing, or server-side routing based on mentions.

### Outside this product's identity

- Letting the backend parse or store the mention list outside the MLS ciphertext.
- Displaying mention metadata in notifications that the server sends.
- Supporting mentions that target users outside the squad.

## Dependencies and Assumptions

- **Assumption:** `membersByGroupId` and `$profiles` already provide reliable nickname/name/display_name/npub data for the current squad.
- **Dependency:** The `formatMessageContent` pipeline in `src/lib/utils/message-formatting.ts` accepts a `marked` extension.
- **Dependency:** The squad-hub alert store (`src/stores/squad-hub-alerts.ts`) can represent a personal mention alert distinct from join-request and roster-signer alerts.
- **Dependency:** Squad messages are encrypted with MLS so that only current members can decrypt the JSON envelope.

## Outstanding Questions

- **Resolved before planning:** Should the rendered alias come from the `alias` field in the envelope or from the current profile store at render time? **Resolution:** Render-time profile store lookup by npub.
- **Resolved before planning:** Should the mention list live inside or outside the MLS ciphertext? **Resolution:** Inside the ciphertext.
- **Deferred to planning:** Exact tokenizer syntax for the `marked` extension (e.g., `[@alias](npub1...)` vs. a custom token emitted by the composer).
- **Deferred to planning:** How the composer keeps the visible `@alias` and the bound npub in sync while the user is still editing the message.
- **Deferred to planning:** Migration or backward-compatibility strategy for existing squad messages that lack the JSON envelope.

## Sources and Research

- Ideation artifact: `docs/ideation/2026-07-20-at-mentions-in-squad-channels-ideation.html`
- Shared composer: `src/components/dm/MessageInput.svelte`
- Message formatting pipeline: `src/lib/utils/message-formatting.ts`
- Squad roster data: `src/stores/mls-group-members.ts`
- Profile cache: `src/stores/profiles.ts` and `src/lib/utils/profile.ts`
- Squad alerts: `src/stores/squad-hub-alerts.ts`
- MLS message event wiring: `src/lib/app/tauri-subscriptions.ts`
