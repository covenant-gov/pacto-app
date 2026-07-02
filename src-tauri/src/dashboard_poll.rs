//! Dashboard polls over MLS (Kind **30078**): poll-create plus silent vote rumors and a SQLite replica.
//!
//! Replica rows are keyed by **`parent_id`** (squad/network) and **`poll_id`**; `list_dashboard_polls` does not
//! depend on MLS chat beyond ingest. The **`announcements_group_id`** column stores the ingress MLS chat id (the announcements scope used for Kind **30078** sends).

use nostr_sdk::prelude::*;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Runtime};

use crate::stored_event::event_kind;
use crate::{db, get_nostr_client, message::Message, TAURI_APP};

pub const DASHBOARD_POLL_D_TAG: &str = "pacto_dashboard_poll";

/// Wire JSON for votes (Kind 30078).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardPollVoteWire {
    pub schema: String,
    pub action: String,
    pub parent_id: String,
    pub poll_id: String,
    pub option_id: String,
}

/// Announcement-style payload for poll create (matches frontend `type` + `payload`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardPollCreatedPayload {
    pub parent_id: String,
    pub poll_id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub options: Vec<PollOptionWire>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PollOptionWire {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardPollAnnounceEnvelope {
    #[serde(rename = "type")]
    pub announce_type: String,
    pub payload: DashboardPollCreatedPayload,
}

pub fn hash_poll_payload(title: &str, description: &str, options_json: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(title.as_bytes());
    hasher.update(b"|");
    hasher.update(description.as_bytes());
    hasher.update(b"|");
    hasher.update(options_json.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn validate_options(opts: &[PollOptionWire]) -> bool {
    opts.len() >= 2 && opts.iter().all(|o| !o.id.trim().is_empty() && !o.label.trim().is_empty())
}

/// Try parse vote wire from JSON content.
pub fn try_parse_vote(content: &str) -> Option<DashboardPollVoteWire> {
    let v: DashboardPollVoteWire = serde_json::from_str(content.trim()).ok()?;
    if v.schema != "pacto.dashboard_poll.v1" || v.action != "vote" {
        return None;
    }
    if v.parent_id.trim().is_empty()
        || v.poll_id.trim().is_empty()
        || v.option_id.trim().is_empty()
    {
        return None;
    }
    Some(v)
}

/// Try parse poll create announcement envelope.
pub fn try_parse_create_announce(content: &str) -> Option<DashboardPollAnnounceEnvelope> {
    let v: DashboardPollAnnounceEnvelope = serde_json::from_str(content.trim()).ok()?;
    if v.announce_type != "dashboard_poll_created" {
        return None;
    }
    if v.payload.parent_id.trim().is_empty()
        || v.payload.poll_id.trim().is_empty()
        || v.payload.title.trim().is_empty()
    {
        return None;
    }
    if !validate_options(&v.payload.options) {
        return None;
    }
    Some(v)
}

pub fn has_dashboard_poll_d_tag(tags: &Tags) -> bool {
    tags.find(TagKind::d())
        .and_then(|t| t.content())
        .map(|c| c == DASHBOARD_POLL_D_TAG)
        .unwrap_or(false)
}

pub(crate) fn emit_poll_replica_updated(parent_id: &str, poll_id: Option<&str>) {
    if let Some(handle) = TAURI_APP.get() {
        let _ = handle.emit(
            "dashboard_poll_replica_updated",
            serde_json::json!({ "parent_id": parent_id, "poll_id": poll_id }),
        );
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PollCreateUpsert {
    InsertedNew,
    IdempotentSamePayload,
    IgnoredConflictingPayload,
}

/// First-create wins for metadata; idempotent same-hash replay.
pub fn db_insert_poll_create<R: Runtime>(
    handle: &AppHandle<R>,
    mls_group_id: &str,
    create_event_id: &str,
    created_at_ms: i64,
    created_by_npub: &str,
    payload: &DashboardPollCreatedPayload,
) -> Result<PollCreateUpsert, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;
    let res = (|| {
        let options_json = serde_json::to_string(&payload.options)
            .map_err(|e| format!("options json: {}", e))?;
        let h = hash_poll_payload(&payload.title, &payload.description, &options_json);

        let existed: Option<String> = conn
            .query_row(
                "SELECT content_hash FROM dashboard_polls WHERE poll_id = ?1",
                [&payload.poll_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some(prev_hash) = existed {
            if prev_hash == h {
                return Ok(PollCreateUpsert::IdempotentSamePayload);
            }
            return Ok(PollCreateUpsert::IgnoredConflictingPayload);
        }

        conn.execute(
            r#"INSERT INTO dashboard_polls (
            poll_id, parent_id, announcements_group_id, title, description, options_json,
            created_at_ms, created_by_npub, create_event_id, content_hash
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"#,
            rusqlite::params![
                &payload.poll_id,
                &payload.parent_id,
                mls_group_id,
                &payload.title,
                &payload.description,
                &options_json,
                created_at_ms,
                created_by_npub,
                create_event_id,
                &h,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(PollCreateUpsert::InsertedNew)
    })();
    crate::account_manager::return_db_connection(conn);
    res
}

fn option_id_valid_for_poll(options_json: &str, option_id: &str) -> bool {
    let Ok(opts) = serde_json::from_str::<Vec<PollOptionWire>>(options_json) else {
        return false;
    };
    opts.iter().any(|o| o.id == option_id)
}

/// Last vote wins by `voted_at_ms`. `parent_id` must match the poll row (wire sanity).
pub fn db_apply_vote<R: Runtime>(
    handle: &AppHandle<R>,
    parent_id: &str,
    poll_id: &str,
    voter_npub: &str,
    option_id: &str,
    vote_event_id: &str,
    voted_at_ms: i64,
) -> Result<bool, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;
    let res = (|| {
        let row: Option<(String, String)> = conn
            .query_row(
                "SELECT options_json, parent_id FROM dashboard_polls WHERE poll_id = ?1",
                [poll_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let Some((options_json, stored_parent)) = row else {
            return Ok(false);
        };

        if stored_parent.trim() != parent_id.trim() {
            return Ok(false);
        }

        if !option_id_valid_for_poll(&options_json, option_id) {
            return Ok(false);
        }

        conn.execute(
            r#"INSERT INTO dashboard_poll_votes (poll_id, voter_npub, option_id, vote_event_id, voted_at_ms)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(poll_id, voter_npub) DO UPDATE SET
             option_id = excluded.option_id,
             vote_event_id = excluded.vote_event_id,
             voted_at_ms = excluded.voted_at_ms
           WHERE excluded.voted_at_ms >= dashboard_poll_votes.voted_at_ms"#,
            rusqlite::params![poll_id, voter_npub, option_id, vote_event_id, voted_at_ms],
        )
        .map_err(|e| e.to_string())?;

        Ok(true)
    })();
    crate::account_manager::return_db_connection(conn);
    res
}

#[derive(Debug, Serialize)]
pub struct DashboardPollDto {
    pub id: String,
    pub parent_id: String,
    pub title: String,
    pub description: String,
    pub options: Vec<PollOptionDto>,
    pub created_at_ms: i64,
    pub created_by_npub: String,
}

#[derive(Debug, Serialize)]
pub struct PollOptionDto {
    pub id: String,
    pub label: String,
    pub votes: i64,
}

#[tauri::command]
pub async fn list_dashboard_polls<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
) -> Result<Vec<DashboardPollDto>, String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let rows: Vec<(String, String, String, String, String, i64, String)> = {
        let mut stmt = conn
            .prepare(
                r#"SELECT p.poll_id, p.parent_id, p.title, p.description, p.options_json, p.created_at_ms, p.created_by_npub
               FROM dashboard_polls p
               WHERE p.parent_id = ?1
               ORDER BY p.created_at_ms ASC"#,
            )
            .map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map([&parent_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, String>(6)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        mapped
            .filter_map(|r| r.ok())
            .collect()
    };

    let mut out = Vec::new();
    for (poll_id, parent_id, title, description, options_json, created_at_ms, created_by_npub) in rows {
        let opts: Vec<PollOptionWire> =
            serde_json::from_str(&options_json).map_err(|e| e.to_string())?;

        let mut counts: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
        let vote_rows: Vec<(String, i64)> = {
            let mut vstmt = conn
                .prepare(
                    "SELECT option_id, COUNT(*) FROM dashboard_poll_votes WHERE poll_id = ?1 GROUP BY option_id",
                )
                .map_err(|e| e.to_string())?;
            let vmapped = vstmt.query_map([&poll_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            }).map_err(|e| e.to_string())?;
            vmapped.filter_map(|r| r.ok()).collect()
        };
        for (oid, c) in vote_rows {
            counts.insert(oid, c);
        }

        let options: Vec<PollOptionDto> = opts
            .into_iter()
            .map(|o| PollOptionDto {
                votes: *counts.get(&o.id).unwrap_or(&0),
                id: o.id,
                label: o.label,
            })
            .collect();

        out.push(DashboardPollDto {
            id: poll_id,
            parent_id,
            title,
            description,
            options,
            created_at_ms,
            created_by_npub,
        });
    }
    crate::account_manager::return_db_connection(conn);
    Ok(out)
}

#[derive(Debug, Deserialize)]
pub struct SendPollOptionInput {
    pub id: String,
    pub label: String,
}

#[tauri::command]
pub async fn send_dashboard_poll_create<R: Runtime>(
    handle: AppHandle<R>,
    mls_group_id: String,
    parent_id: String,
    poll_id: String,
    title: String,
    description: String,
    options: Vec<SendPollOptionInput>,
) -> Result<(), String> {
    if title.trim().is_empty() {
        return Err("Title required".into());
    }
    let opts: Vec<PollOptionWire> = options
        .into_iter()
        .map(|o| PollOptionWire {
            id: o.id,
            label: o.label,
        })
        .collect();
    if !validate_options(&opts) {
        return Err("At least two non-empty options required".into());
    }

    let client = get_nostr_client()?;
    let signer = client.signer().await.map_err(|e| e.to_string())?;
    let pk = signer.get_public_key().await.map_err(|e| e.to_string())?;

    let envelope = DashboardPollAnnounceEnvelope {
        announce_type: "dashboard_poll_created".into(),
        payload: DashboardPollCreatedPayload {
            parent_id: parent_id.clone(),
            poll_id: poll_id.clone(),
            title: title.clone(),
            description: description.clone(),
            options: opts,
        },
    };
    let content = serde_json::to_string(&envelope).map_err(|e| e.to_string())?;

    let final_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap();
    let ms = (final_time.as_millis() % 1000) as u64;

    let rumor = EventBuilder::new(Kind::ApplicationSpecificData, &content)
        .tag(Tag::custom(TagKind::d(), [DASHBOARD_POLL_D_TAG]))
        .tag(Tag::custom(
            TagKind::Custom(std::borrow::Cow::Borrowed("parent")),
            [&parent_id],
        ))
        .tag(Tag::custom(
            TagKind::Custom(std::borrow::Cow::Borrowed("poll")),
            [&poll_id],
        ))
        .tag(Tag::custom(TagKind::custom("pacto_bucket"), ["announcements"]))
        .tag(Tag::custom(TagKind::custom("ms"), [ms.to_string()]));

    let built = rumor.build(pk);
    let create_hex = built.id.ok_or_else(|| "poll create rumor id missing".to_string())?;
    let create_id = create_hex.to_hex();
    crate::mls::send_mls_message(&mls_group_id, built, None).await?;

    let created_by = pk.to_bech32().map_err(|e| e.to_string())?;
    let at_ms = final_time.as_millis() as i64;
    let _ = db_insert_poll_create(
        &handle,
        &mls_group_id,
        &create_id,
        at_ms,
        &created_by,
        &envelope.payload,
    )?;

    emit_poll_replica_updated(&parent_id, Some(&poll_id));

    if let Some(h) = TAURI_APP.get() {
        let msg = Message {
            id: create_id.clone(),
            content: content.clone(),
            replied_to: String::new(),
            replied_to_content: None,
            replied_to_npub: None,
            replied_to_has_attachment: None,
            preview_metadata: None,
            attachments: vec![],
            reactions: vec![],
            at: at_ms as u64,
            pending: false,
            failed: false,
            mine: true,
            npub: Some(created_by.clone()),
            wrapper_event_id: None,
            edited: false,
            edit_history: None,
            rumor_kind: Some(event_kind::APPLICATION_SPECIFIC),
            virtual_bucket: Some("announcements".to_string()),
        };
        let was_added = {
            let mut state = crate::STATE.lock().await;
            state.add_message_to_chat(&mls_group_id, msg.clone())
        };
        if was_added {
            let _ = db::save_message(h.clone(), &mls_group_id, &msg).await;
            let _ = h.emit(
                "mls_message_new",
                serde_json::json!({ "group_id": mls_group_id, "message": msg }),
            );
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn send_dashboard_poll_vote<R: Runtime>(
    handle: AppHandle<R>,
    mls_group_id: String,
    parent_id: String,
    poll_id: String,
    option_id: String,
) -> Result<(), String> {
    let client = get_nostr_client()?;
    let signer = client.signer().await.map_err(|e| e.to_string())?;
    let pk = signer.get_public_key().await.map_err(|e| e.to_string())?;

    let wire = DashboardPollVoteWire {
        schema: "pacto.dashboard_poll.v1".into(),
        action: "vote".into(),
        parent_id: parent_id.clone(),
        poll_id: poll_id.clone(),
        option_id: option_id.clone(),
    };
    let content = serde_json::to_string(&wire).map_err(|e| e.to_string())?;

    let final_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap();
    let ms = (final_time.as_millis() % 1000) as u64;

    let rumor = EventBuilder::new(Kind::ApplicationSpecificData, &content)
        .tag(Tag::custom(TagKind::d(), [DASHBOARD_POLL_D_TAG]))
        .tag(Tag::custom(
            TagKind::Custom(std::borrow::Cow::Borrowed("parent")),
            [&parent_id],
        ))
        .tag(Tag::custom(
            TagKind::Custom(std::borrow::Cow::Borrowed("poll")),
            [&poll_id],
        ))
        .tag(Tag::custom(
            TagKind::Custom(std::borrow::Cow::Borrowed("option")),
            [&option_id],
        ))
        .tag(Tag::custom(TagKind::custom("pacto_bucket"), ["polls"]))
        .tag(Tag::custom(TagKind::custom("ms"), [ms.to_string()]));

    let built = rumor.build(pk);
    let vote_id = built.id.ok_or("rumor id missing")?.to_hex();
    crate::mls::send_mls_message(&mls_group_id, built, None).await?;

    let voter = pk.to_bech32().map_err(|e| e.to_string())?;
    let voted_at = final_time.as_millis() as i64;
    let _ = db_apply_vote(
        &handle,
        &parent_id,
        &poll_id,
        &voter,
        &option_id,
        &vote_id,
        voted_at,
    )?;
    emit_poll_replica_updated(&parent_id, Some(&poll_id));
    Ok(())
}
