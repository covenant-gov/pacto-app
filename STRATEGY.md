---
name: Pacto
last_updated: 2026-07-07
---

# Pacto Strategy

## Target problem

Existing community platforms force a trade-off between privacy and enforceability: chat apps can be private but cannot govern shared money or votes, while blockchains can enforce scarcity but expose identities and activity. Grassroots groups, DAOs, and private collectives need both — private coordination and enforceable collective decisions — without surrendering personal data to a platform or passing KYC.

## Our approach

Pacto fuses encrypted, metadata-protected messaging with embedded wallets and on-chain governance in a single desktop app. The core bet is that the same cryptographic identity (a Nostr keypair) can power both private conversations and scarce collective actions, so users can organize, vote, and manage treasuries without trusting a centralized service or exposing their activity.

## Who it's for

**Primary:** DAO and collective organizers — people running funded, membership-driven groups who need private discussion, transparent governance, and shared treasury control in one place.

**Also served:** Privacy-conscious community members who want Discord-style group chat without exposing their social graph or wallet activity to platforms or surveillance.

## Key metrics

- **7-day squad message volume per active member** — measures whether private group coordination is becoming a habit; measured in per-account `events` table.
- **Squad invite accept rate** — share of invites that result in a member joining and sending at least one message; signals onboarding simplicity and trust.
- **Treasury proposals created and executed** — number of on-chain governance actions initiated and completed through the app; signals enforceable collective action.
- **Commons follows → squad joins** — users who discover a squad via the public Commons feed and join; signals cross-community discovery.
- **30-day retention of new squad members** — members who were active in week 1 and remain active in week 4; the ultimate health check for replacing siloed chat tools.

## Tracks

### Embedded treasury & governance

Make collective money and decisions as easy as group chat: Safe wallets, pacto-gov proposals, and role enforcement all anchored to the same MLS squad identity.

_Why it serves the approach:_ enforceability is the reason to accept the complexity of on-chain logic; without it, Pacto is just another chat app.

### Private group coordination

MLS-backed Squads and Networks with Discord-style channels, but metadata-protected and decentralized over Nostr.

_Why it serves the approach:_ privacy is the non-negotiable differentiator; if coordination leaks identity or relationships, the product fails its core promise.

### Discovery & Commons

Help users find and join aligned squads through the Commons feed, public broadcasts, and a searchable squad catalog, while keeping membership itself private.

_Why it serves the approach:_ network effects come from discovery; a private tool that nobody can find is self-limiting.

### Trust & safety

Protect users from spam, abuse, and key loss without introducing central gatekeepers: invite gating, evictions, roster verification, and clear alpha-grade risk messaging.

_Why it serves the approach:_ privacy-first infrastructure is easily abused; trust mechanisms must exist but stay under community control, not platform control.
