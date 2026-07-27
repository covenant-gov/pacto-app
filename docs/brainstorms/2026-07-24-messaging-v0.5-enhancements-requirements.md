---
title: Messaging v0.5 enhancements — reactions, attachments, image viewer, sync status
type: feat
date: 2026-07-24
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
origin_issues:
  - https://github.com/covenant-gov/pacto-app/issues/141
  - https://github.com/covenant-gov/pacto-app/issues/143
  - https://github.com/covenant-gov/pacto-app/issues/145
  - https://github.com/covenant-gov/pacto-app/issues/146
---

# Messaging v0.5 enhancements — reactions, attachments, image viewer, sync status

## Summary

Add the missing frontend UI and integration for backend capabilities that already exist: message reactions, file attachments, an in-app image viewer, and per-conversation sync status indicators. The goal is a coherent baseline messaging UX that works the same way in DMs and MLS squad channels.

## Problem Frame

Pacto's Rust backend already supports reactions, edits, and attachments. The Svelte frontend, however, has no consistent way to add, display, or interact with these content types. Members cannot react to a message, send or view attachments, or see whether a conversation has finished catching up with relays. This makes the app feel incomplete compared with the protocol capabilities it already ships, and forces members into workarounds (pasting URLs, sending follow-up messages, restarting the app to see new messages).

## Actors

- **A1. Sender** — A member composing a message with text or an attachment.
- **A2. Recipient / viewer** — A member reading a conversation and reacting to, viewing, or replying to messages.
- **A3. Squad participant** — The same as A2, but inside an MLS group channel where message content is encrypted to the group.
- **A4. Operator / self-user** — A member who wants to know whether their local state is in sync with the network.

## Key Flows

- **F1. React to a message.** A2 opens a per-message context menu, chooses a reaction emoji, and the reaction is sent over the existing protocol path. The message row updates to show the aggregated reaction.
- **F2. Send a file attachment.** A1 clicks the attachment affordance in the composer, picks a file, optionally sees a preview, and sends. The message appears as a file bubble in the thread.
- **F3. View an attached image.** A2 taps an image attachment and sees it in an in-app viewer with zoom and an option to open it in the system file manager.
- **F4. Check sync status.** A2 looks at a DM or squad thread header and sees whether the client is still fetching/catching up messages from relays.

## Requirements

### Reactions

- R1. Every message row (own and others, DM and MLS) exposes a way to add a reaction.
- R2. The reaction picker is the system/emoji picker used elsewhere in the composer (consistency), limited to a single emoji per reaction.
- R3. A member can add one reaction of each emoji to a given message; adding the same emoji again removes it (toggle behavior).
- R4. The client displays aggregated reactions below the message bubble as a row of emoji chips with a count.
- R5. The current user's own reactions are visually distinct from reactions left by others.
- R6. Reactions are supported for both DMs and MLS squad messages.
- R7. The backend `Message::add_reaction` path (existing `kind=7` event storage) is used unchanged.

### Attachments

- R8. The composer exposes an attachment affordance (paperclip icon) for both DMs and MLS.
- R9. Selecting a file shows a sendable preview in the composer: file name, size, and an image thumbnail when applicable.
- R10. Image attachments are compressed on the backend (`send_file_bytes` with `use_compression`) when compression saves at least 10%.
- R11. Non-image attachments are sent as-is.
- R12. The message bubble distinguishes an attachment from text and renders it safely (no inline executable previews).
- R13. The backend `send_file_bytes`, `Attachment`, and `AttachmentFile` types are reused unchanged.

### Image viewer

- R14. Tapping an image attachment opens an in-app modal/overlay viewer.
- R15. The viewer supports zoom (pinch / wheel / buttons) and pan.
- R16. The viewer has a button to reveal the file in the system file manager / folder.
- R17. The viewer closes with Escape, back button, or an explicit close affordance.
- R18. The viewer uses the existing image cache (`src-tauri/src/image_cache.rs`) where available and falls back to the original attachment path.

### Sync status indicator

- R19. DM and squad thread views display a sync status indicator in the header or message list.
- R20. The indicator communicates at least these states: idle/in-sync, catching-up/fetching, and error/failed.
- R21. The indicator reflects the existing backend sync lifecycle exposed to `src/stores/dm.ts` and related subscription events.
- R22. The indicator does not block sending or reading messages.

### Cross-cutting UX

- R23. All message actions (react, copy, reply, delete where available) live in a single per-message context menu triggered by right-click/long-press or an overflow button.
- R24. The same message row component is used for DMs and MLS squad channels; behavior differences are driven by props/store context, not separate components.
- R25. New stores/helpers added for reactions, attachment previews, and sync state must reset on logout.

## Acceptance Examples

- **AE1. Toggle reaction.** User A reacts with 👍 on a message. The message shows 👍 1. User A taps 👍 again; the reaction is removed and the count disappears.
- **AE2. Image send and view.** User A sends a photo. User B sees a thumbnail in the thread. User B taps it, sees the full image, zooms in, and opens the containing folder.
- **AE3. Sync catching up.** User opens a squad channel after being offline. A spinner/text in the header reads "Catching up…" until the relay catch-up completes, then the indicator disappears or changes to the normal state.

## Key Decisions

- **K1. Build one shared per-message context menu.** Reactions and future actions (copy, reply, delete, forward) share the same interaction surface. This keeps the message row uniform across DMs and squads.
- **K2. Attachments use the existing `send_file_bytes` backend path.** We do not invent a new wire format. Image compression stays in Rust.
- **K3. Image viewer is in-app only for v0.5.** We do not hand images to an external viewer app; we provide zoom, pan, and reveal-in-folder as the initial feature set.
- **K4. Sync status is purely informational.** It surfaces existing backend sync state; it does not introduce new protocol logic or pause the UI.

## Scope Boundaries

### Deferred for later

- Message editing (#142) — messages are currently treated as immutable until the team decides otherwise.
- Voice messages and local transcription (#144).
- Message threading / replies beyond the existing reply preview.
- Forwarding messages.
- Polls inside messages.
- Attachment download manager or global file library.
- OCR or image content analysis.
- Server-side message search.
- Push notifications for reactions or edits.

### Outside this product's identity

- Adding new backend protocol features (the backend already has reactions, edits, attachments, and image cache).
- Changing encryption or MLS semantics.
- Cloud file hosting or CDN delivery.

## Open Questions

- Q1. Does the team want a long-press context menu on mobile/tablet in addition to right-click on desktop?
- Q2. Should the context menu include a "Copy" option for message text?
- Q3. Which emoji set / picker should the reaction picker use — the existing composer emoji picker, the OS native picker, or a custom set?
- Q4. What is the maximum attachment size limit we want to enforce in the UI?

## Success Criteria

- Members can react to and attach files to messages in both DMs and MLS squad channels.
- Attached images are viewable in-app with zoom and reveal-in-folder.
- Sync status is visible and accurate in thread views.
- The existing backend capabilities are exercised without protocol changes.
