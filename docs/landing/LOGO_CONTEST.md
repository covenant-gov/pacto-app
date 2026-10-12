# Logo contest announcement and campaign

## Delivered state

The public route is <https://covenant-gov.github.io/pacto-app/logo-contest/>. Entries are closed. **Pacto Design** and its open **#logo-contest** custom channel are planned, not created by the website. No confirmed organizer, invitation, calendar dates, entries or winners are published.

The English contest catalog is `landing/src/content/logo-contest.ts`; the static page is `landing/src/pages/logo-contest.astro`. Contest-specific page, navigation, banner, download callout and social copy lives in the catalog. The blog catalog is `landing/src/content/blog.ts`; its introduction reuses the contest catalog’s status, notice and campaign image. No locale routes or desktop translation runtime are introduced. The current website/app logo stays unchanged until a real selection, rights agreement and final assets are complete.

`landing/public/assets/logo-contest-og.png` is a 1200×630 campaign image using the current mark, Host Grotesk and Geist Mono, with a conspicuous Coming soon status and no-cash-prize disclosure. It is not entrant artwork or a proposed new logo. If the headline/status changes, regenerate and inspect the static image too.

The on-site blog index is `/pacto-app/blog/`. Its first post, **Help shape Pacto’s next identity: introducing the logo contest**, is `/pacto-app/blog/introducing-the-logo-contest/` and links directly to the permanent contest page and its planned rules. The homepage blog banner features this announcement; shared header/footer links expose the index, which also retains the existing Substack article. The post announces preparation, not an open submission window. Publish confirmed opening details on the contest page and keep the introduction consistent when the contest status changes.

## Manual promotion

Publishing, social posting and live Squad setup require separate organizer authorization; this implementation performs none of them.

1. **Pre-launch:** share the campaign image and permanent page on existing Pacto channels, relevant Nostr/Mastodon privacy and open-source communities, and designer communities that permit volunteer-contest announcements. State no cash prize and closed entries. Ask moderators before posting; do not mass-DM people or imply a paid commission.
2. **Opening:** announce verified UTC dates and Squad discovery instructions together using the same page URL. Publish a short account → Commons → approval → text/files walkthrough using disposable test identities, never production secrets.
3. **During entries:** one midpoint and one final-72-hour reminder. Share credited previews only under the disclosed preview permission. Provide organizer Q&A and feedback in the Squad; public social engagement is not an eligibility requirement.
4. **Finalists/results:** publish the real shortlist, advisory-feedback window, selected design, rationale and creator credit. Announce brand adoption only after rights and final assets are complete. Keep using the permanent page instead of splitting the campaign across new sites.

Assess attention with existing aggregate page/download data, if available, and organizer counts of join requests, admitted participants and complete eligible entries. These are evaluation signals, not launch targets or guaranteed growth. Do not add tracking or connect public traffic to private Pacto identities.

## Organizer opening prerequisites

Opening is separate from delivering this announcement. Keep **Coming soon. Entries are not open yet.** if any prerequisite is missing or the real join/file flow fails. Do not work around an unrelated app, deep-link or relay problem by claiming joining is available.

1. Create the real **Pacto Design** Squad and open **logo-contest** custom channel. Initialize the Join inbox and ensure at least one active holder has its local secret and can approve requests; see [Join inbox](../communities/JOIN_INBOX.md).
2. Publish an active Commons card naming Pacto Design and the contest. Select supported curated tags in the app, not an invented taxonomy. Add exact tags to the page only after verifying the real listing. Fresh-client discovery has a 72-hour lookback constraint: use a listing duration of at most 72 hours, republish after expiry, and keep approval coverage active.
3. With a disposable fresh participant, verify Commons → Squads → All → Latest discovery of the correct card, request membership, receive approval, automatic membership completion, access to the open channel, and sending/downloading a text declaration plus separate SVG and PNG. The rationale must arrive as its own message; downloaded SVG bytes must match the submitted file. Record exact discovery details and organizer contact before publishing them on the page.
4. Publish organizer identity/contact, legally reviewed final terms and the actual winner-rights agreement, opening/closing UTC timestamps, feedback dates and announcement date before accepting entries. The sequence remains 30 entry days, seven feedback days and a decision within seven days afterward. Finalized rules must not change retroactively after entries are accepted.

The announcement build does not exercise this live funnel or accept real submissions. No organizer identity, public invitation URL, dates, entrants or winners may be guessed to fill it in.

## Local verification and publication

From the repository root:

```sh
pnpm exec svelte-kit sync
pnpm --filter pacto-landing build
pnpm --filter pacto-landing preview --host 127.0.0.1 --port 4321
```

Open `/pacto-app/`, `/pacto-app/logo-contest/`, `/pacto-app/blog/` and `/pacto-app/blog/introducing-the-logo-contest/` on the preview server. Verify direct load/refresh and no-JavaScript readability, homepage → blog article → contest navigation, blog index → article navigation, the retained Substack destination, homepage/banner/download callout navigation, rules anchor clearance, footer homepage links, real installer destinations, unchanged metadata on existing pages, contest/blog canonical and social metadata and sharing parameters, light/dark responsive layout, keyboard Menu and focus. The contest and blog pages must not import `scripts/platform.ts` or use `.js-download-btn` on page CTAs or share links.

Landing changes do not deploy merely because they merge. Authorized manual Pages republish or the next release is required; see [operator updates](../build/OPERATOR_UPDATES.md#emergency-republish).
