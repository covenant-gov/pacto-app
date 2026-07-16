---
date: 2026-07-02
topic: unlock-calendar
---

# Unlock Calendar Requirements

## Summary

A calendar that aggregates events across Pacto squads and networks, with each event gated by existing membership or an event-specific Unlock Protocol lock. Any member can create an event and mark it public or private; the gate controls RSVP and joining the event.

## Problem Frame

Pacto communities currently coordinate events by hand: organizers copy-paste links and details across external messaging platforms, and attendees rely on whoever happens to see the message. This fragments discovery, makes RSVPs hard to track, and ties attendance to informal channels. A calendar inside the app would centralize discovery while respecting the access boundaries that already exist across squads and networks.

## Requirements

**Calendar**
- R1. The app provides a calendar view that aggregates events from squads and networks the user belongs to.
- R2. The calendar supports month, week, and list views.
- R3. The calendar reflects event visibility and gate state accurately.

**Events**
- R4. Any member of a squad or network can create an event with title, start/end time, description, location or link, and visibility (public or private).
- R5. Event creators can edit or cancel events they created.
- R6. Event metadata is replicated to members through the parent squad or network.

**Gating**
- R7. Each event is gated by one of: existing squad/network membership, a Hats role, or an Unlock Protocol lock.
- R8. The gate controls both RSVP and attendance (joining the event link or channel).
- R9. Users without the required gate can see public event titles and times but cannot view details, RSVP, or join.

**Discovery**
- R10. Public events are discoverable globally across Pacto.
- R11. Private events are only visible to members of the gating squad or network.
- R12. The calendar can filter events by squad, network, gate type, or public/private status.

**RSVP and attendance**
- R13. Users can RSVP to events they are gated for.
- R14. RSVPs are visible to event creators and other gated participants.
- R15. Attending the event uses the RSVP state to grant access to the event link or channel.

**Moderation**
- R16. Squad admins can remove or hide events from their squad calendar.

## Key Decisions

- **Unlock-native calendar.** We will support both membership-based and Unlock-lock gates from the start rather than building a membership-only calendar first. This aligns with the goal of integrating NFTs as event primitives while keeping the calendar useful for existing squads.
- **Any member can create.** Event creation is open to all members, not just admins, to maximize contribution. Squad admins retain moderation power.
- **Public-by-event visibility.** Each event is independently public or private, rather than deriving visibility from the squad alone. This prioritizes discovery over hiding event existence.
- **Gate controls RSVP and attendance.** The gate replaces the full copy-paste coordination flow, not just visibility.

## Actors

- A1. Event organizer: creates and manages events.
- A2. Attendee: discovers, RSVPs, and attends events.
- A3. Squad admin: moderates events in their squad or network.

## Key Flows

- F1. Create an event
  - **Trigger:** Organizer chooses to create an event.
  - **Actors:** A1
  - **Steps:** Select squad or network; fill title, time, description, location/link; choose gate type; set public or private; publish.
  - **Outcome:** The event appears on the calendar for eligible users.
- F2. Discover an event
  - **Trigger:** User opens the calendar.
  - **Actors:** A2
  - **Steps:** Browse global or personal view; see public event titles and times; see private events from squads the user belongs to.
  - **Outcome:** User selects an event to view details if they are gated.
- F3. RSVP and attend
  - **Trigger:** User opens a gated event.
  - **Actors:** A2
  - **Steps:** Verify the gate (membership or Unlock key); RSVP; receive access to the event link or channel.
  - **Outcome:** User can join the event at the scheduled time.

## Success Criteria

- SC1. Members can find relevant events across their squads and networks without leaving Pacto.
- SC2. Organizers spend less time distributing event details through external messaging platforms.
- SC3. Gated events respect membership boundaries; private events are not visible to non-members.

## Scope Boundaries

- **Deferred for later:** external calendar subscriptions (ICS, Google, Outlook), native video conferencing, recurring event series, NFT resale or ticket marketplace.
- **Outside this product's identity:** a general-purpose NFT marketplace, paid event ticketing with fiat on-ramps.

## Dependencies / Assumptions

- Unlock Protocol integration can be queried from the app.
- Wallet UX (backend signing via Tauri) can be extended to sign Unlock key purchases or claims.
- No calendar or NFT infrastructure exists in the app today; this is a net-new build.

## Outstanding Questions

- **Resolve before planning:** What moderation tools are needed if any member can create public events?
- **Resolve before planning:** How should the app handle on-chain Unlock lock creation and key-verification costs?
- **Deferred to planning:** Should events support recurring schedules?

## Sources / Research

- No calendar or event scheduling exists today; the closest time-bounded features are Commons broadcasts and dashboard polls (`docs/communities/COMMONS.md`, `docs/dashboard/POLLS.md`).
- Membership is managed via SQLite/MLS and Hats/SquadAdmin roles (`src/stores/squads.ts`, `src/lib/governance/api.ts`).
- The embedded wallet uses backend signing via Tauri (`src/lib/wallet/index.ts`).
