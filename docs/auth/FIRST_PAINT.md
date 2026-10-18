# Auth cold-start / first paint

Unauthenticated cold start must not compete with the logged-in shell, Commons art, or wallet/`viem` graphs.

## Rules

1. **Thin `/` page.** [`src/routes/+page.svelte`](../../src/routes/+page.svelte) only lazy-loads [`AuthenticatedApp.svelte`](../../src/components/app/AuthenticatedApp.svelte) via [`loadAuthenticatedApp`](../../src/lib/app/authenticated-app.ts). Layout still gates `{@render children()}` on auth. Prefetch from [`Login.svelte`](../../src/components/auth/Login.svelte) during PIN success / unlock — **never from `auth.ts`** (that cycles auth → shell → auth).

2. **No Commons tag-art before unlock.** Do not call `scheduleCommonsStartupPrefetch()` from [`+layout.svelte`](../../src/routes/+layout.svelte). Post-login sync may warm **broadcast cache only**; [`preloadCommonsTagArt`](../../src/lib/commons/commons-prefetch.ts) runs on first Commons browse open.

3. **Messaging scripts are deferred.** `marked` / `highlight` / `twemoji` / `DOMPurify` are not sync tags in [`app.html`](../../src/app.html). [`ensureMessagingLibs`](../../src/lib/utils/messaging-libs.ts) injects them from [`FormattedMessageBody`](../../src/components/dm/FormattedMessageBody.svelte) after chat mounts.

4. **Session atoms live in `auth-session.ts`.** [`currentUser` / `isAuthenticated`](../../src/stores/auth-session.ts) are imported by invites / shell / commons — not from `auth.ts`. `auth.ts` owns login/logout side effects and re-exports the atoms for convenience. Do not statically import `clear-account-state` or `persistence` from Login’s critical path without need; auth loads them via `import()` on create / import / unlock / logout.

5. **Auth hero compression is deferred.** Keep the full-quality JPEG for the gallery frame; preload it from AuthAtmosphere. Revisit WebP/resize only with measured SSIM / A/B — do not crush quality for an arbitrary KB target.

## Success check (DevTools Network, cold unauth)

- No `commons-tags/*` before unlock
- No `AuthenticatedApp` / shell `Navbar` modules before unlock (or until PIN-success prefetch from Login)
- No `viem` / `clear-account-state` / `wallet-summary-cache` / `emojis.ts` before create/import/logout
- No sync `/js/marked.min.js` (etc.) before SvelteKit boot
- Hero JPEG may preload; that is expected
- `bits-ui` may still load with Login PIN UI (shadcn) — acceptable for now
- Fallow: no `auth.ts → … → auth.ts` cycles; session readers use `auth-session.ts`
