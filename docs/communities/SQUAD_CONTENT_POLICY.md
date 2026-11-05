# Squad content policy: restrict-on semantics

Squad admins can limit adding events (`restrict_event_create`) and docs (`restrict_doc_add`) to admins. The wire format and admin gate are in [`../mls/VIRTUAL_CHANNEL_ROUTING_ADR.md`](../mls/VIRTUAL_CHANNEL_ROUTING_ADR.md); code is `src-tauri/src/squad_content_policy.rs` and `src-tauri/src/squad_event.rs`.

This document records how restrict-on treats existing member events, why, and the alternatives considered. The choice came out of the review of PR #488.

## Current rule

- While `restrict_event_create` is on, the send command rejects non-admin creates, and every device ignores incoming non-admin creates.
- Turning it on deletes **every** non-admin event of the squad, with its RSVPs and queued ops, whatever the event's timestamp. Admin events stay.
- Turning it off restores nothing. Members can create again from then on.
- If the admin lookup fails, the flag is stored and nothing is deleted.
- `restrict_doc_add` is stored only; there is no docs shelf to enforce it on yet.

## The constraint behind it

Every timestamp on a squad record is set by the sender. `updated_at_ms` is in the payload, and `send_wire` copies it into the rumor's `created_at`. A modified client can put any value there. Ingest only rejects stamps more than 5 minutes in the future.

Receive time is not a usable substitute. A device that was offline backfills from its sync cursor, or the last 48 h on first sync (`sync_group_since_cursor` in `mls.rs`). Any rule tied to when a device receives a message gives that device a different answer than devices that were online.

So no rule that compares an event's time to the switch's time can both resist backdating and give the same result on every device.

## Options

| Option | Same rows on every device | Resists backdating | Keeps earlier member events | Cost |
|---|---|---|---|---|
| **A. Restrict-on deletes every non-admin event (chosen)** | Yes, for one switch | Yes | No | Members lose events they added before the switch, including past events and RSVPs. |
| B. Accept a non-admin create only if its stamp is before the switch | Yes | No | Yes | A modified client gets past the restriction on every device. |
| C. Previous rule: delete non-admin events stamped at or after the switch | No | No | Yes | Devices disagree on honest races; backdating gets past the restriction on some devices. |
| D. Clamp or reject stamps relative to receive time | No | Partly | Yes | Breaks offline catch-up: late devices drop or shift honest events. Rejected. |
| E. Admin's policy message carries the list of member events to keep | Yes | Yes | Yes, those the admin had received | Honest events the admin had not received yet are dropped. List grows with the squad. |
| F. Policy history ordered by MLS epoch | Yes, including on/off/on | Within the past-epoch window | Yes | Needs epoch plumbing and a migration (below). Preferred long-term fix. |
| G. Flag in a smart contract | Flag itself, yes | No, for event validity | n/a | Squads without deployed governance have no contract; public metadata; each change is a transaction. |
| H. Flag in MLS group state (GroupContext extension) | Yes | Same as F | Yes | MDK 0.8.0 `NostrGroupDataUpdate` has fixed fields only; needs an MDK change or a custom extension every key package declares. |

### Why A for now

It is the only option that converges and closes the backdating gap without new infrastructure. Its cost is a product cost, not a correctness one, and the settings hint states it: turning a limit on removes everything members who are not admins have added.

### F in more detail

MLS gives each group an epoch counter that advances on every commit, and all members process commits in the same order. MDK records the epoch each application message was decrypted under (`Message.epoch`). The sender cannot pick it freely, and every device sees the same value. Devices decrypt at most 5 past epochs (MDK default `max_past_epochs`), which bounds how far back a modified client holding old keys could reach.

The rule would be: a non-admin event is valid if restrict-on was off in the epoch it was sent in. That needs:

- a policy history table of `(effective epoch, on/off)` per squad instead of one last-writer flag;
- the epoch passed from the MDK message through `RumorContext` into `process_rumor`, and stored on event rows and queued ops;
- the admin sending a commit (for example a key update) right before the policy message, so the switch starts a fresh epoch.

Edits could use the same ordering, comparing `(epoch, updated_at_ms)`, which would make the future allowance irrelevant.

Unverified: whether the app can send an admin key-update commit on demand, and how MDK settles concurrent commits.

### G in more detail

A contract gives a single trusted value and a block-ordered history for the flag, with admin authority checked on-chain. That works for settings that only gate actions from now on (UI, send-side checks, governance and treasury settings). It does not place an MLS event before or after the switch: the event's own time is still sender-set, and a reference to a block hash only proves the event is newer than that block. Squads that never deployed governance have no contract, which is the same reason the group-records plan uses MLS `admin_pubkeys` for the admin set.

## Known gaps in A

- **On, off, then on again.** A member create that races the "off" can be kept on one device and dropped on another until the next restrict-on deletes it everywhere. Fixing this needs the policy history in F.
- **Admin set at apply time.** Deletion uses the admin set each device sees when it applies the policy. Devices with a stale admin set can disagree about events from members who were promoted or demoted around the switch.

## Related rules from the same review

- **Clock allowance.** Ingest accepts stamps up to 5 minutes ahead, the same as MDK's default `max_future_skew_secs` for the MLS wrapper, and has no lower bound. A lower bound breaks offline catch-up (see D). MDK already drops every message whose wrapper is more than 5 minutes ahead for peers online at the time, so an honest client with a fast clock never reaches the app check; only a modified client can forge an inner stamp, and the app bound caps it at the same window. Admin update and cancel sends stamp `max(now, stored + 1)`, so a future-stamped author edit cannot lock admins out. A live two-client run with the author's clock 4 minutes ahead confirmed the admin edit wins on both devices.
- **RSVP on a cancelled event.** The send command refuses an RSVP when the local copy is already cancelled. Ingest still stores every RSVP, newest per member, whatever the event's status. Dropping RSVPs on cancelled events at ingest was tried and reverted: the RSVP's sender always applies it before the racing cancel arrives, while peers can see the cancel first, so devices disagreed. A live two-client run showed it.

## Revisit when

- Restrict-on is used in squads where losing earlier member events is a real complaint: implement F.
- MDK supports custom group-data fields: reconsider H for all binary squad settings.
- Every squad has an on-chain identity: reconsider G for settings that only gate actions.
