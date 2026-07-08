//! Commons squad join requests — public Kind **30078** events on trusted relays.

use nostr_sdk::prelude::*;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::collections::HashSet;
use tauri::{AppHandle, Runtime};

use crate::commons::{has_commons_client_tag, COMMONS_CLIENT_TAG};
use crate::stored_event::event_kind;
use crate::{get_nostr_client, TRUSTED_RELAYS};

pub const COMMONS_JOIN_REQUEST_D_PREFIX: &str = "pacto_commons_join_request";
pub const COMMONS_JOIN_REQUEST_RESPONSE_D_PREFIX: &str = "pacto_commons_join_request_response";
pub const COMMONS_JOIN_REQUEST_SCHEMA: &str = "pacto.commons.join_request.v1";
pub const COMMONS_JOIN_REQUEST_RESPONSE_SCHEMA: &str = "pacto.commons.join_request_response.v1";
pub const COMMONS_JOIN_REQUEST_MAX_LOOKBACK_SECS: u64 = 7 * 24 * 3600;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommonsJoinRequestWire {
    pub schema: String,
    pub squad_id: String,
    pub squad_name: String,
    pub broadcast_event_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommonsJoinRequestResponseWire {
    pub schema: String,
    pub request_event_id: String,
    pub squad_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommonsJoinRequestDto {
    pub event_id: String,
    pub requester_npub: String,
    pub squad_id: String,
    pub squad_name: String,
    pub broadcast_event_id: String,
    pub created_at: i64,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub responded_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub responder_npub: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommonsPublishJoinRequestInput {
    pub squad_id: String,
    pub squad_name: String,
    pub broadcast_event_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommonsRespondJoinRequestInput {
    pub request_event_id: String,
    pub squad_id: String,
    pub status: String,
}

fn unix_now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn join_request_d_tag(squad_id: &str, requester_hex: &str) -> String {
    format!("{COMMONS_JOIN_REQUEST_D_PREFIX}/{squad_id}/{requester_hex}")
}

fn join_request_response_d_tag(request_event_id: &str) -> String {
    format!("{COMMONS_JOIN_REQUEST_RESPONSE_D_PREFIX}/{request_event_id}")
}

fn valid_status(status: &str) -> bool {
    status == "pending" || status == "accepted" || status == "rejected"
}

fn tag_content<'a>(tags: &'a Tags, kind: TagKind<'a>) -> Option<&'a str> {
    tags.find(kind).and_then(|t| t.content())
}

fn has_join_request_d_tag(tags: &Tags) -> bool {
    tags.find(TagKind::d())
        .and_then(|t| t.content())
        .map(|c| c.starts_with(COMMONS_JOIN_REQUEST_D_PREFIX))
        .unwrap_or(false)
}

fn has_join_request_response_d_tag(tags: &Tags) -> bool {
    tags.find(TagKind::d())
        .and_then(|t| t.content())
        .map(|c| c.starts_with(COMMONS_JOIN_REQUEST_RESPONSE_D_PREFIX))
        .unwrap_or(false)
}

fn try_parse_join_request_event(event: &Event) -> Option<(CommonsJoinRequestWire, String)> {
    if event.kind.as_u16() != event_kind::APPLICATION_SPECIFIC {
        return None;
    }
    if !has_join_request_d_tag(&event.tags) || !has_commons_client_tag(&event.tags) {
        return None;
    }
    let wire: CommonsJoinRequestWire = serde_json::from_str(event.content.trim()).ok()?;
    if wire.schema != COMMONS_JOIN_REQUEST_SCHEMA {
        return None;
    }
    if wire.squad_id.trim().is_empty()
        || wire.squad_name.trim().is_empty()
        || wire.broadcast_event_id.trim().is_empty()
    {
        return None;
    }
    let squad_tag = tag_content(&event.tags, TagKind::Custom(Cow::Borrowed("squad")))?;
    if squad_tag != wire.squad_id {
        return None;
    }
    let requester_npub = event.pubkey.to_bech32().ok()?;
    Some((wire, requester_npub))
}

fn try_parse_join_request_response_event(
    event: &Event,
) -> Option<(CommonsJoinRequestResponseWire, String)> {
    if event.kind.as_u16() != event_kind::APPLICATION_SPECIFIC {
        return None;
    }
    if !has_join_request_response_d_tag(&event.tags) || !has_commons_client_tag(&event.tags) {
        return None;
    }
    let wire: CommonsJoinRequestResponseWire = serde_json::from_str(event.content.trim()).ok()?;
    if wire.schema != COMMONS_JOIN_REQUEST_RESPONSE_SCHEMA {
        return None;
    }
    if wire.request_event_id.trim().is_empty()
        || wire.squad_id.trim().is_empty()
        || !valid_status(&wire.status)
        || wire.status == "pending"
    {
        return None;
    }
    let squad_tag = tag_content(&event.tags, TagKind::Custom(Cow::Borrowed("squad")))?;
    if squad_tag != wire.squad_id {
        return None;
    }
    let responder_npub = event.pubkey.to_bech32().ok()?;
    Some((wire, responder_npub))
}

pub fn ensure_commons_join_requests_table(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"CREATE TABLE IF NOT EXISTS commons_join_requests (
            event_id TEXT PRIMARY KEY NOT NULL,
            requester_npub TEXT NOT NULL,
            squad_id TEXT NOT NULL,
            squad_name TEXT NOT NULL,
            broadcast_event_id TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            responded_at INTEGER,
            responder_npub TEXT,
            content_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_commons_join_requests_squad ON commons_join_requests(squad_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_commons_join_requests_status ON commons_join_requests(status);"#,
    )
    .map_err(|e| format!("Failed to create commons_join_requests table: {e}"))
}

fn upsert_join_request_row(
    conn: &rusqlite::Connection,
    event: &Event,
    wire: &CommonsJoinRequestWire,
    requester_npub: &str,
) -> Result<(), String> {
    let content_json = serde_json::to_string(wire).map_err(|e| e.to_string())?;
    conn.execute(
        r#"INSERT INTO commons_join_requests (
            event_id, requester_npub, squad_id, squad_name, broadcast_event_id,
            status, created_at, responded_at, responder_npub, content_json
        ) VALUES (?1,?2,?3,?4,?5,'pending',?6,NULL,NULL,?7)
        ON CONFLICT(event_id) DO UPDATE SET
            squad_name=excluded.squad_name,
            broadcast_event_id=excluded.broadcast_event_id,
            content_json=excluded.content_json"#,
        params![
            event.id.to_hex(),
            requester_npub,
            wire.squad_id,
            wire.squad_name,
            wire.broadcast_event_id,
            event.created_at.as_u64() as i64,
            content_json,
        ],
    )
    .map_err(|e| format!("Failed to upsert commons join request: {e}"))?;
    Ok(())
}

fn apply_join_request_response_row(
    conn: &rusqlite::Connection,
    wire: &CommonsJoinRequestResponseWire,
    responder_npub: &str,
    responded_at: i64,
) -> Result<(), String> {
    conn.execute(
        r#"UPDATE commons_join_requests
           SET status = ?1, responded_at = ?2, responder_npub = ?3
           WHERE event_id = ?4 AND status = 'pending'"#,
        params![
            wire.status,
            responded_at,
            responder_npub,
            wire.request_event_id,
        ],
    )
    .map_err(|e| format!("Failed to apply join request response: {e}"))?;
    Ok(())
}

fn row_to_dto(row: &rusqlite::Row<'_>) -> rusqlite::Result<CommonsJoinRequestDto> {
    Ok(CommonsJoinRequestDto {
        event_id: row.get(0)?,
        requester_npub: row.get(1)?,
        squad_id: row.get(2)?,
        squad_name: row.get(3)?,
        broadcast_event_id: row.get(4)?,
        created_at: row.get(6)?,
        status: row.get(5)?,
        responded_at: row.get(7)?,
        responder_npub: row.get(8)?,
    })
}

fn list_join_requests_for_squads(
    conn: &rusqlite::Connection,
    squad_ids: &[String],
    pending_only: bool,
) -> Result<Vec<CommonsJoinRequestDto>, String> {
    if squad_ids.is_empty() {
        return Ok(vec![]);
    }
    let placeholders = squad_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(", ");
    let status_clause = if pending_only {
        " AND status = 'pending'"
    } else {
        ""
    };
    let sql = format!(
        r#"SELECT event_id, requester_npub, squad_id, squad_name, broadcast_event_id,
                  status, created_at, responded_at, responder_npub
           FROM commons_join_requests
           WHERE squad_id IN ({placeholders}){status_clause}
           ORDER BY created_at DESC"#
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(squad_ids.iter()), row_to_dto)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

async fn sync_join_requests_from_relays(squad_ids: &[String]) -> Result<u32, String> {
    if squad_ids.is_empty() {
        return Ok(0);
    }
    let client = get_nostr_client().map_err(|_| "Nostr client not initialized".to_string())?;
    let since = unix_now_secs().saturating_sub(COMMONS_JOIN_REQUEST_MAX_LOOKBACK_SECS as i64);
    let filter = Filter::new()
        .kind(Kind::ApplicationSpecificData)
        .since(Timestamp::from(since as u64))
        .limit(500);

    let mut events = client
        .stream_events_from(
            TRUSTED_RELAYS.to_vec(),
            filter,
            std::time::Duration::from_secs(12),
        )
        .await
        .map_err(|e| e.to_string())?;

    let handle = crate::TAURI_APP
        .get()
        .ok_or_else(|| "App handle not initialized".to_string())?;
    let conn = crate::account_manager::get_db_connection(handle)?;
    ensure_commons_join_requests_table(&conn)?;

    let squad_set: HashSet<&str> = squad_ids.iter().map(|s| s.as_str()).collect();
    let mut ingested = 0u32;
    while let Some(event) = events.next().await {
        if let Some((wire, requester_npub)) = try_parse_join_request_event(&event) {
            if squad_set.contains(wire.squad_id.as_str()) {
                if upsert_join_request_row(&conn, &event, &wire, &requester_npub).is_ok() {
                    ingested += 1;
                }
            }
            continue;
        }
        if let Some((wire, responder_npub)) = try_parse_join_request_response_event(&event) {
            if squad_set.contains(wire.squad_id.as_str()) {
                if apply_join_request_response_row(
                    &conn,
                    &wire,
                    &responder_npub,
                    event.created_at.as_u64() as i64,
                )
                .is_ok()
                {
                    ingested += 1;
                }
            }
        }
    }
    crate::account_manager::return_db_connection(conn);
    Ok(ingested)
}

fn join_request_event_builder(
    wire: &CommonsJoinRequestWire,
    content: &str,
    requester_hex: &str,
) -> EventBuilder {
    EventBuilder::new(Kind::ApplicationSpecificData, content)
        .tag(Tag::custom(
            TagKind::d(),
            [join_request_d_tag(&wire.squad_id, requester_hex)],
        ))
        .tag(Tag::custom(
            TagKind::Custom(Cow::Borrowed("client")),
            [COMMONS_CLIENT_TAG],
        ))
        .tag(Tag::custom(
            TagKind::Custom(Cow::Borrowed("squad")),
            [wire.squad_id.as_str()],
        ))
}

fn join_request_response_event_builder(
    wire: &CommonsJoinRequestResponseWire,
    content: &str,
) -> EventBuilder {
    EventBuilder::new(Kind::ApplicationSpecificData, content)
        .tag(Tag::custom(
            TagKind::d(),
            [join_request_response_d_tag(&wire.request_event_id)],
        ))
        .tag(Tag::custom(
            TagKind::Custom(Cow::Borrowed("client")),
            [COMMONS_CLIENT_TAG],
        ))
        .tag(Tag::custom(
            TagKind::Custom(Cow::Borrowed("squad")),
            [wire.squad_id.as_str()],
        ))
}

#[tauri::command]
pub async fn commons_publish_join_request<R: Runtime>(
    handle: AppHandle<R>,
    input: CommonsPublishJoinRequestInput,
) -> Result<CommonsJoinRequestDto, String> {
    let squad_id = input.squad_id.trim();
    let squad_name = input.squad_name.trim();
    let broadcast_event_id = input.broadcast_event_id.trim();
    if squad_id.is_empty() || squad_name.is_empty() || broadcast_event_id.is_empty() {
        return Err("squadId, squadName, and broadcastEventId are required".into());
    }

    let wire = CommonsJoinRequestWire {
        schema: COMMONS_JOIN_REQUEST_SCHEMA.into(),
        squad_id: squad_id.into(),
        squad_name: squad_name.into(),
        broadcast_event_id: broadcast_event_id.into(),
    };
    let content = serde_json::to_string(&wire).map_err(|e| e.to_string())?;

    let client = get_nostr_client().map_err(|_| "Nostr client not initialized".to_string())?;
    let signer = client.signer().await.map_err(|e| e.to_string())?;
    let pk = signer.get_public_key().await.map_err(|e| e.to_string())?;
    let requester_npub = pk.to_bech32().map_err(|e| e.to_string())?;
    let requester_hex = pk.to_hex();

    let builder = join_request_event_builder(&wire, &content, &requester_hex);
    let event = client
        .sign_event_builder(builder)
        .await
        .map_err(|e| e.to_string())?;
    client
        .send_event_to(TRUSTED_RELAYS.iter().copied(), &event)
        .await
        .map_err(|e| e.to_string())?;

    let conn = crate::account_manager::get_db_connection(&handle)?;
    ensure_commons_join_requests_table(&conn)?;
    upsert_join_request_row(&conn, &event, &wire, &requester_npub)?;
    crate::account_manager::return_db_connection(conn);

    Ok(CommonsJoinRequestDto {
        event_id: event.id.to_hex(),
        requester_npub,
        squad_id: wire.squad_id,
        squad_name: wire.squad_name,
        broadcast_event_id: wire.broadcast_event_id,
        created_at: event.created_at.as_u64() as i64,
        status: "pending".into(),
        responded_at: None,
        responder_npub: None,
    })
}

#[tauri::command]
pub async fn commons_fetch_join_requests(
    squad_ids: Vec<String>,
    pending_only: Option<bool>,
) -> Result<Vec<CommonsJoinRequestDto>, String> {
    let squad_ids: Vec<String> = squad_ids
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let _ = sync_join_requests_from_relays(&squad_ids).await?;
    let handle = crate::TAURI_APP
        .get()
        .ok_or_else(|| "App handle not initialized".to_string())?;
    let conn = crate::account_manager::get_db_connection(handle)?;
    ensure_commons_join_requests_table(&conn)?;
    let rows = list_join_requests_for_squads(&conn, &squad_ids, pending_only.unwrap_or(true))?;
    crate::account_manager::return_db_connection(conn);
    Ok(rows)
}

#[tauri::command]
pub async fn commons_respond_join_request<R: Runtime>(
    handle: AppHandle<R>,
    input: CommonsRespondJoinRequestInput,
) -> Result<CommonsJoinRequestDto, String> {
    let request_event_id = input.request_event_id.trim();
    let squad_id = input.squad_id.trim();
    let status = input.status.trim();
    if request_event_id.is_empty() || squad_id.is_empty() {
        return Err("requestEventId and squadId are required".into());
    }
    if status != "accepted" && status != "rejected" {
        return Err("status must be accepted or rejected".into());
    }

    let conn = crate::account_manager::get_db_connection(&handle)?;
    ensure_commons_join_requests_table(&conn)?;
    let existing: Option<CommonsJoinRequestDto> = {
        let mut stmt = conn
            .prepare(
                r#"SELECT event_id, requester_npub, squad_id, squad_name, broadcast_event_id,
                          status, created_at, responded_at, responder_npub
                   FROM commons_join_requests
                   WHERE event_id = ?1 AND squad_id = ?2"#,
            )
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![request_event_id, squad_id], row_to_dto)
            .optional()
            .map_err(|e| e.to_string())?
    };
    let existing = existing.ok_or_else(|| "Join request not found".to_string())?;
    if existing.status != "pending" {
        crate::account_manager::return_db_connection(conn);
        return Ok(existing);
    }
    crate::account_manager::return_db_connection(conn);

    let wire = CommonsJoinRequestResponseWire {
        schema: COMMONS_JOIN_REQUEST_RESPONSE_SCHEMA.into(),
        request_event_id: request_event_id.into(),
        squad_id: squad_id.into(),
        status: status.into(),
    };
    let content = serde_json::to_string(&wire).map_err(|e| e.to_string())?;

    let client = get_nostr_client().map_err(|_| "Nostr client not initialized".to_string())?;
    let signer = client.signer().await.map_err(|e| e.to_string())?;
    let pk = signer.get_public_key().await.map_err(|e| e.to_string())?;
    let responder_npub = pk.to_bech32().map_err(|e| e.to_string())?;

    let builder = join_request_response_event_builder(&wire, &content);
    let event = client
        .sign_event_builder(builder)
        .await
        .map_err(|e| e.to_string())?;
    client
        .send_event_to(TRUSTED_RELAYS.iter().copied(), &event)
        .await
        .map_err(|e| e.to_string())?;

    let conn = crate::account_manager::get_db_connection(&handle)?;
    apply_join_request_response_row(
        &conn,
        &wire,
        &responder_npub,
        event.created_at.as_u64() as i64,
    )?;
    let updated = {
        let mut stmt = conn
            .prepare(
                r#"SELECT event_id, requester_npub, squad_id, squad_name, broadcast_event_id,
                          status, created_at, responded_at, responder_npub
                   FROM commons_join_requests
                   WHERE event_id = ?1"#,
            )
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![request_event_id], row_to_dto)
            .map_err(|e| e.to_string())?
    };
    crate::account_manager::return_db_connection(conn);
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_request_d_tag_is_stable() {
        assert_eq!(
            join_request_d_tag("abc", "deadbeef"),
            "pacto_commons_join_request/abc/deadbeef"
        );
    }
}
