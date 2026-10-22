---
title: DM thread stopped following new messages because the pin decision was measured after the message was appended
date: 2026-10-21
category: docs/solutions/logic-errors
module: dm-thread-scroll
problem_type: logic_error
component: frontend_ui
symptoms:
  - "New DM messages land below the fold; the reader has to scroll down by hand after every message."
  - "Short one-line messages follow correctly, tall or multi-line ones do not — the failure looks intermittent."
root_cause: wrong_measurement_point
resolution_type: code_fix
severity: medium
tags: [svelte, scroll-anchoring, dm, layout, effects, chat-ui]
---

# DM thread stopped following new messages because the pin decision was measured after the message was appended

## Problem

`DmThread.svelte` decided whether to stay pinned to the bottom with:

```ts
const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
if (conversationJustChanged || firstTimeWithMessages || isNearBottom) container.scrollTop = container.scrollHeight;
```

That gap is read **after** the new message is already in the DOM. Appending a message grows `scrollHeight` without moving `scrollTop`, so the measured gap equals the height of the message that just arrived. Anything taller than the 100px threshold — a wrapped paragraph, a list, an attachment card — reads as "the reader scrolled away" and the thread stops following. A one-line message is under the threshold and still works, which is why the bug looked intermittent rather than total.

The flaw predates the runes migration: the Svelte 4 version ran the same arithmetic inside `setTimeout(…, 0)`, which also fires after the DOM update.

## Symptoms

- Sent and received messages appear below the visible area; the view stays put.
- Opening a thread sometimes lands slightly above the newest message.
- No errors, no failing tests — the existing jsdom test passed because jsdom reports `scrollHeight`/`clientHeight` as `0`, making every gap `0` and every branch "near bottom".

## Solution

Pin state now comes from the reader's own scrolling, not from post-append geometry:

- `pinnedToBottom` is set in the `onscroll` handler via `isScrollAtBottom(container)` and starts `true`.
- The message effect scrolls when the thread first paints, when `pinnedToBottom` is true, or when the newest message is the reader's own send.
- When the reader is scrolled up, arriving messages do not move the viewport; `countMessagesAfter(messages, seenTailMessageId)` (`src/lib/dm/dm-unread.ts`) feeds a jump-to-latest pill labelled "N new messages".
- `scrollToLatest()` re-pins on the next animation frame, and a capture-phase `load` handler re-pins when media finishes layout. Without the frame-aligned retry, message bodies that finish laying out after the effect flush left the newest message ~170px below the fold (observed live in the sandbox: `scrollTop` stuck at 469 with `scrollHeight` 1292).

## Why This Works

"Is the reader at the bottom?" is a question about the state *before* the new content arrived, and the only reliable record of that is the last scroll event the reader produced. Geometry read after the append answers a different question — "how tall was the thing that just arrived?" — which happens to agree only for short messages.

## Prevention

- When a scroll container must follow appended content, capture the pin decision from scroll events (or before the mutation), never from the post-mutation gap.
- jsdom cannot verify scroll behavior by default: `DmThread.test.ts` now stubs `scrollHeight`/`clientHeight`/`scrollTop` so the near-bottom math is actually exercised. A scroll test that does not define those properties is vacuous.
- UI verification used the seeded sandbox (`make dev-sandbox-seeded`) plus `ipc_emit_event` with `message_new` to simulate arrivals through the real frontend path.
