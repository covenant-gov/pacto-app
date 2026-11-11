# Privilege gaps

Packed flags in Crew → Privileges, versus what honest clients actually refuse. Normative model: [`ACCESS_CONTROL.md`](./ACCESS_CONTROL.md). This matrix is the gap list, not a second policy.

Inactive SquadAdmin allows every packed action. Active SquadAdmin denies unbound, paused, RPC failure, and a missing flag on publish. On receive for `createEvent` / `addDoc`, paused and a missing flag drop the rumor; RPC failure and a missing roster binding park it and re-check later.

| Flag | UI | Publish | Receive | Rust ingest | Gap |
|------|----|---------|---------|-------------|-----|
| `inviteAccept` | Checkbox | TS invite, admit, join accept, channel invite, state-sync open-channel admit. Rust `invite_member_to_group` when `privilegeParentId` is set | Frontend `applyPrivilegedMlsAction` on structured invite / admit / join payloads | Invite command only | MLS-admin resend and restore of an existing leaf skip the flag. Structured receive is still frontend-only |
| `createChannel` | Checkbox | Create-channel flow and catalog send | Frontend catalog MLS apply | None | Raw `create_group_chat` is ungated. Catalog receive is frontend-only |
| `broadcast` | Checkbox | TS `resolveCanBroadcastSquad` / broadcast send | None | None (`commons.rs` stores any valid broadcast) | Publish-only. Honest ingest/display filter is not built |
| `manageNetwork` | Checkbox | Network and RPC share publish | Frontend network / RPC MLS apply | None | Receive is frontend-only |
| `createEvent` | Checkbox | TS `requireMySquadPrivilege` plus Rust send (`create`, series) | Rust `process_rumor` drops unauthorized `create` / `series_card` | Same as receive | Sync `may_create` is membership-only; production send and ingest are gated. UI hides the button only after a successful privilege read (`null` shows the control; the backend still denies) |
| `addDoc` | Checkbox | TS `requireMySquadPrivilege` plus Rust send (`add`) | Rust `process_rumor` drops unauthorized `add` | Same as receive | Sync `may_add` is membership-only. Same UI fail-open as events |
| `firstMate` | Checkbox, captain-only while drafting | None | None | None | Packed into the role id only. 1st Mate signing is deferred |
| `FULL` | “Full access” on the member, not a role checkbox | Grants every known action on publish paths that call the privilege helper | Same as the action being applied | Same as the action | Not a separate ingest path |
| `PAUSE` | Not a role checkbox | Denies every packed action for that executor | Same | Same | No dedicated “Paused” control in the role editor; pause still wins in the enforcer |

Follow-ups worth doing next, in order: broadcast ingest, `createChannel` Rust catalog ingest (and gate or stop treating raw `create_group_chat` as a product path), `manageNetwork` Rust ingest, `inviteAccept` Rust ingest for structured admit payloads. Do not chain-gate MLS Add / Remove / Restore.
