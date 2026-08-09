# GIFs — Klipy provider disclosure

How the composer's **GIFs** tab reaches Klipy, why that path is a provider URL
rather than an encrypted Blossom blob, and exactly what Klipy sees.

**Related:** [`ATTACHMENTS.md`](./ATTACHMENTS.md) (the encrypted-blob model
this deliberately does not use), [`OVERVIEW.md`](./OVERVIEW.md).

**Status:** search, trending, the opt-in disclosure gate, the share-trigger
callback, and the `KLIPY_API_KEY` egress module (§5, §6) are shipped. Landing
alongside this document: sending a picked GIF as its own message type and
routing the *recipient's* fetch of that GIF's media through
`src-tauri/src/klipy.rs` rather than the plain-text send path it uses today.
The privacy exposure this document discloses — the recipient's IP reaching
Klipy when the GIF renders — holds either way; what changes is only which
code performs that fetch.

---

## 1. Why this isn't an encrypted attachment

Every other piece of media in Pacto — file attachments, sticker packs — is
encrypted client-side and stored as opaque ciphertext on a Blossom blob
server ([`ATTACHMENTS.md` §1](./ATTACHMENTS.md#1-pipeline)). GIFs cannot use
that pipeline. Klipy's integration terms forbid it outright:

> "Media must be loaded directly from the URLs included in the API response.
> Do not store, mirror, re-host, rewrite, or retain copies of KLIPY media
> unless KLIPY has approved a different delivery method in writing." —
> [docs.klipy.com/integration-requirements](https://docs.klipy.com/integration-requirements.md)

Downloading a GIF, re-encrypting it, and uploading it to Blossom — the
`ATTACHMENTS.md` model, and the design issue [#200](https://github.com/covenant-gov/pacto-app/issues/200)
originally proposed — is precisely what that clause prohibits. So a picked
GIF is sent as **Klipy's own URL, byte-identical**, never rewritten,
stripped, or re-hosted. Pacto never downloads, caches, or retains a copy of
the media bytes on the sender's or a Blossom server's disk.

That trade has one direct consequence: the URL is not opaque ciphertext, so
whoever renders it makes a request straight to Klipy's CDN. The rest of this
document is that disclosure.

---

## 2. What leaves the device, and to whom

| Exposed to Klipy | Not exposed to Klipy |
|---|---|
| Search text typed into the GIFs tab, on every search request | Pacto identity, npub, or any value derived from it (R20) — no request carries one |
| The requesting client's IP address, on every search, trending, and share-trigger request | `customer_id` — Klipy's own per-user tracking parameter is never sent |
| The picked GIF's `slug`, via the mandatory share-trigger callback, when a GIF is sent | The recipient's identity, chat, or squad — Klipy has no way to know who a shared GIF was sent to |
| The recipient's IP address, when their client renders the GIF at its Klipy URL | Any Pacto message content — only the search query and the fetched URL ever reach Klipy |

Two IP exposures happen on two different machines: the sender's IP when
searching, and (separately) the recipient's IP when their client fetches the
picked GIF's URL to render it. Neither carries a Pacto identifier — Klipy
sees an anonymous client making anonymous requests, the same as any browser
visiting a public GIF site.

**The message itself stays private.** The GIF URL travels inside a NIP-17
gift-wrapped rumor (DM) or an MLS group message ([`OVERVIEW.md`](./OVERVIEW.md)),
so the URL is not public — no relay or observer other than the intended
recipient(s) ever sees which GIF was sent, or that a GIF was sent at all.
What is not hidden is the *fetch*: rendering that URL is an ordinary HTTPS
request from the recipient's device straight to Klipy, and Klipy's server
logs see that request's source IP regardless of how private the message
transport was.

---

## 3. How to avoid it entirely

The GIFs tab is **opt-in, not opt-out**. On first use, `GifDisclosure.svelte`
shows a disclosure naming Klipy and stating what leaves the device before any
request can fire; `assertGifsDisclosureAccepted()`
(`src/lib/api/klipy.ts`) is called at the top of every search, trending, and
share-trigger wrapper and throws before invoking Rust if the account has not
accepted. Acceptance is stored npub-scoped in `localStorage`
(`pacto_klipy_gifs_disclosure_accepted_v1:<npub>`), so declining — or simply
never opening the tab — means zero Klipy traffic ever originates from that
account. Acceptance is per-account, not global: switching to a different
identity on the same device re-triggers the disclosure.

Because a picked GIF is delivered as a URL, a **recipient** also makes a
request to Klipy the moment their client renders it, even if they personally
never opened the GIFs tab or accepted the disclosure on their own account.
There is currently no separate recipient-side opt-out; the sender's
disclosure is what gates the *search*, not the *rendering* of a GIF someone
else already sent.

---

## 4. Attribution

Klipy requires a `"Search KLIPY"` placeholder on the search input as a
condition of API access ([docs.klipy.com/attribution](https://docs.klipy.com/attribution.md)).
The GIFs tab's search box uses exactly that string
(`messaging.messageInput.gifsSearchPlaceholder`, both `en` and `es`
catalogs) — this is not decorative copy, it is the mandatory attribution.

---

## 5. Single egress chokepoint

Every outbound Klipy request — search, trending, and the share-trigger
callback — originates from one Rust module, `src-tauri/src/klipy.rs`, never
from the webview. The key never crosses the Tauri IPC boundary: it is
resolved once per call inside `klipy_api_key()` and is never returned to the
frontend in any command response. `src/lib/api/klipy.ts` only ever calls the
four typed commands (`klipy_search_gifs`, `klipy_trending_gifs`,
`klipy_report_share`, `klipy_is_configured`) and never sees the key itself.

This single-module constraint is deliberate, not incidental: issue
[#173](https://github.com/covenant-gov/pacto-app/issues/173) (Tor routing via
an embedded Arti node) is deferred, but because every Klipy call passes
through this one module, gating all of it behind Tor later is a change in
one place instead of a hunt across the codebase for every call site. That
requirement extends to the recipient-side fetch of a received GIF's media —
it must route through `klipy.rs`, never a direct webview fetch of the Klipy
URL — which this document tracks as landing alongside the rest of GIF URL
delivery; search, trending, and the share-trigger already route through the
module today.

Because the key sits in the request **path** (`/api/v1/{key}/gifs/search`,
not a header), an ordinary error message or log line would otherwise leak
it. `redact_klipy_error()` scrubs the literal key value out of every error
string `klipy.rs` can surface, then runs the result through the shared
`redact_urls_in_text` RPC-URL redactor, before it ever reaches a log line or
a caller.

---

## 6. Operator setup: `KLIPY_API_KEY`

Copy `.env.example` → `.env` (gitignored) and set `KLIPY_API_KEY` at the repo
root. Debug Tauri loads root `.env` into the Rust process at startup
(`std::env::var("KLIPY_API_KEY")`), so a developer key works immediately
without a rebuild.

**Release builds bake the key in at compile time.** `klipy_api_key()`
resolves the runtime environment variable first, then falls back to
`option_env!("KLIPY_API_KEY")` — the value the Rust compiler embeds into the
binary at build time from whatever `KLIPY_API_KEY` is set in the build
environment. **This means the key is extractable from any shipped binary** —
`strings` on the executable, or a debugger, recovers it. That is a known,
accepted trade, not an oversight: Pacto has no server to hold the key
instead, and every alternative considered (a distinct key per user, a
bundled default with a user override) either kills adoption or does not
remove the exposure, only relocates it. The blast radius of a leaked key is
bounded — it grants only Klipy API quota, never access to any Pacto account,
message, or key material.

`klipy_is_configured()` lets the frontend show a "GIFs unavailable" state
instead of firing a request that would fail unauthenticated when no key is
present in a given build.

---

## 7. Rate limit

The Klipy key currently in use is a **testing-tier key, capped at 100
requests per hour**. Production access — which lifts that cap — has been
requested but not yet granted; shipping with the testing-tier key was a
deliberate decision to unblock this phase rather than wait, on the
expectation that Pacto's active-account volume stays well under the cap for
now. The GIFs tab's search input is debounced
(`GIFS_SEARCH_DEBOUNCE_MS = 400`, `src/lib/api/klipy.ts`) specifically to
keep ordinary typing from exhausting it, but debounce tuning cannot
compensate for real multi-account usage against a 100/hour ceiling — this is
a known constraint on current scale, not a solved problem.

---

*Verified against `src-tauri/src/klipy.rs`, `src/lib/api/klipy.ts`,
`src/components/dm/GifDisclosure.svelte`, `src/components/dm/MessageInput.svelte`,
`.env.example`, and `src/lib/i18n/locales/{en,es}/messaging.json`.*
