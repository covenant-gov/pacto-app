//! Late-joiner catch-up for squad records: a silent kind-30078 snapshot of the
//! current events, docs, and content-policy replica, sent after an MLS welcome.

use nostr_sdk::prelude::*;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};

use crate::TAURI_APP;
use crate::nostr_tags;
use crate::rumor::{ConversationType, RumorContext, RumorEvent, RumorProcessingResult};
use crate::squad_content_policy::{self, SquadContentPolicyWire};
use crate::squad_doc::{self, DocSnapshot};
use crate::squad_event::{self, EventSnapshot};
use crate::squad_records::{self, SQUAD_RECORDS_SNAPSHOT_D_TAG, signer_identity, with_conn};

const SCHEMA: &str = "pacto.squad_records_snapshot.v1";
const MAX_SNAPSHOT_EVENTS: usize = 200;
const MAX_SNAPSHOT_DOCS: usize = 200;
const ERR_NOT_MEMBER: &str = "squad_records_not_member";
const ERR_WRONG_GROUP: &str = "squad_records_wrong_group";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecordsSnapshotWire {
    pub schema: String,
    pub parent_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub policy: Option<SquadContentPolicyWire>,
    #[serde(default)]
    pub events: Vec<EventSnapshot>,
    #[serde(default)]
    pub docs: Vec<DocSnapshot>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SnapshotApplyOutcome {
    pub events_changed: bool,
    pub docs_changed: bool,
    pub policy_changed: bool,
}

impl SnapshotApplyOutcome {
    fn changed(self) -> bool {
        self.events_changed || self.docs_changed || self.policy_changed
    }
}

pub struct SnapshotApplyMeta<'a> {
    pub rumor_id: &'a str,
    pub mls_group_id: &'a str,
    pub signer_npub: &'a str,
    pub signer_is_member: bool,
    pub signer_is_admin: bool,
    pub admin_npubs: &'a [String],
}

pub(crate) fn try_parse_wire(content: &str) -> Option<RecordsSnapshotWire> {
    let w: RecordsSnapshotWire = serde_json::from_str(content.trim()).ok()?;
    if w.schema != SCHEMA || w.parent_id.trim().is_empty() {
        return None;
    }
    Some(w)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn ensure_announcements_group(mls_group_id: &str, parent_id: &str) -> Result<(), String> {
    if crate::db::side_effect_parent_matches_chat(mls_group_id, parent_id) {
        Ok(())
    } else {
        Err(ERR_WRONG_GROUP.into())
    }
}

fn collect_wire(conn: &Connection, parent_id: &str) -> Result<Option<RecordsSnapshotWire>, String> {
    let policy = squad_content_policy::snapshot_policy_wire(
        parent_id,
        &squad_content_policy::load_policy(conn, parent_id)?,
    );
    let events = squad_event::collect_snapshot_events(conn, parent_id, MAX_SNAPSHOT_EVENTS)?;
    let docs = squad_doc::collect_snapshot_docs(conn, parent_id, MAX_SNAPSHOT_DOCS)?;
    if policy.is_none() && events.is_empty() && docs.is_empty() {
        return Ok(None);
    }
    Ok(Some(RecordsSnapshotWire {
        schema: SCHEMA.to_string(),
        parent_id: parent_id.to_string(),
        policy,
        events,
        docs,
    }))
}

/// Fill-only replica rows, then last-timestamp-wins policy when the signer is an admin.
pub fn apply_snapshot(
    conn: &Connection,
    wire: &RecordsSnapshotWire,
    meta: &SnapshotApplyMeta<'_>,
    now_ms: i64,
) -> Result<SnapshotApplyOutcome, String> {
    let mut outcome = SnapshotApplyOutcome::default();
    if !meta.signer_is_member
        || !crate::db::side_effect_parent_matches_chat(meta.mls_group_id, &wire.parent_id)
    {
        return Ok(outcome);
    }

    let stored_policy = squad_content_policy::load_policy(conn, &wire.parent_id)?;
    let mut restrict_event = stored_policy.restrict_event_create;
    let mut restrict_doc = stored_policy.restrict_doc_add;

    if meta.signer_is_admin {
        if let Some(policy) = &wire.policy {
            if policy.parent_id == wire.parent_id {
                if let Some(parsed) = serde_json::to_string(policy)
                    .ok()
                    .and_then(|raw| squad_content_policy::try_parse_wire(&raw, now_ms))
                {
                    let applied = squad_content_policy::apply_policy(
                        conn,
                        &parsed,
                        meta.signer_npub,
                        true,
                        meta.admin_npubs,
                    )?;
                    if applied.changed {
                        outcome.policy_changed = true;
                        let next = squad_content_policy::load_policy(conn, &wire.parent_id)?;
                        restrict_event = next.restrict_event_create;
                        restrict_doc = next.restrict_doc_add;
                    }
                }
            }
        }
    }

    outcome.events_changed = squad_event::apply_snapshot_events(
        conn,
        &wire.parent_id,
        meta.mls_group_id,
        &wire.events,
        meta.rumor_id,
        meta.admin_npubs,
        restrict_event,
        now_ms,
    )?;
    outcome.docs_changed = squad_doc::apply_snapshot_docs(
        conn,
        &wire.parent_id,
        meta.mls_group_id,
        &wire.docs,
        meta.rumor_id,
        meta.admin_npubs,
        restrict_doc,
        now_ms,
    )?;
    Ok(outcome)
}

fn emit_outcome(parent_id: &str, outcome: SnapshotApplyOutcome) {
    let Some(handle) = TAURI_APP.get() else {
        return;
    };
    if outcome.events_changed {
        let _ = handle.emit(
            "squad_event_replica_updated",
            serde_json::json!({ "parentId": parent_id, "eventId": null }),
        );
    }
    if outcome.docs_changed {
        let _ = handle.emit(
            "squad_doc_replica_updated",
            serde_json::json!({ "parentId": parent_id, "docId": null }),
        );
    }
    if outcome.policy_changed {
        let _ = handle.emit(
            "squad_content_policy_updated",
            serde_json::json!({ "parentId": parent_id }),
        );
    }
}

/// MLS ingest for `d` = `pacto_squad_records_snapshot`. Always silent.
pub async fn process_rumor(
    rumor: RumorEvent,
    context: RumorContext,
) -> Result<RumorProcessingResult, String> {
    if context.conversation_type != ConversationType::MlsGroup {
        return Ok(RumorProcessingResult::SquadRecordSilent);
    }
    let Some(wire) = try_parse_wire(&rumor.content) else {
        return Ok(RumorProcessingResult::SquadRecordSilent);
    };
    let group_id = context.conversation_id.as_str();
    if ensure_announcements_group(group_id, &wire.parent_id).is_err() {
        return Ok(RumorProcessingResult::SquadRecordSilent);
    }
    let handle = TAURI_APP
        .get()
        .ok_or_else(|| "App handle not initialized".to_string())?;
    let signer = rumor
        .pubkey
        .to_bech32()
        .map_err(|e| format!("pubkey bech32: {}", e))?;
    let role = squad_records::group_role(handle, group_id, &signer).await;
    if !role.is_member {
        return Ok(RumorProcessingResult::SquadRecordSilent);
    }
    let admin_npubs = squad_records::group_admin_npubs(handle, group_id).await;
    let rumor_id = rumor.id.to_hex();
    let meta = SnapshotApplyMeta {
        rumor_id: &rumor_id,
        mls_group_id: group_id,
        signer_npub: &signer,
        signer_is_member: role.is_member,
        signer_is_admin: role.is_admin,
        admin_npubs: &admin_npubs,
    };
    let outcome = with_conn(handle, |c| apply_snapshot(c, &wire, &meta, now_ms()))?;
    if outcome.changed() {
        emit_outcome(&wire.parent_id, outcome);
    }
    Ok(RumorProcessingResult::SquadRecordSilent)
}

#[tauri::command]
pub async fn send_squad_records_snapshot<R: Runtime>(
    handle: AppHandle<R>,
    mls_group_id: String,
    parent_id: String,
) -> Result<(), String> {
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
    ensure_announcements_group(&mls_group_id, &parent_id)?;
    let (pk, npub) = signer_identity().await?;
    let role = squad_records::group_role(&handle, &mls_group_id, &npub).await;
    if !role.is_member {
        return Err(ERR_NOT_MEMBER.into());
    }
    let Some(wire) = with_conn(&handle, |c| collect_wire(c, &parent_id))? else {
        return Ok(());
    };
    let content = serde_json::to_string(&wire).map_err(|e| e.to_string())?;
    let built = EventBuilder::new(Kind::ApplicationSpecificData, &content)
        .tag(nostr_tags::d_tag([SQUAD_RECORDS_SNAPSHOT_D_TAG]))
        .tag(nostr_tags::custom_tag("parent", [&parent_id]))
        .build(pk);
    crate::mls::send_mls_message(&mls_group_id, built, None).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::squad_content_policy::{SquadContentPolicyWire, apply_policy, load_policy};
    use crate::squad_doc::{DocWire, Op as DocOp, OpMeta as DocMeta, apply_op as apply_doc};
    use crate::squad_event::{
        EventWire, KIND_TIMED, Op as EventOp, OpMeta as EventMeta, Place, RsvpStatus, WireTime,
        apply_op as apply_event,
    };
    use crate::squad_records::SquadGroupRole;
    use rusqlite::Connection;

    const PARENT: &str = "squad-1";
    const GROUP: &str = PARENT;
    const NOW: i64 = 10_000;
    const ALICE: &str = "npub1alice";
    const CAROL: &str = "npub1carol";
    const ADMIN: &str = "npub1admin";

    fn conn() -> Connection {
        let mut conn = Connection::open_in_memory().expect("in-memory db");
        crate::migrations::run_migrations(&mut conn).expect("migrations");
        conn
    }

    fn member() -> SquadGroupRole {
        SquadGroupRole {
            is_member: true,
            is_admin: false,
        }
    }

    fn admin_role() -> SquadGroupRole {
        SquadGroupRole {
            is_member: true,
            is_admin: true,
        }
    }

    fn event_meta<'a>(rumor_id: &'a str, signer: &'a str) -> EventMeta<'a> {
        EventMeta {
            rumor_id,
            mls_group_id: GROUP,
            signer_npub: signer,
        }
    }

    fn doc_meta<'a>(rumor_id: &'a str, signer: &'a str) -> DocMeta<'a> {
        DocMeta {
            rumor_id,
            mls_group_id: GROUP,
            signer_npub: signer,
        }
    }

    fn create_event(id: &str, title: &str, ts: i64) -> EventWire {
        EventWire {
            schema: "pacto.squad_event.v1".into(),
            op: EventOp::Create,
            id: Some(id.into()),
            parent_id: PARENT.into(),
            series_id: None,
            kind: Some(KIND_TIMED),
            title: Some(title.into()),
            summary: Some("Weekly sync".into()),
            start: Some(WireTime::Unix(1_800_000_000)),
            end: None,
            start_tzid: Some("America/New_York".into()),
            place: Some(Place::Offline),
            location: Some("42 Secret Lane".into()),
            channel_id: Some("general".into()),
            status: None,
            rsvp: Some(RsvpStatus::Accepted),
            first_start: None,
            count: None,
            updated_at_ms: ts,
        }
    }

    fn rsvp_event(id: &str, status: RsvpStatus, ts: i64) -> EventWire {
        EventWire {
            schema: "pacto.squad_event.v1".into(),
            op: EventOp::Rsvp,
            id: Some(id.into()),
            parent_id: PARENT.into(),
            series_id: None,
            kind: None,
            title: None,
            summary: None,
            start: None,
            end: None,
            start_tzid: None,
            place: None,
            location: None,
            channel_id: None,
            status: Some(
                match status {
                    RsvpStatus::Accepted => "accepted",
                    RsvpStatus::Tentative => "tentative",
                    RsvpStatus::Declined => "declined",
                }
                .into(),
            ),
            rsvp: None,
            first_start: None,
            count: None,
            updated_at_ms: ts,
        }
    }

    fn add_doc(id: &str, url: &str, by: &str, ts: i64) -> DocWire {
        DocWire {
            schema: "pacto.squad_doc.v1".into(),
            op: DocOp::Add,
            id: id.into(),
            parent_id: PARENT.into(),
            url: Some(url.into()),
            title: Some("Plan".into()),
            provider: Some("cryptpad".into()),
            channel_id: Some("general".into()),
            note: Some("secret-note".into()),
            added_by: Some(by.into()),
            updated_at_ms: ts,
        }
    }

    fn remove_doc(id: &str, ts: i64) -> DocWire {
        DocWire {
            schema: "pacto.squad_doc.v1".into(),
            op: DocOp::Remove,
            id: id.into(),
            parent_id: PARENT.into(),
            url: None,
            title: None,
            provider: None,
            channel_id: None,
            note: None,
            added_by: None,
            updated_at_ms: ts,
        }
    }

    fn apply_event_as(conn: &Connection, w: &EventWire, rumor_id: &str, signer: &str) {
        let role = if signer == ADMIN {
            admin_role()
        } else {
            member()
        };
        apply_event(conn, w, &event_meta(rumor_id, signer), role, NOW).expect("event apply");
    }

    fn apply_doc_as(conn: &Connection, w: &DocWire, rumor_id: &str, signer: &str) {
        apply_doc(conn, w, &doc_meta(rumor_id, signer), member(), NOW).expect("doc apply");
    }

    fn snapshot_meta<'a>(
        rumor_id: &'a str,
        is_admin: bool,
        admins: &'a [String],
    ) -> SnapshotApplyMeta<'a> {
        SnapshotApplyMeta {
            rumor_id,
            mls_group_id: GROUP,
            signer_npub: if is_admin { ADMIN } else { ALICE },
            signer_is_member: true,
            signer_is_admin: is_admin,
            admin_npubs: admins,
        }
    }

    fn listed_event_titles(conn: &Connection) -> Vec<String> {
        squad_event::collect_snapshot_events(conn, PARENT, 200)
            .expect("events")
            .into_iter()
            .map(|e| e.title)
            .collect()
    }

    fn listed_doc_ids(conn: &Connection) -> Vec<String> {
        squad_doc::collect_snapshot_docs(conn, PARENT, 200)
            .expect("docs")
            .into_iter()
            .map(|d| d.id)
            .collect()
    }

    fn rsvps_for(conn: &Connection, id: &str) -> Vec<String> {
        squad_event::collect_snapshot_events(conn, PARENT, 200)
            .expect("events")
            .into_iter()
            .find(|e| e.id == id)
            .map(|e| {
                let mut members: Vec<String> = e.rsvps.into_iter().map(|r| r.member_npub).collect();
                members.sort();
                members
            })
            .unwrap_or_default()
    }

    #[test]
    fn parse_rejects_wrong_schema() {
        assert!(try_parse_wire(r#"{"schema":"other","parent_id":"squad-1"}"#).is_none());
        assert!(
            try_parse_wire(r#"{"schema":"pacto.squad_records_snapshot.v1","parent_id":""}"#)
                .is_none()
        );
        assert!(try_parse_wire("not-json").is_none());
    }

    #[test]
    fn parse_defaults_empty_arrays() {
        let w =
            try_parse_wire(r#"{"schema":"pacto.squad_records_snapshot.v1","parent_id":"squad-1"}"#)
                .expect("wire");
        assert!(w.events.is_empty());
        assert!(w.docs.is_empty());
        assert!(w.policy.is_none());
    }

    #[test]
    fn late_joiner_receives_event_doc_and_rsvp() {
        let source = conn();
        apply_event_as(&source, &create_event("ev-1", "Standup", 100), "r1", ALICE);
        apply_event_as(
            &source,
            &rsvp_event("ev-1", RsvpStatus::Tentative, 150),
            "r2",
            CAROL,
        );
        apply_doc_as(
            &source,
            &add_doc("d1", "https://cryptpad.fr/pad/#/2/x", ALICE, 200),
            "r3",
            ALICE,
        );

        let wire = collect_wire(&source, PARENT)
            .expect("collect")
            .expect("payload");
        assert_eq!(wire.events.len(), 1);
        assert_eq!(wire.docs.len(), 1);
        assert_eq!(wire.docs[0].note.as_deref(), Some("secret-note"));

        let dest = conn();
        let admins = vec![ADMIN.to_string()];
        let outcome = apply_snapshot(&dest, &wire, &snapshot_meta("snap-1", false, &admins), NOW)
            .expect("apply");
        assert!(outcome.events_changed);
        assert!(outcome.docs_changed);
        assert!(!outcome.policy_changed);
        assert_eq!(listed_event_titles(&dest), vec!["Standup"]);
        assert_eq!(listed_doc_ids(&dest), vec!["d1"]);
        assert_eq!(
            rsvps_for(&dest, "ev-1"),
            vec![ALICE.to_string(), CAROL.to_string()]
        );
        assert_eq!(
            squad_event::collect_snapshot_events(&dest, PARENT, 200).unwrap()[0].author_npub,
            ALICE
        );
        assert_eq!(
            squad_event::collect_snapshot_events(&dest, PARENT, 200).unwrap()[0].location,
            "42 Secret Lane"
        );
    }

    #[test]
    fn fill_only_keeps_existing_event_body_and_fills_missing_rsvp() {
        let dest = conn();
        apply_event_as(&dest, &create_event("ev-1", "Original", 100), "r1", ALICE);

        let source = conn();
        apply_event_as(&source, &create_event("ev-1", "Changed", 400), "s1", ALICE);
        apply_event_as(
            &source,
            &rsvp_event("ev-1", RsvpStatus::Declined, 450),
            "s2",
            CAROL,
        );
        let wire = collect_wire(&source, PARENT)
            .expect("collect")
            .expect("payload");

        let admins = vec![ADMIN.to_string()];
        apply_snapshot(&dest, &wire, &snapshot_meta("snap-2", false, &admins), NOW).expect("apply");
        assert_eq!(listed_event_titles(&dest), vec!["Original"]);
        assert_eq!(
            rsvps_for(&dest, "ev-1"),
            vec![ALICE.to_string(), CAROL.to_string()]
        );
    }

    #[test]
    fn hidden_docs_are_not_collected() {
        let source = conn();
        apply_doc_as(
            &source,
            &add_doc("d1", "https://cryptpad.fr/pad/#/2/x", ALICE, 100),
            "r1",
            ALICE,
        );
        apply_doc_as(&source, &remove_doc("d1", 200), "r2", ALICE);
        assert!(collect_wire(&source, PARENT).expect("collect").is_none());
    }

    #[test]
    fn non_member_snapshot_is_ignored() {
        let source = conn();
        apply_event_as(&source, &create_event("ev-1", "Standup", 100), "r1", ALICE);
        let wire = collect_wire(&source, PARENT)
            .expect("collect")
            .expect("payload");
        let dest = conn();
        let admins = vec![ADMIN.to_string()];
        let meta = SnapshotApplyMeta {
            rumor_id: "snap",
            mls_group_id: GROUP,
            signer_npub: ALICE,
            signer_is_member: false,
            signer_is_admin: false,
            admin_npubs: &admins,
        };
        let outcome = apply_snapshot(&dest, &wire, &meta, NOW).expect("apply");
        assert!(!outcome.changed());
        assert!(listed_event_titles(&dest).is_empty());
    }

    #[test]
    fn member_snapshot_does_not_apply_policy() {
        let source = conn();
        let policy = SquadContentPolicyWire {
            schema: "pacto.squad_content_policy.v1".into(),
            parent_id: PARENT.into(),
            restrict_event_create: true,
            restrict_event_create_updated_at_ms: 50,
            restrict_doc_add: false,
            restrict_doc_add_updated_at_ms: 0,
        };
        apply_policy(&source, &policy, ADMIN, true, &[ADMIN.to_string()]).expect("policy");
        let wire = collect_wire(&source, PARENT)
            .expect("collect")
            .expect("payload");
        assert!(wire.policy.is_some());

        let dest = conn();
        let admins = vec![ADMIN.to_string()];
        apply_snapshot(&dest, &wire, &snapshot_meta("snap-p", false, &admins), NOW).expect("apply");
        assert!(!load_policy(&dest, PARENT).unwrap().restrict_event_create);
    }

    #[test]
    fn admin_snapshot_applies_policy_and_skips_restricted_member_events() {
        let source = conn();
        apply_event_as(
            &source,
            &create_event("ev-admin", "All-hands", 80),
            "a1",
            ADMIN,
        );
        apply_event_as(
            &source,
            &create_event("ev-member", "Standup", 90),
            "m1",
            ALICE,
        );
        let policy = SquadContentPolicyWire {
            schema: "pacto.squad_content_policy.v1".into(),
            parent_id: PARENT.into(),
            restrict_event_create: true,
            restrict_event_create_updated_at_ms: 200,
            restrict_doc_add: false,
            restrict_doc_add_updated_at_ms: 0,
        };
        apply_policy(&source, &policy, ADMIN, true, &[ADMIN.to_string()]).expect("policy");
        let wire = collect_wire(&source, PARENT)
            .expect("collect")
            .expect("payload");
        assert_eq!(listed_event_titles(&source), vec!["All-hands"]);

        let dest = conn();
        let admins = vec![ADMIN.to_string()];
        let outcome = apply_snapshot(
            &dest,
            &wire,
            &snapshot_meta("snap-admin", true, &admins),
            NOW,
        )
        .expect("apply");
        assert!(outcome.policy_changed);
        assert!(load_policy(&dest, PARENT).unwrap().restrict_event_create);
        assert_eq!(listed_event_titles(&dest), vec!["All-hands"]);
    }

    #[test]
    fn restrict_on_skips_non_admin_event_from_member_snapshot() {
        let dest = conn();
        let policy = SquadContentPolicyWire {
            schema: "pacto.squad_content_policy.v1".into(),
            parent_id: PARENT.into(),
            restrict_event_create: true,
            restrict_event_create_updated_at_ms: 50,
            restrict_doc_add: false,
            restrict_doc_add_updated_at_ms: 0,
        };
        apply_policy(&dest, &policy, ADMIN, true, &[ADMIN.to_string()]).expect("policy");

        let source = conn();
        apply_event_as(&source, &create_event("ev-1", "Standup", 100), "r1", ALICE);
        let mut wire = collect_wire(&source, PARENT)
            .expect("collect")
            .expect("payload");
        wire.policy = None;

        let admins = vec![ADMIN.to_string()];
        apply_snapshot(&dest, &wire, &snapshot_meta("snap-r", false, &admins), NOW).expect("apply");
        assert!(listed_event_titles(&dest).is_empty());
    }

    #[test]
    fn empty_replica_collects_nothing() {
        let conn = conn();
        assert!(collect_wire(&conn, PARENT).expect("collect").is_none());
    }

    #[test]
    fn wrong_group_is_ignored() {
        let source = conn();
        apply_event_as(&source, &create_event("ev-1", "Standup", 100), "r1", ALICE);
        let wire = collect_wire(&source, PARENT)
            .expect("collect")
            .expect("payload");
        let dest = conn();
        let admins = vec![ADMIN.to_string()];
        let meta = SnapshotApplyMeta {
            rumor_id: "snap",
            mls_group_id: "other-group",
            signer_npub: ALICE,
            signer_is_member: true,
            signer_is_admin: false,
            admin_npubs: &admins,
        };
        let outcome = apply_snapshot(&dest, &wire, &meta, NOW).expect("apply");
        assert!(!outcome.changed());
    }
}
