//! Squad events over MLS (kind 30078, `d` = `pacto_squad_event`): NIP-52-shaped fields inside the
//! encrypted rumor, plus a SQLite replica of events, RSVPs, and children awaiting their create.
//!
//! Writes are last-`updated_at_ms`-wins per event (equal keeps the stored row); cancel is sticky.

use std::collections::HashMap;

use nostr_sdk::prelude::*;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Runtime};

use crate::nostr_tags;
use crate::rumor::{ConversationType, RumorContext, RumorEvent, RumorProcessingResult};
use crate::squad_event_time as civil;
use crate::squad_records::{
    self, card_message, signer_identity, store_local_card, with_conn, SquadGroupRole,
    SQUAD_EVENT_D_TAG,
};
use crate::TAURI_APP;

const SCHEMA: &str = "pacto.squad_event.v1";
pub const KIND_ALL_DAY: u16 = 31922;
pub const KIND_TIMED: u16 = 31923;
pub const WEEKLY_SERIES_COUNT: usize = 8;
const DATE_FORMAT: &str = "%Y-%m-%d";
const REPLICA_UPDATED_EVENT: &str = "squad_event_replica_updated";
/// Ingest drops ops stamped further ahead of the local clock than this.
const MAX_FUTURE_SKEW_MS: i64 = 24 * 60 * 60 * 1000;
/// Queued children kept per parent and author; older ones are dropped first.
const MAX_PENDING_PER_AUTHOR: i64 = 200;
const PENDING_TTL_MS: i64 = 30 * 24 * 60 * 60 * 1000;

/// Command error codes the frontend translates.
pub mod err {
    pub const NOT_MEMBER: &str = "squad_records_not_member";
    pub const WRONG_GROUP: &str = "squad_records_wrong_group";
    pub const CREATE_RESTRICTED: &str = "squad_event_create_restricted";
    pub const NOT_FOUND: &str = "squad_event_not_found";
    pub const NOT_EDITABLE: &str = "squad_event_not_editable";
    pub const INVALID_TITLE: &str = "squad_event_invalid_title";
    pub const INVALID_ZONE: &str = "squad_event_invalid_zone";
    pub const INVALID_TIME: &str = "squad_event_invalid_time";
    pub const INVALID_PLACE: &str = "squad_event_invalid_place";
    pub const INVALID_SERIES: &str = "squad_event_invalid_series";
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Place {
    Online,
    Offline,
}

impl Place {
    fn as_str(self) -> &'static str {
        match self {
            Place::Online => "online",
            Place::Offline => "offline",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        match s {
            "online" => Some(Place::Online),
            "offline" => Some(Place::Offline),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RsvpStatus {
    Accepted,
    Tentative,
    Declined,
}

impl RsvpStatus {
    fn as_str(self) -> &'static str {
        match self {
            RsvpStatus::Accepted => "accepted",
            RsvpStatus::Tentative => "tentative",
            RsvpStatus::Declined => "declined",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        match s {
            "accepted" => Some(RsvpStatus::Accepted),
            "tentative" => Some(RsvpStatus::Tentative),
            "declined" => Some(RsvpStatus::Declined),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventStatus {
    Active,
    Cancelled,
}

impl EventStatus {
    fn as_str(self) -> &'static str {
        match self {
            EventStatus::Active => "active",
            EventStatus::Cancelled => "cancelled",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        match s {
            "active" => Some(EventStatus::Active),
            "cancelled" => Some(EventStatus::Cancelled),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Op {
    Create,
    Update,
    Rsvp,
    Cancel,
    SeriesCard,
}

impl Op {
    fn as_str(self) -> &'static str {
        match self {
            Op::Create => "create",
            Op::Update => "update",
            Op::Rsvp => "rsvp",
            Op::Cancel => "cancel",
            Op::SeriesCard => "series_card",
        }
    }
}

/// Timed values are unix seconds; all-day values are `YYYY-MM-DD`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WireTime {
    Unix(i64),
    Date(String),
}

/// Rumor content for every op. `status` is the event status on cancel and the RSVP status on rsvp.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventWire {
    pub schema: String,
    pub op: Op,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub parent_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub series_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<WireTime>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<WireTime>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_tzid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub place: Option<Place>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rsvp: Option<RsvpStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_start: Option<WireTime>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub count: Option<u32>,
    pub updated_at_ms: i64,
}

impl EventWire {
    fn base(op: Op, parent_id: &str, updated_at_ms: i64) -> Self {
        EventWire {
            schema: SCHEMA.to_string(),
            op,
            id: None,
            parent_id: parent_id.to_string(),
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
            status: None,
            rsvp: None,
            first_start: None,
            count: None,
            updated_at_ms,
        }
    }
}

/// Validated event fields (one occurrence).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EventFields {
    pub kind: u16,
    pub title: String,
    pub summary: String,
    pub start_unix: Option<i64>,
    pub end_unix: Option<i64>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub start_tzid: String,
    pub place: Place,
    pub location: String,
    pub channel_id: Option<String>,
}

impl EventFields {
    fn start_value(&self) -> serde_json::Value {
        time_value(self.start_unix, self.start_date.as_deref())
    }

    fn end_value(&self) -> serde_json::Value {
        time_value(self.end_unix, self.end_date.as_deref())
    }

    fn start_wire(&self) -> Option<WireTime> {
        wire_time(self.start_unix, self.start_date.as_deref())
    }

    fn end_wire(&self) -> Option<WireTime> {
        wire_time(self.end_unix, self.end_date.as_deref())
    }
}

fn wire_time(unix: Option<i64>, date: Option<&str>) -> Option<WireTime> {
    match (unix, date) {
        (Some(n), _) => Some(WireTime::Unix(n)),
        (None, Some(d)) => Some(WireTime::Date(d.to_string())),
        _ => None,
    }
}

fn time_value(unix: Option<i64>, date: Option<&str>) -> serde_json::Value {
    match wire_time(unix, date) {
        Some(WireTime::Unix(n)) => serde_json::json!(n),
        Some(WireTime::Date(d)) => serde_json::json!(d),
        None => serde_json::Value::Null,
    }
}

/// Form input (`SquadEventInput` in the frontend API).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadEventInput {
    pub title: String,
    pub summary: String,
    pub all_day: bool,
    pub start: String,
    pub end: Option<String>,
    pub start_tzid: String,
    pub place: Place,
    pub location: String,
    pub channel_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadEventRsvpDto {
    pub member_npub: String,
    pub status: RsvpStatus,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadEventDto {
    pub id: String,
    pub parent_id: String,
    pub mls_group_id: String,
    pub series_id: Option<String>,
    pub kind: u16,
    pub title: String,
    pub summary: String,
    pub start_unix: Option<i64>,
    pub end_unix: Option<i64>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub start_tzid: String,
    pub place: Place,
    pub location: String,
    pub channel_id: Option<String>,
    pub status: EventStatus,
    pub author_npub: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub updated_by_npub: String,
    pub rsvps: Vec<SquadEventRsvpDto>,
    pub my_rsvp: Option<RsvpStatus>,
    pub can_edit: bool,
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

fn parse_date(date: &str) -> Result<chrono::NaiveDate, String> {
    chrono::NaiveDate::parse_from_str(date, DATE_FORMAT).map_err(|_| err::INVALID_TIME.to_string())
}

fn trimmed_opt(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn invalid_time<E>(_: E) -> String {
    err::INVALID_TIME.to_string()
}

pub fn validate_fields(f: &EventFields) -> Result<(), String> {
    validate_fields_shape(f)?;
    civil::validate_tzid(&f.start_tzid).map_err(|_| err::INVALID_ZONE.to_string())?;
    match f.kind {
        KIND_TIMED => {
            let start = f.start_unix.ok_or(err::INVALID_TIME)?;
            if f.start_date.is_some() || f.end_date.is_some() {
                return Err(err::INVALID_TIME.into());
            }
            if matches!(f.end_unix, Some(end) if end <= start) {
                return Err(err::INVALID_TIME.into());
            }
        }
        KIND_ALL_DAY => {
            if f.start_unix.is_some() || f.end_unix.is_some() {
                return Err(err::INVALID_TIME.into());
            }
            let start = parse_date(f.start_date.as_deref().ok_or(err::INVALID_TIME)?)?;
            if let Some(end) = f.end_date.as_deref() {
                if parse_date(end)? <= start {
                    return Err(err::INVALID_TIME.into());
                }
            }
        }
        _ => return Err(err::INVALID_TIME.into()),
    }
    Ok(())
}

/// `count` weekly occurrences of the form input; each end keeps its civil offset from its start.
pub fn occurrences(input: &SquadEventInput, count: usize) -> Result<Vec<EventFields>, String> {
    let tzid = input.start_tzid.trim();
    let start = input.start.trim();
    let end = trimmed_opt(input.end.as_deref());
    let template = EventFields {
        kind: if input.all_day {
            KIND_ALL_DAY
        } else {
            KIND_TIMED
        },
        title: input.title.trim().to_string(),
        summary: input.summary.trim().to_string(),
        start_unix: None,
        end_unix: None,
        start_date: None,
        end_date: None,
        start_tzid: tzid.to_string(),
        place: input.place,
        location: input.location.trim().to_string(),
        channel_id: trimmed_opt(input.channel_id.as_deref()),
    };
    validate_fields_shape(&template)?;
    civil::validate_tzid(tzid).map_err(|_| err::INVALID_ZONE.to_string())?;

    let mut out = Vec::with_capacity(count);
    if input.all_day {
        let starts = civil::weekly_all_day_dates(start, count).map_err(invalid_time)?;
        let ends = end
            .map(|e| civil::weekly_all_day_dates(&e, count))
            .transpose()
            .map_err(invalid_time)?;
        for (i, s) in starts.into_iter().enumerate() {
            out.push(EventFields {
                start_date: Some(s),
                end_date: ends.as_ref().map(|e| e[i].clone()),
                ..template.clone()
            });
        }
    } else {
        let timed = |local: &str| match count {
            1 => civil::civil_to_unix(local, tzid).map(|s| vec![s]),
            _ => civil::weekly_timed_starts(local, tzid, count),
        };
        let starts = timed(start).map_err(invalid_time)?;
        let ends = end.map(|e| timed(&e)).transpose().map_err(invalid_time)?;
        for (i, s) in starts.into_iter().enumerate() {
            out.push(EventFields {
                start_unix: Some(s),
                end_unix: ends.as_ref().map(|e| e[i]),
                ..template.clone()
            });
        }
    }
    for f in &out {
        validate_fields(f)?;
    }
    Ok(out)
}

/// Title and place checks that do not depend on the start.
fn validate_fields_shape(f: &EventFields) -> Result<(), String> {
    if f.title.trim().is_empty() {
        return Err(err::INVALID_TITLE.into());
    }
    if f.location.trim().is_empty() {
        return Err(err::INVALID_PLACE.into());
    }
    Ok(())
}

/// Validates one form submission before any send.
pub fn fields_from_input(input: &SquadEventInput) -> Result<EventFields, String> {
    occurrences(input, 1)?
        .pop()
        .ok_or_else(|| err::INVALID_TIME.to_string())
}

/// Ingest bound on peer-set stamps.
fn stamp_acceptable(updated_at_ms: i64, now_ms: i64) -> bool {
    updated_at_ms >= 0 && updated_at_ms <= now_ms.saturating_add(MAX_FUTURE_SKEW_MS)
}

fn fields_from_wire(w: &EventWire) -> Option<EventFields> {
    let kind = w.kind?;
    let (start_unix, end_unix, start_date, end_date) = match kind {
        KIND_TIMED => {
            let WireTime::Unix(start) = w.start.clone()? else {
                return None;
            };
            let end = match &w.end {
                None => None,
                Some(WireTime::Unix(e)) => Some(*e),
                Some(WireTime::Date(_)) => return None,
            };
            (Some(start), end, None, None)
        }
        KIND_ALL_DAY => {
            let WireTime::Date(start) = w.start.clone()? else {
                return None;
            };
            let end = match &w.end {
                None => None,
                Some(WireTime::Date(e)) => Some(e.clone()),
                Some(WireTime::Unix(_)) => return None,
            };
            (None, None, Some(start), end)
        }
        _ => return None,
    };
    let fields = EventFields {
        kind,
        title: w.title.clone()?,
        summary: w.summary.clone().unwrap_or_default(),
        start_unix,
        end_unix,
        start_date,
        end_date,
        start_tzid: w.start_tzid.clone()?,
        place: w.place?,
        location: w.location.clone()?,
        channel_id: trimmed_opt(w.channel_id.as_deref()),
    };
    validate_fields(&fields).ok()?;
    Some(fields)
}

// ---------------------------------------------------------------------------
// Wire builders and card JSON
// ---------------------------------------------------------------------------

fn event_wire(
    op: Op,
    event_id: &str,
    parent_id: &str,
    series_id: Option<&str>,
    f: &EventFields,
    updated_at_ms: i64,
) -> EventWire {
    let mut w = EventWire::base(op, parent_id, updated_at_ms);
    w.id = Some(event_id.to_string());
    w.series_id = series_id.map(str::to_string);
    w.kind = Some(f.kind);
    w.title = Some(f.title.clone());
    w.summary = Some(f.summary.clone());
    w.start = f.start_wire();
    w.end = f.end_wire();
    w.start_tzid = Some(f.start_tzid.clone());
    w.place = Some(f.place);
    w.location = Some(f.location.clone());
    w.channel_id = f.channel_id.clone();
    match op {
        Op::Create => w.rsvp = Some(RsvpStatus::Accepted),
        Op::Cancel => w.status = Some(EventStatus::Cancelled.as_str().to_string()),
        _ => {}
    }
    w
}

fn rsvp_wire(event_id: &str, parent_id: &str, status: RsvpStatus, updated_at_ms: i64) -> EventWire {
    let mut w = EventWire::base(Op::Rsvp, parent_id, updated_at_ms);
    w.id = Some(event_id.to_string());
    w.status = Some(status.as_str().to_string());
    w
}

fn series_card_wire(
    series_id: &str,
    parent_id: &str,
    first: &EventFields,
    count: usize,
    updated_at_ms: i64,
) -> EventWire {
    let mut w = EventWire::base(Op::SeriesCard, parent_id, updated_at_ms);
    w.series_id = Some(series_id.to_string());
    w.kind = Some(first.kind);
    w.title = Some(first.title.clone());
    w.first_start = first.start_wire();
    w.start_tzid = Some(first.start_tzid.clone());
    w.count = u32::try_from(count).ok();
    w.channel_id = first.channel_id.clone();
    w
}

fn parse_wire(content: &str) -> Option<EventWire> {
    let w: EventWire = serde_json::from_str(content).ok()?;
    if w.schema != SCHEMA || w.parent_id.trim().is_empty() {
        return None;
    }
    if w.op != Op::SeriesCard && w.id.as_deref().map_or(true, |id| id.trim().is_empty()) {
        return None;
    }
    Some(w)
}

fn created_card_content(event_id: &str, parent_id: &str, f: &EventFields) -> String {
    serde_json::json!({
        "type": "squad_event_created",
        "payload": {
            "id": event_id,
            "parent_id": parent_id,
            "series_id": serde_json::Value::Null,
            "kind": f.kind,
            "title": f.title,
            "start": f.start_value(),
            "end": f.end_value(),
            "start_tzid": f.start_tzid,
            "channel_id": f.channel_id,
        }
    })
    .to_string()
}

/// Card JSON for a valid `series_card` wire.
fn series_card_content(w: &EventWire) -> Option<String> {
    let series_id = w.series_id.as_deref().filter(|s| !s.trim().is_empty())?;
    let title = w.title.as_deref().filter(|t| !t.trim().is_empty())?;
    let tzid = w.start_tzid.as_deref()?;
    civil::validate_tzid(tzid).ok()?;
    let count = w.count.filter(|c| *c > 0)?;
    let kind = w.kind?;
    let first_start = match (kind, w.first_start.as_ref()?) {
        (KIND_TIMED, WireTime::Unix(n)) => serde_json::json!(n),
        (KIND_ALL_DAY, WireTime::Date(d)) => {
            parse_date(d).ok()?;
            serde_json::json!(d)
        }
        _ => return None,
    };
    Some(
        serde_json::json!({
            "type": "squad_event_series_created",
            "payload": {
                "series_id": series_id,
                "parent_id": w.parent_id,
                "kind": kind,
                "title": title,
                "first_start": first_start,
                "start_tzid": tzid,
                "count": count,
                "channel_id": trimmed_opt(w.channel_id.as_deref()),
            }
        })
        .to_string(),
    )
}

fn content_hash(w: &EventWire, signer_npub: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(serde_json::to_vec(w).unwrap_or_default());
    hasher.update(b"\n");
    hasher.update(signer_npub.as_bytes());
    hex::encode(hasher.finalize())
}

// ---------------------------------------------------------------------------
// Replica (sync, `&Connection`)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq)]
struct EventRow {
    event_id: String,
    parent_id: String,
    mls_group_id: String,
    series_id: Option<String>,
    fields: EventFields,
    status: EventStatus,
    author_npub: String,
    created_at_ms: i64,
    updated_at_ms: i64,
    updated_by_npub: String,
    content_hash: String,
}

const EVENT_COLUMNS: &str = "event_id, parent_id, mls_group_id, series_id, nip52_kind, title, summary, \
     start_unix, end_unix, start_date, end_date, start_tzid, place_kind, location, channel_id, status, \
     author_npub, created_at_ms, updated_at_ms, updated_by_npub, content_hash";

fn bad_column(idx: usize, name: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidColumnType(idx, name.to_string(), rusqlite::types::Type::Text)
}

fn row_from_sql(r: &rusqlite::Row<'_>) -> rusqlite::Result<EventRow> {
    let kind: i64 = r.get(4)?;
    let place: String = r.get(12)?;
    let status: String = r.get(15)?;
    Ok(EventRow {
        event_id: r.get(0)?,
        parent_id: r.get(1)?,
        mls_group_id: r.get(2)?,
        series_id: r.get(3)?,
        fields: EventFields {
            kind: u16::try_from(kind).map_err(|_| bad_column(4, "nip52_kind"))?,
            title: r.get(5)?,
            summary: r.get(6)?,
            start_unix: r.get(7)?,
            end_unix: r.get(8)?,
            start_date: r.get(9)?,
            end_date: r.get(10)?,
            start_tzid: r.get(11)?,
            place: Place::parse(&place).ok_or_else(|| bad_column(12, "place_kind"))?,
            location: r.get(13)?,
            channel_id: r.get(14)?,
        },
        status: EventStatus::parse(&status).ok_or_else(|| bad_column(15, "status"))?,
        author_npub: r.get(16)?,
        created_at_ms: r.get(17)?,
        updated_at_ms: r.get(18)?,
        updated_by_npub: r.get(19)?,
        content_hash: r.get(20)?,
    })
}

fn load_row(conn: &Connection, event_id: &str) -> Result<Option<EventRow>, String> {
    conn.query_row(
        &format!("SELECT {EVENT_COLUMNS} FROM squad_events WHERE event_id = ?1"),
        params![event_id],
        row_from_sql,
    )
    .optional()
    .map_err(|e| format!("Failed to load squad event: {}", e))
}

/// Rumor identity for one op.
#[derive(Clone, Copy, Debug)]
pub struct OpMeta<'a> {
    pub rumor_id: &'a str,
    pub mls_group_id: &'a str,
    pub signer_npub: &'a str,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Applied {
    /// Replica row or RSVP changed.
    Changed {
        inserted: bool,
    },
    /// Same write already stored.
    Replay,
    /// Child op kept until its create lands.
    Queued,
    /// Authorized series summary (no row).
    SeriesCard,
    Ignored,
}

impl Applied {
    fn changed(&self) -> bool {
        matches!(self, Applied::Changed { .. })
    }
}

fn may_create(conn: &Connection, parent_id: &str, role: SquadGroupRole) -> Result<bool, String> {
    if !role.is_member {
        return Ok(false);
    }
    if role.is_admin {
        return Ok(true);
    }
    Ok(!crate::squad_content_policy::load_policy(conn, parent_id)?.restrict_event_create)
}

/// Applies one op from `meta.signer_npub` whose role in `meta.mls_group_id` is `role`.
/// Only the parent's own announcements group may write its records.
/// Does not drain queued children; see [`drain_pending`].
pub fn apply_op(
    conn: &Connection,
    w: &EventWire,
    meta: &OpMeta<'_>,
    role: SquadGroupRole,
    now_ms: i64,
) -> Result<Applied, String> {
    if !role.is_member
        || !crate::db::side_effect_parent_matches_chat(meta.mls_group_id, &w.parent_id)
    {
        return Ok(Applied::Ignored);
    }
    if w.op == Op::SeriesCard {
        let ok = series_card_content(w).is_some() && may_create(conn, &w.parent_id, role)?;
        return Ok(if ok {
            Applied::SeriesCard
        } else {
            Applied::Ignored
        });
    }
    let Some(event_id) = w.id.as_deref() else {
        return Ok(Applied::Ignored);
    };
    let row = load_row(conn, event_id)?;
    match w.op {
        Op::Create => {
            let Some(fields) = fields_from_wire(w) else {
                return Ok(Applied::Ignored);
            };
            match row {
                Some(row) if row.series_id == w.series_id => {
                    apply_write(conn, &row, w, fields, meta, role)
                }
                Some(_) => Ok(Applied::Ignored),
                None => insert_create(conn, event_id, w, fields, meta, role),
            }
        }
        Op::Update | Op::Cancel => {
            let Some(fields) = fields_from_wire(w) else {
                return Ok(Applied::Ignored);
            };
            if w.op == Op::Cancel && w.status.as_deref() != Some(EventStatus::Cancelled.as_str()) {
                return Ok(Applied::Ignored);
            }
            match row {
                Some(row) => apply_write(conn, &row, w, fields, meta, role),
                None => queue(conn, event_id, w, meta, now_ms),
            }
        }
        Op::Rsvp => {
            let Some(status) = w.status.as_deref().and_then(RsvpStatus::parse) else {
                return Ok(Applied::Ignored);
            };
            match row {
                Some(row) => {
                    if row.mls_group_id != meta.mls_group_id || row.parent_id != w.parent_id {
                        return Ok(Applied::Ignored);
                    }
                    upsert_rsvp(
                        conn,
                        event_id,
                        meta.signer_npub,
                        status,
                        w.updated_at_ms,
                        meta.rumor_id,
                    )
                }
                None => queue(conn, event_id, w, meta, now_ms),
            }
        }
        Op::SeriesCard => Ok(Applied::Ignored),
    }
}

fn insert_create(
    conn: &Connection,
    event_id: &str,
    w: &EventWire,
    f: EventFields,
    meta: &OpMeta<'_>,
    role: SquadGroupRole,
) -> Result<Applied, String> {
    if !may_create(conn, &w.parent_id, role)? {
        return Ok(Applied::Ignored);
    }
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to begin squad event insert: {}", e))?;
    tx.execute(
        "INSERT INTO squad_events (event_id, parent_id, mls_group_id, series_id, nip52_kind, title, summary,
            start_unix, end_unix, start_date, end_date, start_tzid, place_kind, location, channel_id, status,
            author_npub, created_at_ms, updated_at_ms, updated_by_npub, content_hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 'active', ?16, ?17, ?17, ?16, ?18)",
        params![
            event_id,
            w.parent_id,
            meta.mls_group_id,
            w.series_id,
            f.kind,
            f.title,
            f.summary,
            f.start_unix,
            f.end_unix,
            f.start_date,
            f.end_date,
            f.start_tzid,
            f.place.as_str(),
            f.location,
            f.channel_id,
            meta.signer_npub,
            w.updated_at_ms,
            content_hash(w, meta.signer_npub),
        ],
    )
    .map_err(|e| format!("Failed to insert squad event: {}", e))?;
    if let Some(status) = w.rsvp {
        upsert_rsvp(
            &tx,
            event_id,
            meta.signer_npub,
            status,
            w.updated_at_ms,
            meta.rumor_id,
        )?;
    }
    tx.commit()
        .map_err(|e| format!("Failed to commit squad event insert: {}", e))?;
    Ok(Applied::Changed { inserted: true })
}

/// Field write (create replay, update, cancel) against a stored row. Fields: newest wins; cancel: sticky.
fn apply_write(
    conn: &Connection,
    row: &EventRow,
    w: &EventWire,
    f: EventFields,
    meta: &OpMeta<'_>,
    role: SquadGroupRole,
) -> Result<Applied, String> {
    if row.mls_group_id != meta.mls_group_id || row.parent_id != w.parent_id {
        return Ok(Applied::Ignored);
    }
    if !(role.is_member && (meta.signer_npub == row.author_npub || role.is_admin)) {
        return Ok(Applied::Ignored);
    }
    let hash = content_hash(w, meta.signer_npub);
    if hash == row.content_hash {
        return Ok(Applied::Replay);
    }
    let newer = w.updated_at_ms > row.updated_at_ms;
    let cancels = w.op == Op::Cancel && row.status != EventStatus::Cancelled;
    if newer {
        conn.execute(
            "UPDATE squad_events SET nip52_kind = ?2, title = ?3, summary = ?4, start_unix = ?5, end_unix = ?6,
                start_date = ?7, end_date = ?8, start_tzid = ?9, place_kind = ?10, location = ?11, channel_id = ?12,
                updated_at_ms = ?13, updated_by_npub = ?14, content_hash = ?15
             WHERE event_id = ?1",
            params![
                row.event_id,
                f.kind,
                f.title,
                f.summary,
                f.start_unix,
                f.end_unix,
                f.start_date,
                f.end_date,
                f.start_tzid,
                f.place.as_str(),
                f.location,
                f.channel_id,
                w.updated_at_ms,
                meta.signer_npub,
                hash,
            ],
        )
        .map_err(|e| format!("Failed to update squad event: {}", e))?;
    }
    if cancels {
        conn.execute(
            "UPDATE squad_events SET status = 'cancelled' WHERE event_id = ?1",
            params![row.event_id],
        )
        .map_err(|e| format!("Failed to cancel squad event: {}", e))?;
    }
    Ok(if newer || cancels {
        Applied::Changed { inserted: false }
    } else {
        Applied::Ignored
    })
}

fn upsert_rsvp(
    conn: &Connection,
    event_id: &str,
    member_npub: &str,
    status: RsvpStatus,
    updated_at_ms: i64,
    rumor_id: &str,
) -> Result<Applied, String> {
    let stored: Option<(i64, String)> = conn
        .query_row(
            "SELECT updated_at_ms, rumor_id FROM squad_event_rsvps WHERE event_id = ?1 AND member_npub = ?2",
            params![event_id, member_npub],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| format!("Failed to load squad event rsvp: {}", e))?;
    if let Some((stored_ms, stored_rumor)) = stored {
        if stored_rumor == rumor_id {
            return Ok(Applied::Replay);
        }
        if updated_at_ms <= stored_ms {
            return Ok(Applied::Ignored);
        }
    }
    conn.execute(
        "INSERT INTO squad_event_rsvps (event_id, member_npub, status, updated_at_ms, rumor_id)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(event_id, member_npub) DO UPDATE SET
            status = excluded.status, updated_at_ms = excluded.updated_at_ms, rumor_id = excluded.rumor_id",
        params![event_id, member_npub, status.as_str(), updated_at_ms, rumor_id],
    )
    .map_err(|e| format!("Failed to store squad event rsvp: {}", e))?;
    Ok(Applied::Changed { inserted: false })
}

fn queue(
    conn: &Connection,
    event_id: &str,
    w: &EventWire,
    meta: &OpMeta<'_>,
    now_ms: i64,
) -> Result<Applied, String> {
    purge_expired_pending(conn, now_ms)?;
    let payload = serde_json::to_string(w).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO squad_event_pending_ops
            (rumor_id, event_id, parent_id, mls_group_id, author_npub, op, payload_json, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            meta.rumor_id,
            event_id,
            w.parent_id,
            meta.mls_group_id,
            meta.signer_npub,
            w.op.as_str(),
            payload,
            w.updated_at_ms,
        ],
    )
    .map_err(|e| format!("Failed to queue squad event op: {}", e))?;
    conn.execute(
        "DELETE FROM squad_event_pending_ops
         WHERE parent_id = ?1 AND author_npub = ?2 AND rumor_id NOT IN (
            SELECT rumor_id FROM squad_event_pending_ops
            WHERE parent_id = ?1 AND author_npub = ?2
            ORDER BY updated_at_ms DESC, rumor_id DESC LIMIT ?3)",
        params![w.parent_id, meta.signer_npub, MAX_PENDING_PER_AUTHOR],
    )
    .map_err(|e| format!("Failed to trim squad event ops: {}", e))?;
    Ok(Applied::Queued)
}

fn purge_expired_pending(conn: &Connection, now_ms: i64) -> Result<(), String> {
    conn.execute(
        "DELETE FROM squad_event_pending_ops WHERE updated_at_ms < ?1",
        params![now_ms.saturating_sub(PENDING_TTL_MS)],
    )
    .map_err(|e| format!("Failed to purge squad event ops: {}", e))?;
    Ok(())
}

/// Group id of the stored event and the distinct authors of its queued children (`None` when not stored).
fn pending_for_stored(
    conn: &Connection,
    event_id: &str,
) -> Result<Option<(String, Vec<String>)>, String> {
    let Some(row) = load_row(conn, event_id)? else {
        return Ok(None);
    };
    let mut stmt = conn
        .prepare("SELECT DISTINCT author_npub FROM squad_event_pending_ops WHERE event_id = ?1")
        .map_err(|e| e.to_string())?;
    let authors = stmt
        .query_map(params![event_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(Some((row.mls_group_id, authors)))
}

/// Applies queued children of a stored event in `updated_at_ms` order, re-checking each author's role.
/// Returns whether the replica changed.
pub fn drain_pending(
    conn: &Connection,
    event_id: &str,
    role_of: &dyn Fn(&str) -> SquadGroupRole,
    now_ms: i64,
) -> Result<bool, String> {
    purge_expired_pending(conn, now_ms)?;
    if load_row(conn, event_id)?.is_none() {
        return Ok(false);
    }
    let pending: Vec<(String, String, String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT rumor_id, mls_group_id, author_npub, payload_json FROM squad_event_pending_ops
                 WHERE event_id = ?1 ORDER BY updated_at_ms ASC, rumor_id ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![event_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    let mut changed = false;
    for (rumor_id, mls_group_id, author, payload) in pending {
        if let Some(w) = parse_wire(&payload).filter(|w| w.id.as_deref() == Some(event_id)) {
            let meta = OpMeta {
                rumor_id: &rumor_id,
                mls_group_id: &mls_group_id,
                signer_npub: &author,
            };
            changed |= apply_op(conn, &w, &meta, role_of(&author), now_ms)?.changed();
        }
        conn.execute(
            "DELETE FROM squad_event_pending_ops WHERE rumor_id = ?1",
            params![rumor_id],
        )
        .map_err(|e| format!("Failed to clear squad event op: {}", e))?;
    }
    Ok(changed)
}

/// Announcements card content for an applied op: a single create or a series summary.
fn card_content(w: &EventWire, applied: &Applied) -> Option<String> {
    match (w.op, applied) {
        (Op::Create, Applied::Changed { inserted: true } | Applied::Replay)
            if w.series_id.is_none() =>
        {
            let fields = fields_from_wire(w)?;
            Some(created_card_content(
                w.id.as_deref()?,
                &w.parent_id,
                &fields,
            ))
        }
        (Op::SeriesCard, Applied::SeriesCard) => series_card_content(w),
        _ => None,
    }
}

/// Replica rows for one parent, with RSVPs. `can_edit` reflects authorship only; callers add admin.
fn load_events(
    conn: &Connection,
    parent_id: &str,
    caller_npub: &str,
) -> Result<Vec<SquadEventDto>, String> {
    let mut rsvps: HashMap<String, Vec<SquadEventRsvpDto>> = HashMap::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT r.event_id, r.member_npub, r.status, r.updated_at_ms
                 FROM squad_event_rsvps r JOIN squad_events e ON e.event_id = r.event_id
                 WHERE e.parent_id = ?1 ORDER BY r.updated_at_ms ASC, r.member_npub ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![parent_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (event_id, member_npub, status, updated_at_ms) = row.map_err(|e| e.to_string())?;
            let Some(status) = RsvpStatus::parse(&status) else {
                continue;
            };
            rsvps.entry(event_id).or_default().push(SquadEventRsvpDto {
                member_npub,
                status,
                updated_at_ms,
            });
        }
    }

    let mut stmt = conn
        .prepare(&format!(
            "SELECT {EVENT_COLUMNS} FROM squad_events WHERE parent_id = ?1 ORDER BY created_at_ms ASC, event_id ASC"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![parent_id], row_from_sql)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to list squad events: {}", e))?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let rsvps = rsvps.remove(&row.event_id).unwrap_or_default();
            let my_rsvp = rsvps
                .iter()
                .find(|r| r.member_npub == caller_npub)
                .map(|r| r.status);
            let f = row.fields;
            SquadEventDto {
                can_edit: row.author_npub == caller_npub,
                id: row.event_id,
                parent_id: row.parent_id,
                mls_group_id: row.mls_group_id,
                series_id: row.series_id,
                kind: f.kind,
                title: f.title,
                summary: f.summary,
                start_unix: f.start_unix,
                end_unix: f.end_unix,
                start_date: f.start_date,
                end_date: f.end_date,
                start_tzid: f.start_tzid,
                place: f.place,
                location: f.location,
                channel_id: f.channel_id,
                status: row.status,
                author_npub: row.author_npub,
                created_at_ms: row.created_at_ms,
                updated_at_ms: row.updated_at_ms,
                updated_by_npub: row.updated_by_npub,
                rsvps,
                my_rsvp,
            }
        })
        .collect())
}

fn my_rsvp_updated_at(
    conn: &Connection,
    event_id: &str,
    npub: &str,
) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT updated_at_ms FROM squad_event_rsvps WHERE event_id = ?1 AND member_npub = ?2",
        params![event_id, npub],
        |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Async glue: DB access, roles, ingest, sends
// ---------------------------------------------------------------------------

fn emit_replica_updated(parent_id: &str, event_id: Option<&str>) {
    if let Some(handle) = TAURI_APP.get() {
        let _ = handle.emit(
            REPLICA_UPDATED_EVENT,
            serde_json::json!({ "parentId": parent_id, "eventId": event_id }),
        );
    }
}

/// Drains queued children of a stored event after resolving their authors' roles.
async fn drain_stored<R: Runtime>(handle: &AppHandle<R>, event_id: &str) -> Result<bool, String> {
    let Some((group_id, authors)) = with_conn(handle, |c| pending_for_stored(c, event_id))? else {
        return Ok(false);
    };
    if authors.is_empty() {
        return Ok(false);
    }
    let mut roles = HashMap::with_capacity(authors.len());
    for author in authors {
        let role = squad_records::group_role(handle, &group_id, &author).await;
        roles.insert(author, role);
    }
    with_conn(handle, |c| {
        drain_pending(
            c,
            event_id,
            &|npub| roles.get(npub).copied().unwrap_or_default(),
            now_ms(),
        )
    })
}

/// Same apply path for ingest and local sends; emits on any replica change.
async fn apply_and_emit<R: Runtime>(
    handle: &AppHandle<R>,
    w: &EventWire,
    meta: OpMeta<'_>,
    role: SquadGroupRole,
) -> Result<Applied, String> {
    let applied = with_conn(handle, |c| apply_op(c, w, &meta, role, now_ms()))?;
    let drained = match w.id.as_deref() {
        Some(id) if !matches!(applied, Applied::Queued | Applied::Ignored) => {
            drain_stored(handle, id).await?
        }
        _ => false,
    };
    if applied.changed() || drained {
        emit_replica_updated(&w.parent_id, w.id.as_deref());
    }
    Ok(applied)
}

/// MLS ingest for `d` = `pacto_squad_event`. Never yields a chat row except the announcements card.
pub async fn process_rumor(
    rumor: RumorEvent,
    context: RumorContext,
) -> Result<RumorProcessingResult, String> {
    if context.conversation_type != ConversationType::MlsGroup {
        return Ok(RumorProcessingResult::SquadRecordSilent);
    }
    let Some(w) = parse_wire(&rumor.content) else {
        return Ok(RumorProcessingResult::SquadRecordSilent);
    };
    let group_id = context.conversation_id.as_str();
    if !crate::db::side_effect_parent_matches_chat(group_id, &w.parent_id)
        || !stamp_acceptable(w.updated_at_ms, now_ms())
    {
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
    let rumor_id = rumor.id.to_hex();
    let meta = OpMeta {
        rumor_id: &rumor_id,
        mls_group_id: group_id,
        signer_npub: &signer,
    };
    let applied = apply_and_emit(handle, &w, meta, role).await?;
    let Some(content) = card_content(&w, &applied) else {
        return Ok(RumorProcessingResult::SquadRecordSilent);
    };
    let at = crate::rumor::extract_millisecond_timestamp(&rumor);
    Ok(RumorProcessingResult::SquadRecordCard(card_message(
        rumor_id,
        content,
        at,
        context.is_mine,
        signer,
    )))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn require_id(value: &str, what: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{what} required"));
    }
    Ok(())
}

/// Squad records are written only through the parent's announcements group.
fn ensure_announcements_group(mls_group_id: &str, parent_id: &str) -> Result<(), String> {
    if crate::db::side_effect_parent_matches_chat(mls_group_id, parent_id) {
        Ok(())
    } else {
        Err(err::WRONG_GROUP.into())
    }
}

fn ensure_may_create(
    conn: &Connection,
    parent_id: &str,
    role: SquadGroupRole,
) -> Result<(), String> {
    if !role.is_member {
        return Err(err::NOT_MEMBER.into());
    }
    if !may_create(conn, parent_id, role)? {
        return Err(err::CREATE_RESTRICTED.into());
    }
    Ok(())
}

/// Stored row of this parent (`squad_event_not_found` otherwise).
fn row_in_parent(
    conn: &Connection,
    mls_group_id: &str,
    parent_id: &str,
    event_id: &str,
) -> Result<EventRow, String> {
    load_row(conn, event_id)?
        .filter(|row| row.parent_id == parent_id && row.mls_group_id == mls_group_id)
        .ok_or_else(|| err::NOT_FOUND.to_string())
}

/// Stored row the caller may edit or cancel.
fn editable_row(
    conn: &Connection,
    mls_group_id: &str,
    parent_id: &str,
    event_id: &str,
    npub: &str,
    role: SquadGroupRole,
) -> Result<EventRow, String> {
    if !role.is_member {
        return Err(err::NOT_MEMBER.into());
    }
    let row = row_in_parent(conn, mls_group_id, parent_id, event_id)?;
    if row.author_npub != npub && !role.is_admin {
        return Err(err::NOT_EDITABLE.into());
    }
    Ok(row)
}

/// Series ids must be exactly the weekly count, non-empty, and distinct.
fn validate_series_ids(series_id: &str, event_ids: &[String]) -> Result<(), String> {
    let invalid = || err::INVALID_SERIES.to_string();
    if series_id.trim().is_empty() || event_ids.len() != WEEKLY_SERIES_COUNT {
        return Err(invalid());
    }
    let mut seen = std::collections::HashSet::with_capacity(event_ids.len());
    for id in event_ids {
        if id.trim().is_empty() || !seen.insert(id.as_str()) {
            return Err(invalid());
        }
    }
    Ok(())
}

async fn send_wire(
    mls_group_id: &str,
    parent_id: &str,
    pk: PublicKey,
    w: &EventWire,
    card: bool,
) -> Result<String, String> {
    let content = serde_json::to_string(w).map_err(|e| e.to_string())?;
    let at_ms = u64::try_from(w.updated_at_ms).unwrap_or(0);
    let mut builder = EventBuilder::new(Kind::ApplicationSpecificData, &content)
        .tag(nostr_tags::d_tag([SQUAD_EVENT_D_TAG]))
        .tag(nostr_tags::custom_tag("parent", [parent_id]))
        .tag(nostr_tags::custom_tag("ms", [(at_ms % 1000).to_string()]))
        .custom_created_at(Timestamp::from_secs(at_ms / 1000));
    if card {
        builder = builder.tag(nostr_tags::custom_tag("pacto_bucket", ["announcements"]));
    }
    let built = builder.build(pk);
    let rumor_id = built
        .id
        .ok_or_else(|| "squad event rumor id missing".to_string())?
        .to_hex();
    crate::mls::send_mls_message(mls_group_id, built, None).await?;
    Ok(rumor_id)
}

#[tauri::command]
pub async fn list_squad_events<R: Runtime>(
    handle: AppHandle<R>,
    parent_id: String,
) -> Result<Vec<SquadEventDto>, String> {
    let caller = crate::account_manager::get_current_account()?;
    let mut events = with_conn(&handle, |c| load_events(c, &parent_id, &caller))?;
    let mut admin_of: HashMap<String, bool> = HashMap::new();
    for ev in events.iter_mut().filter(|ev| !ev.can_edit) {
        let is_admin = match admin_of.get(&ev.mls_group_id) {
            Some(is_admin) => *is_admin,
            None => {
                let is_admin = squad_records::group_role(&handle, &ev.mls_group_id, &caller)
                    .await
                    .is_admin;
                admin_of.insert(ev.mls_group_id.clone(), is_admin);
                is_admin
            }
        };
        ev.can_edit = is_admin;
    }
    Ok(events)
}

#[tauri::command]
pub async fn send_squad_event_create<R: Runtime>(
    handle: AppHandle<R>,
    mls_group_id: String,
    parent_id: String,
    event_id: String,
    event: SquadEventInput,
) -> Result<(), String> {
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
    ensure_announcements_group(&mls_group_id, &parent_id)?;
    require_id(&event_id, "Event id")?;
    let fields = fields_from_input(&event)?;
    let (pk, npub) = signer_identity().await?;
    let role = squad_records::group_role(&handle, &mls_group_id, &npub).await;
    let existing = with_conn(&handle, |c| {
        ensure_may_create(c, &parent_id, role)?;
        load_row(c, &event_id)
    })?;
    if let Some(row) = existing {
        // Retry after a send that already landed.
        if row.author_npub == npub && row.series_id.is_none() && row.parent_id == parent_id {
            return Ok(());
        }
        return Err("Event id already in use".into());
    }

    let w = event_wire(Op::Create, &event_id, &parent_id, None, &fields, now_ms());
    let rumor_id = send_wire(&mls_group_id, &parent_id, pk, &w, true).await?;
    let meta = OpMeta {
        rumor_id: &rumor_id,
        mls_group_id: &mls_group_id,
        signer_npub: &npub,
    };
    apply_and_emit(&handle, &w, meta, role).await?;
    let content = created_card_content(&event_id, &parent_id, &fields);
    let at = u64::try_from(w.updated_at_ms).unwrap_or(0);
    store_local_card(
        &handle,
        &mls_group_id,
        card_message(rumor_id, content, at, true, npub),
    )
    .await;
    Ok(())
}

#[tauri::command]
pub async fn send_squad_event_series<R: Runtime>(
    handle: AppHandle<R>,
    mls_group_id: String,
    parent_id: String,
    series_id: String,
    event_ids: Vec<String>,
    event: SquadEventInput,
) -> Result<(), String> {
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
    ensure_announcements_group(&mls_group_id, &parent_id)?;
    validate_series_ids(&series_id, &event_ids)?;
    let occurrences = occurrences(&event, WEEKLY_SERIES_COUNT)?;
    let (pk, npub) = signer_identity().await?;
    let role = squad_records::group_role(&handle, &mls_group_id, &npub).await;
    let existing = with_conn(&handle, |c| {
        ensure_may_create(c, &parent_id, role)?;
        event_ids
            .iter()
            .map(|id| load_row(c, id))
            .collect::<Result<Vec<_>, _>>()
    })?;

    let mut sent = 0usize;
    for ((event_id, fields), row) in event_ids.iter().zip(&occurrences).zip(existing) {
        if let Some(row) = row {
            // Retry: occurrence already sent with this series.
            if row.series_id.as_deref() == Some(series_id.as_str())
                && row.author_npub == npub
                && row.parent_id == parent_id
            {
                continue;
            }
            return Err("Event id already in use".into());
        }
        let w = event_wire(
            Op::Create,
            event_id,
            &parent_id,
            Some(&series_id),
            fields,
            now_ms(),
        );
        let rumor_id = send_wire(&mls_group_id, &parent_id, pk, &w, false).await?;
        let meta = OpMeta {
            rumor_id: &rumor_id,
            mls_group_id: &mls_group_id,
            signer_npub: &npub,
        };
        apply_and_emit(&handle, &w, meta, role).await?;
        sent += 1;
    }

    let card = series_card_wire(
        &series_id,
        &parent_id,
        &occurrences[0],
        WEEKLY_SERIES_COUNT,
        now_ms(),
    );
    let content = series_card_content(&card).ok_or("Invalid series card")?;
    let rumor_id = send_wire(&mls_group_id, &parent_id, pk, &card, true).await?;
    let at = u64::try_from(card.updated_at_ms).unwrap_or(0);
    store_local_card(
        &handle,
        &mls_group_id,
        card_message(rumor_id, content, at, true, npub),
    )
    .await;
    log::info!("[squad_event] series sent: {sent} new occurrences");
    Ok(())
}

#[tauri::command]
pub async fn send_squad_event_update<R: Runtime>(
    handle: AppHandle<R>,
    mls_group_id: String,
    parent_id: String,
    event_id: String,
    event: SquadEventInput,
) -> Result<(), String> {
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
    ensure_announcements_group(&mls_group_id, &parent_id)?;
    let fields = fields_from_input(&event)?;
    let (pk, npub) = signer_identity().await?;
    let role = squad_records::group_role(&handle, &mls_group_id, &npub).await;
    let row = with_conn(&handle, |c| {
        editable_row(c, &mls_group_id, &parent_id, &event_id, &npub, role)
    })?;
    if row.status == EventStatus::Cancelled {
        return Err(err::NOT_EDITABLE.into());
    }
    let stamp = now_ms().max(row.updated_at_ms.saturating_add(1));
    let w = event_wire(
        Op::Update,
        &event_id,
        &parent_id,
        row.series_id.as_deref(),
        &fields,
        stamp,
    );
    let rumor_id = send_wire(&mls_group_id, &parent_id, pk, &w, false).await?;
    let meta = OpMeta {
        rumor_id: &rumor_id,
        mls_group_id: &mls_group_id,
        signer_npub: &npub,
    };
    apply_and_emit(&handle, &w, meta, role).await?;
    Ok(())
}

#[tauri::command]
pub async fn send_squad_event_cancel<R: Runtime>(
    handle: AppHandle<R>,
    mls_group_id: String,
    parent_id: String,
    event_id: String,
) -> Result<(), String> {
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
    ensure_announcements_group(&mls_group_id, &parent_id)?;
    let (pk, npub) = signer_identity().await?;
    let role = squad_records::group_role(&handle, &mls_group_id, &npub).await;
    let row = with_conn(&handle, |c| {
        editable_row(c, &mls_group_id, &parent_id, &event_id, &npub, role)
    })?;
    if row.status == EventStatus::Cancelled {
        return Ok(());
    }
    let stamp = now_ms().max(row.updated_at_ms.saturating_add(1));
    let w = event_wire(
        Op::Cancel,
        &event_id,
        &parent_id,
        row.series_id.as_deref(),
        &row.fields,
        stamp,
    );
    let rumor_id = send_wire(&mls_group_id, &parent_id, pk, &w, false).await?;
    let meta = OpMeta {
        rumor_id: &rumor_id,
        mls_group_id: &mls_group_id,
        signer_npub: &npub,
    };
    apply_and_emit(&handle, &w, meta, role).await?;
    Ok(())
}

#[tauri::command]
pub async fn send_squad_event_rsvp<R: Runtime>(
    handle: AppHandle<R>,
    mls_group_id: String,
    parent_id: String,
    event_id: String,
    status: RsvpStatus,
) -> Result<(), String> {
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
    ensure_announcements_group(&mls_group_id, &parent_id)?;
    let (pk, npub) = signer_identity().await?;
    let role = squad_records::group_role(&handle, &mls_group_id, &npub).await;
    if !role.is_member {
        return Err(err::NOT_MEMBER.into());
    }
    let previous = with_conn(&handle, |c| {
        row_in_parent(c, &mls_group_id, &parent_id, &event_id)?;
        my_rsvp_updated_at(c, &event_id, &npub)
    })?;
    let stamp = previous.map_or_else(now_ms, |prev| now_ms().max(prev.saturating_add(1)));
    let w = rsvp_wire(&event_id, &parent_id, status, stamp);
    let rumor_id = send_wire(&mls_group_id, &parent_id, pk, &w, false).await?;
    let meta = OpMeta {
        rumor_id: &rumor_id,
        mls_group_id: &mls_group_id,
        signer_npub: &npub,
    };
    apply_and_emit(&handle, &w, meta, role).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A parent's id is its announcements MLS group id.
    const PARENT: &str = "squad-1";
    const GROUP: &str = PARENT;
    const NOW: i64 = 10_000;
    const NY: &str = "America/New_York";
    const ALICE: &str = "npub1alice";
    const BOB: &str = "npub1bob";
    const CAROL: &str = "npub1carol";
    const ADMIN: &str = "npub1admin";
    const OUTSIDER: &str = "npub1outsider";
    const SECRET_LOCATION: &str = "42 Secret Lane";

    fn conn() -> Connection {
        let mut conn = Connection::open_in_memory().expect("in-memory db");
        crate::migrations::run_migrations(&mut conn).expect("migrations");
        conn
    }

    fn role_of(npub: &str) -> SquadGroupRole {
        match npub {
            ADMIN => SquadGroupRole {
                is_member: true,
                is_admin: true,
            },
            OUTSIDER => SquadGroupRole::default(),
            _ => SquadGroupRole {
                is_member: true,
                is_admin: false,
            },
        }
    }

    fn input(start: &str, end: Option<&str>) -> SquadEventInput {
        SquadEventInput {
            title: "Standup".into(),
            summary: "Weekly sync".into(),
            all_day: false,
            start: start.into(),
            end: end.map(str::to_string),
            start_tzid: NY.into(),
            place: Place::Offline,
            location: SECRET_LOCATION.into(),
            channel_id: Some("general".into()),
        }
    }

    fn fields(start: &str) -> EventFields {
        fields_from_input(&input(start, None)).expect("valid input")
    }

    /// Ingest one op (apply + drain), returning the outcome and any card content.
    fn ingest(
        conn: &Connection,
        w: &EventWire,
        rumor_id: &str,
        signer: &str,
    ) -> (Applied, Option<String>) {
        let meta = OpMeta {
            rumor_id,
            mls_group_id: GROUP,
            signer_npub: signer,
        };
        let applied = apply_op(conn, w, &meta, role_of(signer), NOW).expect("apply");
        if let Some(id) = w.id.as_deref() {
            drain_pending(conn, id, &role_of, NOW).expect("drain");
        }
        let card = card_content(w, &applied);
        (applied, card)
    }

    fn create(id: &str, f: &EventFields, ts: i64) -> EventWire {
        event_wire(Op::Create, id, PARENT, None, f, ts)
    }

    fn update(id: &str, f: &EventFields, ts: i64) -> EventWire {
        event_wire(Op::Update, id, PARENT, None, f, ts)
    }

    fn row(conn: &Connection, id: &str) -> EventRow {
        load_row(conn, id).expect("load").expect("row exists")
    }

    fn rsvp_of(conn: &Connection, id: &str, npub: &str) -> Option<RsvpStatus> {
        load_events(conn, PARENT, npub)
            .expect("list")
            .into_iter()
            .find(|e| e.id == id)
            .and_then(|e| e.my_rsvp)
    }

    fn count_rows(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .expect("count")
    }

    fn restrict_create(conn: &Connection) {
        conn.execute(
            "INSERT INTO squad_content_policy (parent_id, restrict_event_create, restrict_event_create_updated_at_ms, restrict_event_create_by_npub)
             VALUES (?1, 1, 1, ?2)",
            params![PARENT, ADMIN],
        )
        .expect("policy");
    }

    /// Mirrors the series send: eight silent creates plus one card wire.
    fn series(series_id: &str, ids: &[String]) -> (Vec<EventWire>, EventWire) {
        let occ = occurrences(
            &input("2026-03-01T09:00", Some("2026-03-01T10:00")),
            WEEKLY_SERIES_COUNT,
        )
        .expect("occurrences");
        let creates = ids
            .iter()
            .zip(&occ)
            .enumerate()
            .map(|(i, (id, f))| {
                event_wire(Op::Create, id, PARENT, Some(series_id), f, 100 + i as i64)
            })
            .collect();
        (
            creates,
            series_card_wire(series_id, PARENT, &occ[0], WEEKLY_SERIES_COUNT, 200),
        )
    }

    fn series_ids() -> Vec<String> {
        (1..=WEEKLY_SERIES_COUNT)
            .map(|i| format!("ev-{i}"))
            .collect()
    }

    #[test]
    fn create_ingest_stores_row_and_card_without_location() {
        let conn = conn();
        let f = fields("2026-01-15T09:00");
        let w = create("ev-1", &f, 1_000);
        let (applied, card) = ingest(&conn, &w, "r1", ALICE);
        assert_eq!(applied, Applied::Changed { inserted: true });

        let stored = row(&conn, "ev-1");
        assert_eq!(stored.fields.location, SECRET_LOCATION);
        assert_eq!(stored.author_npub, ALICE);
        assert_eq!(stored.status, EventStatus::Active);

        let card = card.expect("one card");
        assert!(!card.contains(SECRET_LOCATION));
        assert!(!card.contains("location"));
        assert!(!card.contains("place"));
        let json: serde_json::Value = serde_json::from_str(&card).unwrap();
        assert_eq!(json["type"], "squad_event_created");
        assert_eq!(json["payload"]["id"], "ev-1");
        assert_eq!(json["payload"]["kind"], KIND_TIMED);
        assert_eq!(json["payload"]["start"], f.start_unix.unwrap());
        assert_eq!(json["payload"]["start_tzid"], NY);
        assert!(json["payload"]["series_id"].is_null());

        // Replay is idempotent and yields the same card (deduped by message id downstream).
        let (replay, replay_card) = ingest(&conn, &w, "r1", ALICE);
        assert_eq!(replay, Applied::Replay);
        assert_eq!(replay_card.as_deref(), Some(card.as_str()));
        assert_eq!(count_rows(&conn, "squad_events"), 1);
    }

    #[test]
    fn author_create_leaves_accepted_rsvp() {
        let conn = conn();
        ingest(
            &conn,
            &create("ev-1", &fields("2026-01-15T09:00"), 1_000),
            "r1",
            ALICE,
        );
        assert_eq!(rsvp_of(&conn, "ev-1", ALICE), Some(RsvpStatus::Accepted));
    }

    #[test]
    fn rsvp_before_create_is_applied_when_create_arrives() {
        let conn = conn();
        let early = rsvp_wire("ev-1", PARENT, RsvpStatus::Tentative, 2_000);
        let (applied, card) = ingest(&conn, &early, "r-rsvp", BOB);
        assert_eq!(applied, Applied::Queued);
        assert!(card.is_none());
        assert_eq!(count_rows(&conn, "squad_event_pending_ops"), 1);

        ingest(
            &conn,
            &create("ev-1", &fields("2026-01-15T09:00"), 1_000),
            "r1",
            ALICE,
        );
        assert_eq!(rsvp_of(&conn, "ev-1", BOB), Some(RsvpStatus::Tentative));
        assert_eq!(count_rows(&conn, "squad_event_pending_ops"), 0);
    }

    #[test]
    fn later_rsvp_replaces_and_older_does_not() {
        let conn = conn();
        ingest(
            &conn,
            &create("ev-1", &fields("2026-01-15T09:00"), 1_000),
            "r1",
            ALICE,
        );
        let (a, card) = ingest(
            &conn,
            &rsvp_wire("ev-1", PARENT, RsvpStatus::Accepted, 2_000),
            "r2",
            BOB,
        );
        assert_eq!(a, Applied::Changed { inserted: false });
        assert!(card.is_none());
        ingest(
            &conn,
            &rsvp_wire("ev-1", PARENT, RsvpStatus::Declined, 3_000),
            "r3",
            BOB,
        );
        assert_eq!(rsvp_of(&conn, "ev-1", BOB), Some(RsvpStatus::Declined));
        // Declined from Bob does not touch Alice's answer.
        assert_eq!(rsvp_of(&conn, "ev-1", ALICE), Some(RsvpStatus::Accepted));

        let (older, _) = ingest(
            &conn,
            &rsvp_wire("ev-1", PARENT, RsvpStatus::Tentative, 2_500),
            "r4",
            BOB,
        );
        assert_eq!(older, Applied::Ignored);
        let (equal, _) = ingest(
            &conn,
            &rsvp_wire("ev-1", PARENT, RsvpStatus::Tentative, 3_000),
            "r5",
            BOB,
        );
        assert_eq!(equal, Applied::Ignored);
        assert_eq!(rsvp_of(&conn, "ev-1", BOB), Some(RsvpStatus::Declined));
    }

    #[test]
    fn rsvp_from_non_member_is_ignored() {
        let conn = conn();
        ingest(
            &conn,
            &create("ev-1", &fields("2026-01-15T09:00"), 1_000),
            "r1",
            ALICE,
        );
        let (a, _) = ingest(
            &conn,
            &rsvp_wire("ev-1", PARENT, RsvpStatus::Accepted, 2_000),
            "r2",
            OUTSIDER,
        );
        assert_eq!(a, Applied::Ignored);
        assert_eq!(rsvp_of(&conn, "ev-1", OUTSIDER), None);
    }

    #[test]
    fn three_members_produce_one_of_each_count() {
        let conn = conn();
        let w = create("ev-1", &fields("2026-01-15T09:00"), 1_000);
        ingest(&conn, &w, "r1", ALICE);
        ingest(
            &conn,
            &rsvp_wire("ev-1", PARENT, RsvpStatus::Tentative, 2_000),
            "r2",
            BOB,
        );
        ingest(
            &conn,
            &rsvp_wire("ev-1", PARENT, RsvpStatus::Declined, 2_000),
            "r3",
            CAROL,
        );
        let ev = load_events(&conn, PARENT, BOB).unwrap().remove(0);
        let count = |s: RsvpStatus| ev.rsvps.iter().filter(|r| r.status == s).count();
        assert_eq!(
            (
                count(RsvpStatus::Accepted),
                count(RsvpStatus::Tentative),
                count(RsvpStatus::Declined)
            ),
            (1, 1, 1)
        );
        assert_eq!(ev.my_rsvp, Some(RsvpStatus::Tentative));
        assert!(!ev.can_edit);
        assert!(load_events(&conn, PARENT, ALICE).unwrap()[0].can_edit);
    }

    #[test]
    fn non_author_non_admin_update_is_ignored() {
        let conn = conn();
        ingest(
            &conn,
            &create("ev-1", &fields("2026-01-15T09:00"), 1_000),
            "r1",
            ALICE,
        );
        let before = row(&conn, "ev-1");
        let (a, card) = ingest(
            &conn,
            &update("ev-1", &fields("2026-01-16T09:00"), 2_000),
            "r2",
            BOB,
        );
        assert_eq!(a, Applied::Ignored);
        assert!(card.is_none());
        assert_eq!(row(&conn, "ev-1"), before);
    }

    #[test]
    fn admin_update_is_applied() {
        let conn = conn();
        ingest(
            &conn,
            &create("ev-1", &fields("2026-01-15T09:00"), 1_000),
            "r1",
            ALICE,
        );
        let moved = fields("2026-01-16T09:00");
        ingest(&conn, &update("ev-1", &moved, 2_000), "r2", ADMIN);
        let stored = row(&conn, "ev-1");
        assert_eq!(stored.fields.start_unix, moved.start_unix);
        assert_eq!(stored.updated_by_npub, ADMIN);
        assert_eq!(stored.author_npub, ALICE);
    }

    #[test]
    fn author_update_wins_and_older_update_does_not_revert() {
        let conn = conn();
        ingest(
            &conn,
            &create("ev-1", &fields("2026-01-15T09:00"), 1_000),
            "r1",
            ALICE,
        );
        let moved = fields("2026-01-20T11:00");
        let (a, card) = ingest(&conn, &update("ev-1", &moved, 3_000), "r2", ALICE);
        assert_eq!(a, Applied::Changed { inserted: false });
        assert!(card.is_none());
        assert_eq!(row(&conn, "ev-1").fields.start_unix, moved.start_unix);

        let stale = fields("2026-01-17T08:00");
        assert_eq!(
            ingest(&conn, &update("ev-1", &stale, 2_000), "r3", ALICE).0,
            Applied::Ignored
        );
        assert_eq!(
            ingest(&conn, &update("ev-1", &stale, 3_000), "r4", ALICE).0,
            Applied::Ignored
        );
        let stored = row(&conn, "ev-1");
        assert_eq!(stored.fields.start_unix, moved.start_unix);
        assert_eq!(stored.updated_at_ms, 3_000);
    }

    #[test]
    fn restriction_ignores_member_create_and_stores_admin_create() {
        let conn = conn();
        restrict_create(&conn);
        let (member, card) = ingest(
            &conn,
            &create("ev-1", &fields("2026-01-15T09:00"), 1_000),
            "r1",
            ALICE,
        );
        assert_eq!(member, Applied::Ignored);
        assert!(card.is_none());
        assert!(load_row(&conn, "ev-1").unwrap().is_none());

        let (admin, card) = ingest(
            &conn,
            &create("ev-2", &fields("2026-01-15T09:00"), 1_000),
            "r2",
            ADMIN,
        );
        assert_eq!(admin, Applied::Changed { inserted: true });
        assert!(card.is_some());
        assert_eq!(row(&conn, "ev-2").author_npub, ADMIN);

        let (_, card) = ingest(&conn, &series("s-1", &series_ids()).1, "r3", ALICE);
        assert!(card.is_none());
    }

    #[test]
    fn non_member_create_is_ignored() {
        let conn = conn();
        let (a, card) = ingest(
            &conn,
            &create("ev-1", &fields("2026-01-15T09:00"), 1_000),
            "r1",
            OUTSIDER,
        );
        assert_eq!(a, Applied::Ignored);
        assert!(card.is_none());
        assert_eq!(count_rows(&conn, "squad_events"), 0);
    }

    #[test]
    fn series_card_and_eight_silent_creates() {
        let conn = conn();
        let ids = series_ids();
        let (creates, card_wire) = series("s-1", &ids);
        for (i, w) in creates.iter().enumerate() {
            let (a, card) = ingest(&conn, w, &format!("r{i}"), ALICE);
            assert_eq!(a, Applied::Changed { inserted: true });
            assert!(card.is_none(), "weekly create must be silent");
        }
        assert_eq!(count_rows(&conn, "squad_events"), 8);

        let (a, card) = ingest(&conn, &card_wire, "r-card", ALICE);
        assert_eq!(a, Applied::SeriesCard);
        assert_eq!(count_rows(&conn, "squad_events"), 8);
        let card = card.expect("one series card");
        let json: serde_json::Value = serde_json::from_str(&card).unwrap();
        assert_eq!(json["type"], "squad_event_series_created");
        assert_eq!(json["payload"]["series_id"], "s-1");
        assert_eq!(json["payload"]["count"], 8);
        assert_eq!(
            json["payload"]["first_start"],
            row(&conn, "ev-1").fields.start_unix.unwrap()
        );
        assert!(!card.contains(SECRET_LOCATION));

        let events = load_events(&conn, PARENT, ALICE).unwrap();
        assert!(events.iter().all(|e| e.series_id.as_deref() == Some("s-1")));
        assert!(events
            .iter()
            .all(|e| e.my_rsvp == Some(RsvpStatus::Accepted)));
    }

    #[test]
    fn series_card_alone_inserts_no_row() {
        let conn = conn();
        let (a, card) = ingest(&conn, &series("s-1", &series_ids()).1, "r-card", ALICE);
        assert_eq!(a, Applied::SeriesCard);
        assert!(card.is_some());
        assert_eq!(count_rows(&conn, "squad_events"), 0);
    }

    #[test]
    fn series_occurrences_step_weekly_and_keep_end_offset() {
        let occ = occurrences(
            &input("2026-03-01T09:00", Some("2026-03-01T10:30")),
            WEEKLY_SERIES_COUNT,
        )
        .unwrap();
        assert_eq!(occ.len(), 8);
        for f in &occ {
            assert_eq!(f.end_unix.unwrap() - f.start_unix.unwrap(), 90 * 60);
        }
        // Spring forward on 2026-03-08 keeps 09:00 civil: one hour less in UTC between weeks 1 and 2.
        assert_eq!(
            occ[1].start_unix.unwrap() - occ[0].start_unix.unwrap(),
            7 * 86_400 - 3_600
        );

        let mut all_day = input("2026-12-24", Some("2026-12-26"));
        all_day.all_day = true;
        let occ = occurrences(&all_day, 2).unwrap();
        assert_eq!(occ[1].start_date.as_deref(), Some("2026-12-31"));
        assert_eq!(occ[1].end_date.as_deref(), Some("2027-01-02"));
        assert_eq!(occ[1].kind, KIND_ALL_DAY);
    }

    #[test]
    fn series_ids_must_be_eight_distinct() {
        assert!(validate_series_ids("s-1", &series_ids()).is_ok());
        let invalid = Err(err::INVALID_SERIES.to_string());
        assert_eq!(validate_series_ids("s-1", &series_ids()[..7]), invalid);
        let mut dup = series_ids();
        dup[7] = dup[0].clone();
        assert_eq!(validate_series_ids("s-1", &dup), invalid);
        assert_eq!(validate_series_ids(" ", &series_ids()), invalid);
    }

    #[test]
    fn queued_update_from_non_author_non_admin_is_ignored() {
        let conn = conn();
        let (a, _) = ingest(
            &conn,
            &update("ev-1", &fields("2026-01-20T09:00"), 5_000),
            "r-up",
            BOB,
        );
        assert_eq!(a, Applied::Queued);
        let original = fields("2026-01-15T09:00");
        ingest(&conn, &create("ev-1", &original, 1_000), "r1", ALICE);
        let stored = row(&conn, "ev-1");
        assert_eq!(stored.fields.start_unix, original.start_unix);
        assert_eq!(stored.updated_by_npub, ALICE);
        assert_eq!(count_rows(&conn, "squad_event_pending_ops"), 0);
    }

    #[test]
    fn queued_author_update_applies_in_order() {
        let conn = conn();
        let later = fields("2026-01-22T09:00");
        ingest(&conn, &update("ev-1", &later, 6_000), "r-b", ALICE);
        ingest(
            &conn,
            &update("ev-1", &fields("2026-01-20T09:00"), 5_000),
            "r-a",
            ALICE,
        );
        ingest(
            &conn,
            &create("ev-1", &fields("2026-01-15T09:00"), 1_000),
            "r1",
            ALICE,
        );
        let stored = row(&conn, "ev-1");
        assert_eq!(stored.fields.start_unix, later.start_unix);
        assert_eq!(stored.updated_at_ms, 6_000);
    }

    #[test]
    fn unknown_zone_and_bad_times_are_rejected_before_send() {
        let mut bad_zone = input("2026-01-15T09:00", None);
        bad_zone.start_tzid = "Mars/Olympus_Mons".into();
        assert_eq!(
            fields_from_input(&bad_zone),
            Err(err::INVALID_ZONE.to_string())
        );

        let mut empty_title = input("2026-01-15T09:00", None);
        empty_title.title = "  ".into();
        assert_eq!(
            fields_from_input(&empty_title),
            Err(err::INVALID_TITLE.to_string())
        );

        let mut no_location = input("2026-01-15T09:00", None);
        no_location.location = " ".into();
        assert_eq!(
            fields_from_input(&no_location),
            Err(err::INVALID_PLACE.to_string())
        );

        let bad_time = Err(err::INVALID_TIME.to_string());
        assert_eq!(
            fields_from_input(&input("2026-01-15T09:00", Some("2026-01-15T08:00"))),
            bad_time
        );
        assert_eq!(
            fields_from_input(&input("2026-01-15 09:00", None)),
            bad_time
        );

        let mut all_day = input("2026-01-15", Some("2026-01-15"));
        all_day.all_day = true;
        assert_eq!(fields_from_input(&all_day), bad_time, "end is exclusive");
        all_day.end = Some("2026-01-16".into());
        let f = fields_from_input(&all_day).unwrap();
        assert_eq!(
            (f.kind, f.start_date.as_deref(), f.start_unix),
            (KIND_ALL_DAY, Some("2026-01-15"), None)
        );

        // Spring-forward gap resolves to the first valid instant.
        let gap = fields_from_input(&input("2026-03-08T02:30", None)).unwrap();
        assert_eq!(
            gap.start_unix,
            civil::civil_to_unix("2026-03-08T03:00", NY).ok()
        );
    }

    #[test]
    fn cancel_keeps_row_with_cancelled_status() {
        let conn = conn();
        let f = fields("2026-01-15T09:00");
        ingest(&conn, &create("ev-1", &f, 1_000), "r1", ALICE);
        let (a, card) = ingest(
            &conn,
            &event_wire(Op::Cancel, "ev-1", PARENT, None, &f, 2_000),
            "r2",
            ALICE,
        );
        assert_eq!(a, Applied::Changed { inserted: false });
        assert!(card.is_none());
        let events = load_events(&conn, PARENT, ALICE).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].status, EventStatus::Cancelled);

        // A newer update does not reactivate a cancelled event.
        ingest(
            &conn,
            &update("ev-1", &fields("2026-01-16T09:00"), 3_000),
            "r3",
            ALICE,
        );
        assert_eq!(row(&conn, "ev-1").status, EventStatus::Cancelled);
    }

    #[test]
    fn cancel_from_non_author_non_admin_is_ignored() {
        let conn = conn();
        let f = fields("2026-01-15T09:00");
        ingest(&conn, &create("ev-1", &f, 1_000), "r1", ALICE);
        let (a, _) = ingest(
            &conn,
            &event_wire(Op::Cancel, "ev-1", PARENT, None, &f, 2_000),
            "r2",
            BOB,
        );
        assert_eq!(a, Applied::Ignored);
        assert_eq!(row(&conn, "ev-1").status, EventStatus::Active);
    }

    #[test]
    fn older_cancel_after_newer_update_still_cancels_and_keeps_fields() {
        let conn = conn();
        let original = fields("2026-01-15T09:00");
        ingest(&conn, &create("ev-1", &original, 1_000), "r1", ALICE);
        let moved = fields("2026-01-20T09:00");
        ingest(&conn, &update("ev-1", &moved, 3_000), "r2", ALICE);
        ingest(
            &conn,
            &event_wire(Op::Cancel, "ev-1", PARENT, None, &original, 2_000),
            "r3",
            ADMIN,
        );
        let stored = row(&conn, "ev-1");
        assert_eq!(stored.status, EventStatus::Cancelled);
        assert_eq!(stored.fields.start_unix, moved.start_unix);
        assert_eq!(stored.updated_at_ms, 3_000);
    }

    #[test]
    fn cancelling_one_series_occurrence_leaves_seven_active() {
        let conn = conn();
        let ids = series_ids();
        let (creates, _) = series("s-1", &ids);
        for (i, w) in creates.iter().enumerate() {
            ingest(&conn, w, &format!("r{i}"), ALICE);
        }
        let third = row(&conn, "ev-3");
        let cancel = event_wire(
            Op::Cancel,
            "ev-3",
            PARENT,
            Some("s-1"),
            &third.fields,
            1_000,
        );
        ingest(&conn, &cancel, "r-cancel", ALICE);
        let events = load_events(&conn, PARENT, ALICE).unwrap();
        let active = events
            .iter()
            .filter(|e| e.status == EventStatus::Active)
            .count();
        assert_eq!(active, 7);
        assert_eq!(
            events.iter().find(|e| e.id == "ev-3").unwrap().status,
            EventStatus::Cancelled
        );
    }

    #[test]
    fn child_from_another_group_is_ignored() {
        let conn = conn();
        let f = fields("2026-01-15T09:00");
        ingest(&conn, &create("ev-1", &f, 1_000), "r1", ALICE);
        let meta = OpMeta {
            rumor_id: "r2",
            mls_group_id: "group-2",
            signer_npub: ADMIN,
        };
        let w = update("ev-1", &fields("2026-01-16T09:00"), 2_000);
        assert_eq!(
            apply_op(&conn, &w, &meta, role_of(ADMIN), NOW).unwrap(),
            Applied::Ignored
        );
        assert_eq!(row(&conn, "ev-1").fields.start_unix, f.start_unix);
    }

    #[test]
    fn ops_from_another_group_naming_a_foreign_parent_change_nothing() {
        let conn = conn();
        let f = fields("2026-01-15T09:00");
        ingest(&conn, &create("ev-1", &f, 1_000), "r1", ALICE);
        let before = load_events(&conn, PARENT, ALICE).unwrap();
        // ADMIN is admin of their own channel group, which is not the squad's announcements group.
        let meta = |rumor_id| OpMeta {
            rumor_id,
            mls_group_id: "channel-2",
            signer_npub: ADMIN,
        };
        let admin = role_of(ADMIN);
        let moved = fields("2026-01-16T09:00");
        for (rumor_id, w) in [
            ("x1", create("ev-new", &f, 2_000)),
            ("x2", update("ev-1", &moved, 2_000)),
            ("x3", rsvp_wire("ev-1", PARENT, RsvpStatus::Declined, 2_000)),
            ("x4", update("ev-unknown", &moved, 2_000)),
            (
                "x5",
                rsvp_wire("ev-unknown", PARENT, RsvpStatus::Accepted, 2_000),
            ),
        ] {
            assert_eq!(
                apply_op(&conn, &w, &meta(rumor_id), admin, NOW).unwrap(),
                Applied::Ignored
            );
        }
        // Naming its own group as parent cannot touch an event stored for another parent.
        let mut own = update("ev-1", &moved, 3_000);
        own.parent_id = "channel-2".into();
        assert_eq!(
            apply_op(&conn, &own, &meta("x6"), admin, NOW).unwrap(),
            Applied::Ignored
        );

        assert_eq!(load_events(&conn, PARENT, ALICE).unwrap(), before);
        assert_eq!(count_rows(&conn, "squad_events"), 1);
        assert_eq!(count_rows(&conn, "squad_event_pending_ops"), 0);
    }

    #[test]
    fn send_group_must_be_the_parent_announcements_group() {
        assert!(ensure_announcements_group(" squad-1 ", "squad-1").is_ok());
        let wrong = Err(err::WRONG_GROUP.to_string());
        assert_eq!(ensure_announcements_group("channel-2", "squad-1"), wrong);
        assert_eq!(ensure_announcements_group("", ""), wrong);
    }

    #[test]
    fn send_errors_use_codes() {
        let conn = conn();
        ingest(
            &conn,
            &create("ev-1", &fields("2026-01-15T09:00"), 1_000),
            "r1",
            ALICE,
        );
        let code = |e: &str| Err::<(), String>(e.to_string());
        let editable =
            |id, npub| editable_row(&conn, GROUP, PARENT, id, npub, role_of(npub)).map(|_| ());
        assert_eq!(editable("ev-1", BOB), code(err::NOT_EDITABLE));
        assert_eq!(editable("ev-1", OUTSIDER), code(err::NOT_MEMBER));
        assert_eq!(editable("ev-404", ALICE), code(err::NOT_FOUND));
        assert!(editable("ev-1", ALICE).is_ok());
        assert!(editable("ev-1", ADMIN).is_ok());
        assert_eq!(
            row_in_parent(&conn, "squad-2", "squad-2", "ev-1").map(|_| ()),
            code(err::NOT_FOUND)
        );

        assert_eq!(
            ensure_may_create(&conn, PARENT, role_of(OUTSIDER)),
            code(err::NOT_MEMBER)
        );
        restrict_create(&conn);
        assert_eq!(
            ensure_may_create(&conn, PARENT, role_of(BOB)),
            code(err::CREATE_RESTRICTED)
        );
        assert!(ensure_may_create(&conn, PARENT, role_of(ADMIN)).is_ok());
    }

    #[test]
    fn far_future_and_negative_stamps_are_rejected_at_ingest() {
        let now = 1_700_000_000_000;
        assert!(stamp_acceptable(now, now));
        assert!(stamp_acceptable(now + MAX_FUTURE_SKEW_MS, now));
        assert!(!stamp_acceptable(now + MAX_FUTURE_SKEW_MS + 1, now));
        assert!(!stamp_acceptable(i64::MAX, now));
        assert!(!stamp_acceptable(-1, now));
    }

    #[test]
    fn pending_ops_are_capped_per_parent_and_author() {
        let conn = conn();
        let extra = 5;
        for i in 1..=(MAX_PENDING_PER_AUTHOR + extra) {
            let w = rsvp_wire(&format!("ev-{i}"), PARENT, RsvpStatus::Accepted, i);
            assert_eq!(ingest(&conn, &w, &format!("r{i}"), BOB).0, Applied::Queued);
        }
        // Another author keeps their own budget.
        ingest(
            &conn,
            &rsvp_wire("ev-c", PARENT, RsvpStatus::Accepted, 1),
            "r-c",
            CAROL,
        );

        assert_eq!(
            count_rows(&conn, "squad_event_pending_ops"),
            MAX_PENDING_PER_AUTHOR + 1
        );
        let oldest_bob: i64 = conn
            .query_row(
                "SELECT MIN(updated_at_ms) FROM squad_event_pending_ops WHERE author_npub = ?1",
                params![BOB],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(oldest_bob, extra + 1);
    }

    #[test]
    fn pending_ops_older_than_ttl_are_purged() {
        let conn = conn();
        ingest(
            &conn,
            &rsvp_wire("ev-1", PARENT, RsvpStatus::Accepted, 1_000),
            "r-old",
            BOB,
        );
        assert_eq!(count_rows(&conn, "squad_event_pending_ops"), 1);
        let later = 1_000 + PENDING_TTL_MS + 1;
        drain_pending(&conn, "ev-1", &role_of, later).unwrap();
        assert_eq!(count_rows(&conn, "squad_event_pending_ops"), 0);

        // Expired ops are also dropped when a new one is queued.
        ingest(
            &conn,
            &rsvp_wire("ev-2", PARENT, RsvpStatus::Accepted, 1_000),
            "r-old2",
            BOB,
        );
        let meta = OpMeta {
            rumor_id: "r-new",
            mls_group_id: GROUP,
            signer_npub: CAROL,
        };
        let fresh = rsvp_wire("ev-3", PARENT, RsvpStatus::Accepted, later);
        apply_op(&conn, &fresh, &meta, role_of(CAROL), later).unwrap();
        assert_eq!(count_rows(&conn, "squad_event_pending_ops"), 1);
    }

    #[test]
    fn wire_uses_schema_and_nip52_names() {
        let f = fields("2026-01-15T09:00");
        let json: serde_json::Value =
            serde_json::to_value(create("ev-1", &f, 1_000)).expect("serialize");
        assert_eq!(json["schema"], SCHEMA);
        assert_eq!(json["op"], "create");
        assert_eq!(json["kind"], KIND_TIMED);
        assert_eq!(json["start_tzid"], NY);
        assert_eq!(json["place"], "offline");
        assert_eq!(json["rsvp"], "accepted");
        assert!(json.get("series_id").is_none());
        let rsvp: serde_json::Value =
            serde_json::to_value(rsvp_wire("ev-1", PARENT, RsvpStatus::Tentative, 1)).unwrap();
        assert_eq!(rsvp["op"], "rsvp");
        assert_eq!(rsvp["status"], "tentative");
        assert!(parse_wire(
            r#"{"schema":"other","op":"create","id":"x","parent_id":"p","updated_at_ms":1}"#
        )
        .is_none());
        assert!(parse_wire(&serde_json::to_string(&create("ev-1", &f, 1)).unwrap()).is_some());
    }

    #[test]
    fn dto_serializes_camel_case() {
        let conn = conn();
        ingest(
            &conn,
            &create("ev-1", &fields("2026-01-15T09:00"), 1_000),
            "r1",
            ALICE,
        );
        let json = serde_json::to_value(load_events(&conn, PARENT, ALICE).unwrap()).unwrap();
        let ev = &json[0];
        for key in [
            "id",
            "parentId",
            "mlsGroupId",
            "seriesId",
            "kind",
            "startUnix",
            "endUnix",
            "startDate",
            "endDate",
            "startTzid",
            "place",
            "location",
            "channelId",
            "status",
            "authorNpub",
            "createdAtMs",
            "updatedAtMs",
            "updatedByNpub",
            "rsvps",
            "myRsvp",
            "canEdit",
        ] {
            assert!(ev.get(key).is_some(), "missing {key}");
        }
        assert_eq!(ev["status"], "active");
        assert_eq!(ev["myRsvp"], "accepted");
        assert_eq!(ev["rsvps"][0]["memberNpub"], ALICE);
    }
}
