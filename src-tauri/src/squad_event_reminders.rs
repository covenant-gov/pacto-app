//! Device-local reminders for squad events the member is attending.
//!
//! A scan task spawned at unlock reconciles the event replica into
//! `squad_event_reminders`, fires on-time reminders, and writes reminders
//! that came due while the process was down (or locked) to Catch up.
//! Prefs and fire rows never leave the device.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::OptionalExtension;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use crate::chat::NotificationLevel;
use crate::notification::{self, ReminderDelivery, SingleEventNotification};

pub const DEFAULT_LEAD_MINUTES: i64 = 15;
pub const MAX_LEAD_MINUTES: i64 = 10_080;
pub const REMINDER_DUE_EVENT: &str = "squad_event_reminder_due";
const SCAN_INTERVAL: Duration = Duration::from_secs(60);
/// A scan can run up to one interval late, so an on-time fire still shows that long after the start.
const START_GRACE_MS: i64 = 60_000;
const ALL_DAY_REMINDER_HOUR: u32 = 9;
const NIP52_ALL_DAY: i64 = 31922;
const NIP52_TIMED: i64 = 31923;

/// Serializes scans so one fire is never delivered twice.
static SCAN_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadEventReminderPrefs {
    pub lead_minutes: i64,
    pub muted: bool,
}

impl Default for SquadEventReminderPrefs {
    fn default() -> Self {
        Self {
            lead_minutes: DEFAULT_LEAD_MINUTES,
            muted: false,
        }
    }
}

/// `squad_event_reminder_due` payload. No location field by design.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadEventReminderDue {
    pub event_id: String,
    pub parent_id: String,
    pub mls_group_id: String,
    pub title: String,
    pub start_unix: Option<i64>,
    pub start_date: Option<String>,
    pub start_tzid: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FireState {
    Scheduled,
    Fired,
    Missed,
    Dropped,
}

impl FireState {
    fn as_db_str(self) -> &'static str {
        match self {
            FireState::Scheduled => "scheduled",
            FireState::Fired => "fired",
            FireState::Missed => "missed",
            FireState::Dropped => "dropped",
        }
    }

    fn from_db_str(value: &str) -> Option<Self> {
        match value {
            "scheduled" => Some(FireState::Scheduled),
            "fired" => Some(FireState::Fired),
            "missed" => Some(FireState::Missed),
            "dropped" => Some(FireState::Dropped),
            _ => None,
        }
    }
}

/// Replica event joined with this member's RSVP and local prefs. Never reads `location`.
struct ReminderSource {
    event_id: String,
    parent_id: String,
    mls_group_id: String,
    nip52_kind: i64,
    title: String,
    start_unix: Option<i64>,
    start_date: Option<String>,
    start_tzid: String,
    active: bool,
    /// Announcements group is a non-evicted MLS group of this account.
    in_group: bool,
    my_rsvp: Option<String>,
    lead_minutes: i64,
    muted: bool,
}

impl ReminderSource {
    /// Timed: the real start. All-day: 09:00 in `start_tzid` (system zone when empty).
    fn start_at_ms(&self) -> Option<i64> {
        match self.nip52_kind {
            NIP52_TIMED => self.start_unix.map(|s| s * 1000),
            NIP52_ALL_DAY => {
                let date = self.start_date.as_deref()?;
                let tzid = Some(self.start_tzid.as_str()).filter(|t| !t.is_empty());
                crate::squad_event_time::civil_date_time_to_unix(
                    date,
                    ALL_DAY_REMINDER_HOUR,
                    0,
                    tzid,
                )
                .ok()
                .map(|s| s * 1000)
            }
            _ => None,
        }
    }

    fn qualifies(&self) -> bool {
        self.active
            && self.in_group
            && !self.muted
            && matches!(self.my_rsvp.as_deref(), Some("accepted" | "tentative"))
    }

    fn desired_fire_at_ms(&self, start_at_ms: Option<i64>) -> Option<i64> {
        if !self.qualifies() {
            return None;
        }
        let lead = self.lead_minutes.clamp(0, MAX_LEAD_MINUTES);
        start_at_ms.map(|start| start - lead * 60_000)
    }

    fn due(&self) -> SquadEventReminderDue {
        SquadEventReminderDue {
            event_id: self.event_id.clone(),
            parent_id: self.parent_id.clone(),
            mls_group_id: self.mls_group_id.clone(),
            title: self.title.clone(),
            start_unix: self.start_unix,
            start_date: self.start_date.clone(),
            start_tzid: self.start_tzid.clone(),
        }
    }
}

#[derive(Debug, Default)]
pub(crate) struct ScanOutcome {
    /// On-time fires to deliver now; already marked fired.
    pub due: Vec<SquadEventReminderDue>,
    pub missed: usize,
    pub dropped: usize,
    pub resolved: usize,
}

fn db_err(e: rusqlite::Error) -> String {
    e.to_string()
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub(crate) fn load_prefs(
    conn: &rusqlite::Connection,
    event_id: &str,
) -> Result<SquadEventReminderPrefs, String> {
    let row = conn
        .query_row(
            "SELECT lead_minutes, muted FROM squad_event_reminder_prefs WHERE event_id = ?1",
            [event_id],
            |row| {
                Ok(SquadEventReminderPrefs {
                    lead_minutes: row.get(0)?,
                    muted: row.get::<_, i64>(1)? != 0,
                })
            },
        )
        .optional()
        .map_err(db_err)?;
    Ok(row.unwrap_or_default())
}

pub(crate) fn save_prefs(
    conn: &rusqlite::Connection,
    event_id: &str,
    lead_minutes: i64,
    muted: bool,
) -> Result<(), String> {
    if !(0..=MAX_LEAD_MINUTES).contains(&lead_minutes) {
        return Err(format!(
            "Reminder lead must be between 0 and {MAX_LEAD_MINUTES} minutes"
        ));
    }
    conn.execute(
        "INSERT INTO squad_event_reminder_prefs (event_id, lead_minutes, muted) VALUES (?1, ?2, ?3)
         ON CONFLICT(event_id) DO UPDATE SET lead_minutes = excluded.lead_minutes, muted = excluded.muted",
        rusqlite::params![event_id, lead_minutes, muted as i64],
    )
    .map_err(db_err)?;
    Ok(())
}

fn load_sources(conn: &rusqlite::Connection, my_npub: &str) -> Result<Vec<ReminderSource>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT e.event_id, e.parent_id, e.mls_group_id, e.nip52_kind, e.title,
                    e.start_unix, e.start_date, e.start_tzid, e.status, r.status,
                    COALESCE(p.lead_minutes, ?2), COALESCE(p.muted, 0),
                    EXISTS(SELECT 1 FROM mls_groups g WHERE g.evicted = 0
                           AND (g.group_id = e.mls_group_id OR g.engine_group_id = e.mls_group_id))
             FROM squad_events e
             LEFT JOIN squad_event_rsvps r ON r.event_id = e.event_id AND r.member_npub = ?1
             LEFT JOIN squad_event_reminder_prefs p ON p.event_id = e.event_id",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map(rusqlite::params![my_npub, DEFAULT_LEAD_MINUTES], |row| {
            Ok(ReminderSource {
                event_id: row.get(0)?,
                parent_id: row.get(1)?,
                mls_group_id: row.get(2)?,
                nip52_kind: row.get(3)?,
                title: row.get(4)?,
                start_unix: row.get(5)?,
                start_date: row.get(6)?,
                start_tzid: row.get(7)?,
                active: row.get::<_, String>(8)? == "active",
                my_rsvp: row.get(9)?,
                lead_minutes: row.get(10)?,
                muted: row.get::<_, i64>(11)? != 0,
                in_group: row.get(12)?,
            })
        })
        .map_err(db_err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db_err)
}

fn fire_state(
    conn: &rusqlite::Connection,
    event_id: &str,
    fire_at_ms: i64,
) -> Result<Option<FireState>, String> {
    let state: Option<String> = conn
        .query_row(
            "SELECT state FROM squad_event_reminders WHERE event_id = ?1 AND fire_at_ms = ?2",
            rusqlite::params![event_id, fire_at_ms],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_err)?;
    Ok(state.as_deref().and_then(FireState::from_db_str))
}

fn fired_for_start(
    conn: &rusqlite::Connection,
    event_id: &str,
    start_at_ms: i64,
) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM squad_event_reminders
                       WHERE event_id = ?1 AND start_at_ms = ?2 AND state = 'fired')",
        rusqlite::params![event_id, start_at_ms],
        |row| row.get(0),
    )
    .map_err(db_err)
}

/// Persisted chat level, for chats not loaded into memory yet.
fn stored_notification_level(
    conn: &rusqlite::Connection,
    chat_id: &str,
) -> Result<Option<NotificationLevel>, String> {
    let level: Option<String> = conn
        .query_row(
            "SELECT notification_level FROM chats WHERE chat_identifier = ?1",
            [chat_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_err)?;
    Ok(level.as_deref().map(NotificationLevel::from_db_str))
}

fn upsert_fire(
    conn: &rusqlite::Connection,
    event_id: &str,
    fire_at_ms: i64,
    start_at_ms: i64,
    state: FireState,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO squad_event_reminders (event_id, fire_at_ms, start_at_ms, state) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(event_id, fire_at_ms) DO UPDATE SET start_at_ms = excluded.start_at_ms, state = excluded.state",
        rusqlite::params![event_id, fire_at_ms, start_at_ms, state.as_db_str()],
    )
    .map_err(db_err)?;
    Ok(())
}

/// Drop pending fires for one event, except `keep_fire_at_ms`.
fn drop_scheduled(
    conn: &rusqlite::Connection,
    event_id: &str,
    keep_fire_at_ms: Option<i64>,
) -> Result<usize, String> {
    conn.execute(
        "UPDATE squad_event_reminders SET state = 'dropped'
         WHERE event_id = ?1 AND state = 'scheduled' AND (?2 IS NULL OR fire_at_ms != ?2)",
        rusqlite::params![event_id, keep_fire_at_ms],
    )
    .map_err(db_err)
}

/// Resolve open missed-reminder Catch up entries whose event has started.
fn resolve_started(conn: &rusqlite::Connection, now_ms: i64) -> Result<usize, String> {
    let sources: Vec<String> = {
        let mut stmt = conn
            .prepare(
                "SELECT c.source_event_id FROM squad_event_reminders r
                 JOIN catch_up_entries c ON c.source_event_id = r.event_id || ':' || r.fire_at_ms
                 WHERE r.state = 'missed' AND r.start_at_ms <= ?1
                   AND c.kind = 'event_reminder' AND c.resolved_at IS NULL",
            )
            .map_err(db_err)?;
        let rows = stmt.query_map([now_ms], |row| row.get(0)).map_err(db_err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_err)?
    };
    let mut resolved = 0;
    for source in sources {
        if crate::catch_up::resolve_entry(conn, &source)? {
            resolved += 1;
        }
    }
    Ok(resolved)
}

/// Reconcile the replica into fire rows and handle every fire at or before `now_ms`.
/// A fire already scheduled by an earlier unlock and due before this one is missed
/// (Catch up, no banner); any other due fire is delivered on time.
pub(crate) fn run_scan(
    conn: &rusqlite::Connection,
    my_npub: &str,
    now_ms: i64,
    unlocked_at_ms: i64,
) -> Result<ScanOutcome, String> {
    let sources = load_sources(conn, my_npub)?;
    let tx = conn.unchecked_transaction().map_err(db_err)?;
    let mut out = ScanOutcome::default();

    for src in &sources {
        let start = src.start_at_ms();
        if let Some(start) = start {
            tx.execute(
                "UPDATE squad_event_reminders SET start_at_ms = ?2
                 WHERE event_id = ?1 AND state = 'missed' AND start_at_ms != ?2",
                rusqlite::params![src.event_id, start],
            )
            .map_err(db_err)?;
        }
        let desired = src.desired_fire_at_ms(start);
        out.dropped += drop_scheduled(&tx, &src.event_id, desired)?;
        let (Some(fire), Some(start)) = (desired, start) else {
            continue;
        };
        if start + START_GRACE_MS <= now_ms {
            continue;
        }
        let prior = fire_state(&tx, &src.event_id, fire)?;
        if matches!(prior, Some(FireState::Fired | FireState::Missed)) {
            continue;
        }
        let next = if fire > now_ms {
            FireState::Scheduled
        } else if prior == Some(FireState::Scheduled) && fire < unlocked_at_ms {
            if start > now_ms {
                crate::catch_up::record_missed_event_reminder(
                    &tx,
                    &src.mls_group_id,
                    &src.event_id,
                    fire,
                )?;
                out.missed += 1;
                FireState::Missed
            } else {
                FireState::Dropped
            }
        } else if fired_for_start(&tx, &src.event_id, start)? {
            // Lead changed after this start already reminded.
            continue;
        } else {
            out.due.push(src.due());
            FireState::Fired
        };
        upsert_fire(&tx, &src.event_id, fire, start, next)?;
    }

    out.dropped += tx
        .execute(
            "UPDATE squad_event_reminders SET state = 'dropped'
             WHERE state = 'scheduled' AND event_id NOT IN (SELECT event_id FROM squad_events)",
            [],
        )
        .map_err(db_err)?;
    out.resolved = resolve_started(&tx, now_ms)?;
    tx.execute(
        "DELETE FROM squad_event_reminders WHERE start_at_ms + ?1 <= ?2",
        rusqlite::params![START_GRACE_MS, now_ms],
    )
    .map_err(db_err)?;
    tx.commit().map_err(db_err)?;
    Ok(out)
}

fn format_start(due: &SquadEventReminderDue) -> String {
    if let Some(unix) = due.start_unix {
        if let Some(t) = chrono::DateTime::from_timestamp(unix, 0) {
            return format!(
                "starts {}",
                t.with_timezone(&chrono::Local).format("%a %b %-d, %H:%M")
            );
        }
    }
    let date = due.start_date.as_deref().unwrap_or_default();
    match chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d") {
        Ok(d) => format!("all day {}", d.format("%a %b %-d")),
        Err(_) => format!("all day {date}"),
    }
}

/// OS banner copy: title and start only.
fn banner_for(due: &SquadEventReminderDue) -> SingleEventNotification {
    SingleEventNotification {
        title: "Event reminder".to_string(),
        body: format!("{} — {}", due.title, format_start(due)),
    }
}

/// `stored` holds the DB level per due entry; the in-memory chat wins. Unknown level stays silent.
async fn deliver<R: Runtime>(
    handle: &AppHandle<R>,
    due: &[SquadEventReminderDue],
    stored: &[Option<NotificationLevel>],
) -> usize {
    if due.is_empty() {
        return 0;
    }
    let levels: Vec<Option<NotificationLevel>> = {
        let state = crate::STATE.lock().await;
        due.iter()
            .zip(stored)
            .map(|(d, stored)| {
                state
                    .get_chat(&d.mls_group_id)
                    .map(|c| c.notification_level)
                    .or(*stored)
            })
            .collect()
    };
    let mut shown = 0;
    for (d, level) in due.iter().zip(levels) {
        let Some(level) = level else {
            continue;
        };
        let delivery =
            notification::emit_event_reminder(handle, level, REMINDER_DUE_EVENT, d, &banner_for(d));
        if delivery != ReminderDelivery::Silent {
            shown += 1;
        }
    }
    shown
}

/// One scan plus delivery. Skips quietly until an account database exists.
async fn scan_and_deliver<R: Runtime>(handle: &AppHandle<R>, unlocked_at_ms: i64) {
    let _guard = SCAN_LOCK.lock().await;
    let Ok(npub) = crate::account_manager::get_current_account() else {
        return;
    };
    let ready =
        crate::account_manager::get_database_path(handle, &npub).is_ok_and(|path| path.exists());
    if !ready {
        return;
    }
    let Ok(conn) = crate::account_manager::get_db_connection(handle) else {
        return;
    };
    let scanned = run_scan(&conn, &npub, now_ms(), unlocked_at_ms).and_then(|outcome| {
        let stored = outcome
            .due
            .iter()
            .map(|d| stored_notification_level(&conn, &d.mls_group_id))
            .collect::<Result<Vec<_>, _>>()?;
        Ok((outcome, stored))
    });
    crate::account_manager::return_db_connection(conn);
    let (outcome, stored) = match scanned {
        Ok(scanned) => scanned,
        Err(e) => {
            eprintln!("[SquadEventReminders] scan failed: {}", e);
            return;
        }
    };
    if outcome.missed + outcome.resolved > 0 {
        crate::catch_up::emit_catch_up_changed(handle);
    }
    let shown = deliver(handle, &outcome.due, &stored).await;
    if !outcome.due.is_empty() || outcome.missed + outcome.dropped + outcome.resolved > 0 {
        let due_ids: Vec<&str> = outcome.due.iter().map(|d| d.event_id.as_str()).collect();
        eprintln!(
            "[SquadEventReminders] due={:?} shown={} missed={} dropped={} resolved={}",
            due_ids, shown, outcome.missed, outcome.dropped, outcome.resolved
        );
    }
}

/// Unlock-scoped loop: immediate scan, then every interval. `None` before the app handle exists.
pub(crate) fn spawn_scan_loop(unlocked_at_ms: i64) -> Option<tauri::async_runtime::JoinHandle<()>> {
    let handle = crate::TAURI_APP.get()?.clone();
    Some(tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(SCAN_INTERVAL);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tick.tick().await;
            scan_and_deliver(&handle, unlocked_at_ms).await;
            crate::squad_record_privilege::spawn_drain_all_if_due(&handle);
        }
    }))
}

#[tauri::command]
pub async fn get_squad_event_reminder_prefs<R: Runtime>(
    handle: AppHandle<R>,
    event_id: String,
) -> Result<SquadEventReminderPrefs, String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let prefs = load_prefs(&conn, &event_id);
    crate::account_manager::return_db_connection(conn);
    prefs
}

/// Saves local prefs and reconciles now. Muting also resolves this event's missed reminders.
#[tauri::command]
pub async fn set_squad_event_reminder_prefs<R: Runtime>(
    handle: AppHandle<R>,
    event_id: String,
    lead_minutes: i64,
    muted: bool,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let saved = save_prefs(&conn, &event_id, lead_minutes, muted).and_then(|()| {
        if muted {
            crate::catch_up::resolve_event_reminder_entries(&conn, &event_id)
        } else {
            Ok(0)
        }
    });
    crate::account_manager::return_db_connection(conn);
    if saved? > 0 {
        crate::catch_up::emit_catch_up_changed(&handle);
    }
    if let Some(unlocked_at_ms) = crate::session::SESSION_MANAGER.reminder_unlocked_at_ms() {
        scan_and_deliver(&handle, unlocked_at_ms).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn resolve_squad_event_reminder_catch_up<R: Runtime>(
    handle: AppHandle<R>,
    event_id: String,
) -> Result<(), String> {
    let conn = crate::account_manager::get_db_connection(&handle)?;
    let resolved = crate::catch_up::resolve_event_reminder_entries(&conn, &event_id);
    crate::account_manager::return_db_connection(conn);
    if resolved? > 0 {
        crate::catch_up::emit_catch_up_changed(&handle);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::NotificationLevel;
    use crate::notification::severity::reminder_delivery;

    const ME: &str = "npub1me";
    const LOCATION: &str = "42 Hidden Lane";
    /// Fixed clock: 2027-01-15T08:00:00Z.
    const T0: i64 = 1_800_000_000_000;
    const MIN: i64 = 60_000;

    fn conn() -> rusqlite::Connection {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::migrations::run_migrations(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO mls_groups (group_id, creator_pubkey, created_at, updated_at, evicted)
             VALUES ('ann-group', 'npub1author', 0, 0, 0)",
            [],
        )
        .unwrap();
        conn
    }

    /// Schedules at T0, then the next unlock lands after the fire: one missed row. Returns that unlock.
    fn miss(conn: &rusqlite::Connection, start: i64) -> i64 {
        run_scan(conn, ME, T0, T0).unwrap();
        let unlock = start - 10 * MIN;
        let out = run_scan(conn, ME, unlock, unlock).unwrap();
        assert_eq!(out.missed, 1);
        unlock
    }

    fn insert_timed(conn: &rusqlite::Connection, id: &str, start_ms: i64) {
        conn.execute(
            "INSERT INTO squad_events (event_id, parent_id, mls_group_id, nip52_kind, title, start_unix,
                 start_tzid, place_kind, location, status, author_npub, created_at_ms, updated_at_ms,
                 updated_by_npub, content_hash)
             VALUES (?1, 'parent', 'ann-group', 31923, 'Squad sync', ?2, 'America/New_York', 'offline',
                 ?3, 'active', 'npub1author', 0, 0, 'npub1author', 'h')",
            rusqlite::params![id, start_ms / 1000, LOCATION],
        )
        .unwrap();
    }

    fn insert_all_day(conn: &rusqlite::Connection, id: &str, date: &str, tzid: &str) {
        conn.execute(
            "INSERT INTO squad_events (event_id, parent_id, mls_group_id, nip52_kind, title, start_date,
                 start_tzid, place_kind, location, status, author_npub, created_at_ms, updated_at_ms,
                 updated_by_npub, content_hash)
             VALUES (?1, 'parent', 'ann-group', 31922, 'Field day', ?2, ?3, 'offline', ?4, 'active',
                 'npub1author', 0, 0, 'npub1author', 'h')",
            rusqlite::params![id, date, tzid, LOCATION],
        )
        .unwrap();
    }

    fn rsvp(conn: &rusqlite::Connection, id: &str, npub: &str, status: &str) {
        conn.execute(
            "INSERT INTO squad_event_rsvps (event_id, member_npub, status, updated_at_ms, rumor_id)
             VALUES (?1, ?2, ?3, 0, 'r')
             ON CONFLICT(event_id, member_npub) DO UPDATE SET status = excluded.status",
            rusqlite::params![id, npub, status],
        )
        .unwrap();
    }

    fn set_start(conn: &rusqlite::Connection, id: &str, start_ms: i64) {
        conn.execute(
            "UPDATE squad_events SET start_unix = ?2 WHERE event_id = ?1",
            rusqlite::params![id, start_ms / 1000],
        )
        .unwrap();
    }

    fn fires(conn: &rusqlite::Connection, id: &str) -> Vec<(i64, String)> {
        let mut stmt = conn
            .prepare(
                "SELECT fire_at_ms, state FROM squad_event_reminders WHERE event_id = ?1 ORDER BY fire_at_ms",
            )
            .unwrap();
        stmt.query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    }

    fn scheduled(conn: &rusqlite::Connection, id: &str) -> Vec<i64> {
        fires(conn, id)
            .into_iter()
            .filter(|(_, s)| s == "scheduled")
            .map(|(f, _)| f)
            .collect()
    }

    fn catch_up_rows(conn: &rusqlite::Connection) -> Vec<(String, String, String, Option<i64>)> {
        let mut stmt = conn
            .prepare(
                "SELECT source_event_id, kind, chat_id, resolved_at FROM catch_up_entries ORDER BY source_event_id",
            )
            .unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    }

    #[test]
    fn going_lead_15_schedules_start_minus_15_minutes() {
        let conn = conn();
        let start = T0 + 60 * MIN;
        insert_timed(&conn, "ev", start);
        rsvp(&conn, "ev", ME, "accepted");

        let out = run_scan(&conn, ME, T0, T0).unwrap();
        assert!(out.due.is_empty());
        assert_eq!(scheduled(&conn, "ev"), vec![start - 15 * MIN]);
    }

    #[test]
    fn maybe_schedules_and_declined_or_no_rsvp_do_not() {
        let conn = conn();
        let start = T0 + 60 * MIN;
        for id in ["maybe", "declined", "none", "other"] {
            insert_timed(&conn, id, start);
        }
        rsvp(&conn, "maybe", ME, "tentative");
        rsvp(&conn, "declined", ME, "declined");
        rsvp(&conn, "other", "npub1someone", "accepted");

        run_scan(&conn, ME, T0, T0).unwrap();
        assert_eq!(scheduled(&conn, "maybe"), vec![start - 15 * MIN]);
        assert!(fires(&conn, "declined").is_empty());
        assert!(fires(&conn, "none").is_empty());
        assert!(fires(&conn, "other").is_empty());
    }

    #[test]
    fn declining_drops_the_pending_fire() {
        let conn = conn();
        insert_timed(&conn, "ev", T0 + 60 * MIN);
        rsvp(&conn, "ev", ME, "accepted");
        run_scan(&conn, ME, T0, T0).unwrap();

        rsvp(&conn, "ev", ME, "declined");
        let out = run_scan(&conn, ME, T0 + MIN, T0).unwrap();
        assert_eq!(out.dropped, 1);
        assert!(scheduled(&conn, "ev").is_empty());
    }

    #[test]
    fn muted_going_does_not_schedule_and_unmute_reschedules() {
        let conn = conn();
        let start = T0 + 60 * MIN;
        insert_timed(&conn, "ev", start);
        rsvp(&conn, "ev", ME, "accepted");
        run_scan(&conn, ME, T0, T0).unwrap();

        save_prefs(&conn, "ev", 15, true).unwrap();
        run_scan(&conn, ME, T0 + MIN, T0).unwrap();
        assert!(scheduled(&conn, "ev").is_empty());

        // Closed across the fire time while muted: no Catch up.
        let out = run_scan(&conn, ME, start - 5 * MIN, start - 6 * MIN).unwrap();
        assert_eq!(out.missed, 0);
        assert!(catch_up_rows(&conn).is_empty());

        save_prefs(&conn, "ev", 30, false).unwrap();
        run_scan(&conn, ME, T0 + 2 * MIN, T0).unwrap();
        assert_eq!(scheduled(&conn, "ev"), vec![start - 30 * MIN]);
    }

    #[test]
    fn cancel_drops_pending_and_missed_scan_inserts_no_catch_up() {
        let conn = conn();
        let start = T0 + 60 * MIN;
        insert_timed(&conn, "ev", start);
        rsvp(&conn, "ev", ME, "accepted");
        run_scan(&conn, ME, T0, T0).unwrap();
        assert_eq!(scheduled(&conn, "ev").len(), 1);

        conn.execute(
            "UPDATE squad_events SET status = 'cancelled' WHERE event_id = 'ev'",
            [],
        )
        .unwrap();
        // Next unlock after the fire time.
        let unlock = start - 5 * MIN;
        let out = run_scan(&conn, ME, unlock, unlock).unwrap();
        assert_eq!(out.dropped, 1);
        assert_eq!(out.missed, 0);
        assert!(out.due.is_empty());
        assert!(scheduled(&conn, "ev").is_empty());
        assert!(catch_up_rows(&conn).is_empty());
    }

    #[test]
    fn on_time_fire_is_due_once_without_catch_up() {
        let conn = conn();
        let start = T0 + 60 * MIN;
        insert_timed(&conn, "ev", start);
        rsvp(&conn, "ev", ME, "accepted");
        run_scan(&conn, ME, T0, T0).unwrap();

        let fire = start - 15 * MIN;
        let out = run_scan(&conn, ME, fire + 30_000, T0).unwrap();
        assert_eq!(out.due.len(), 1);
        assert_eq!(out.due[0].event_id, "ev");
        assert_eq!(out.due[0].mls_group_id, "ann-group");
        assert!(catch_up_rows(&conn).is_empty());
        assert_eq!(fires(&conn, "ev"), vec![(fire, "fired".to_string())]);

        let again = run_scan(&conn, ME, fire + 90_000, T0).unwrap();
        assert!(again.due.is_empty());
        assert!(catch_up_rows(&conn).is_empty());
    }

    #[test]
    fn lead_zero_fires_on_the_scan_after_the_start() {
        let conn = conn();
        let start = T0 + 60 * MIN;
        insert_timed(&conn, "ev", start);
        rsvp(&conn, "ev", ME, "accepted");
        save_prefs(&conn, "ev", 0, false).unwrap();

        let out = run_scan(&conn, ME, start + 30_000, T0).unwrap();
        assert_eq!(out.due.len(), 1);
    }

    #[test]
    fn on_time_delivery_decision_and_banner_have_no_location() {
        let conn = conn();
        let start = T0 + 60 * MIN;
        insert_timed(&conn, "ev", start);
        rsvp(&conn, "ev", ME, "accepted");
        let out = run_scan(&conn, ME, start - 10 * MIN, T0).unwrap();
        let due = &out.due[0];

        // Focused: in-app event; unfocused: banner; Nothing: neither.
        assert_eq!(
            reminder_delivery(NotificationLevel::Mentions, true),
            ReminderDelivery::InApp
        );
        assert_eq!(
            reminder_delivery(NotificationLevel::All, false),
            ReminderDelivery::Banner
        );
        assert_eq!(
            reminder_delivery(NotificationLevel::Nothing, true),
            ReminderDelivery::Silent
        );
        assert_eq!(
            reminder_delivery(NotificationLevel::Nothing, false),
            ReminderDelivery::Silent
        );

        let banner = banner_for(due);
        assert!(banner.body.contains("Squad sync"));
        assert!(banner.body.contains("starts "));
        assert!(!banner.body.contains(LOCATION));
        assert!(!banner.title.contains(LOCATION));

        let json = serde_json::to_value(due).unwrap();
        assert!(json.get("location").is_none());
        assert_eq!(json["eventId"], "ev");
        assert_eq!(json["mlsGroupId"], "ann-group");
        assert_eq!(json["startUnix"], start / 1000);
        assert!(!json.to_string().contains(LOCATION));
        assert!(catch_up_rows(&conn).is_empty());
    }

    #[test]
    fn unlock_after_fire_time_inserts_one_catch_up_and_no_banner() {
        let conn = conn();
        let start = T0 + 60 * MIN;
        insert_timed(&conn, "ev", start);
        rsvp(&conn, "ev", ME, "accepted");
        run_scan(&conn, ME, T0, T0).unwrap();

        let fire = start - 15 * MIN;
        let unlock = fire + 5 * MIN;
        let out = run_scan(&conn, ME, unlock, unlock).unwrap();
        assert!(out.due.is_empty());
        assert_eq!(out.missed, 1);
        let rows = catch_up_rows(&conn);
        assert_eq!(
            rows,
            vec![(
                format!("ev:{fire}"),
                "event_reminder".to_string(),
                "ann-group".to_string(),
                None
            )]
        );

        let second_unlock = unlock + 2 * MIN;
        let out = run_scan(&conn, ME, second_unlock, second_unlock).unwrap();
        assert!(out.due.is_empty());
        assert_eq!(out.missed, 0);
        assert_eq!(catch_up_rows(&conn).len(), 1);
    }

    #[test]
    fn edit_to_a_new_start_that_is_also_missed_adds_a_second_catch_up_row() {
        let conn = conn();
        let start = T0 + 60 * MIN;
        insert_timed(&conn, "ev", start);
        rsvp(&conn, "ev", ME, "accepted");
        let unlock = miss(&conn, start);

        // Edit arrives while open, then the app is closed across the new fire time.
        let new_start = start + 30 * MIN;
        set_start(&conn, "ev", new_start);
        run_scan(&conn, ME, unlock + MIN, unlock).unwrap();
        assert_eq!(scheduled(&conn, "ev"), vec![new_start - 15 * MIN]);
        let unlock2 = new_start - 10 * MIN;
        let out = run_scan(&conn, ME, unlock2, unlock2).unwrap();
        assert_eq!(out.missed, 1);
        assert!(out.due.is_empty());
        let ids: Vec<String> = catch_up_rows(&conn).into_iter().map(|r| r.0).collect();
        assert_eq!(
            ids,
            vec![
                format!("ev:{}", start - 15 * MIN),
                format!("ev:{}", new_start - 15 * MIN)
            ]
        );
    }

    #[test]
    fn moved_start_reschedules_without_catch_up_for_the_abandoned_time() {
        let conn = conn();
        let start = T0 + 60 * MIN;
        insert_timed(&conn, "ev", start);
        rsvp(&conn, "ev", ME, "accepted");
        run_scan(&conn, ME, T0, T0).unwrap();

        let new_start = start + 120 * MIN;
        set_start(&conn, "ev", new_start);
        let unlock = start; // old fire time passed while closed
        let out = run_scan(&conn, ME, unlock, unlock).unwrap();
        assert_eq!(out.missed, 0);
        assert!(catch_up_rows(&conn).is_empty());
        assert_eq!(scheduled(&conn, "ev"), vec![new_start - 15 * MIN]);
    }

    #[test]
    fn crossing_the_start_resolves_the_missed_entry() {
        let conn = conn();
        let start = T0 + 60 * MIN;
        insert_timed(&conn, "ev", start);
        rsvp(&conn, "ev", ME, "accepted");
        let unlock = miss(&conn, start);

        let out = run_scan(&conn, ME, start + 1, unlock).unwrap();
        assert_eq!(out.resolved, 1);
        assert!(catch_up_rows(&conn)[0].3.is_some());
    }

    #[test]
    fn resolve_by_event_id_clears_its_missed_entries() {
        let conn = conn();
        let start = T0 + 60 * MIN;
        insert_timed(&conn, "ev", start);
        rsvp(&conn, "ev", ME, "accepted");
        let unlock = miss(&conn, start);

        assert_eq!(
            crate::catch_up::resolve_event_reminder_entries(&conn, "ev").unwrap(),
            1
        );
        assert!(catch_up_rows(&conn)[0].3.is_some());
        // Still handled: a later unlock does not reopen or re-insert.
        run_scan(&conn, ME, unlock + MIN, unlock + MIN).unwrap();
        assert_eq!(catch_up_rows(&conn).len(), 1);
        assert!(catch_up_rows(&conn)[0].3.is_some());
    }

    #[test]
    fn all_day_new_york_lead_15_fires_at_0845_local() {
        let conn = conn();
        insert_all_day(&conn, "day", "2027-03-10", "America/New_York");
        rsvp(&conn, "day", ME, "accepted");

        run_scan(&conn, ME, T0, T0).unwrap();
        let expected =
            crate::squad_event_time::civil_to_unix("2027-03-10T08:45", "America/New_York").unwrap()
                * 1000;
        assert_eq!(scheduled(&conn, "day"), vec![expected]);
    }

    #[test]
    fn catch_up_row_carries_no_title_or_location() {
        let conn = conn();
        let start = T0 + 60 * MIN;
        insert_timed(&conn, "ev", start);
        rsvp(&conn, "ev", ME, "accepted");
        miss(&conn, start);

        let columns: Vec<String> = conn
            .prepare("PRAGMA table_info(catch_up_entries)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert!(!columns.iter().any(|c| c == "title" || c == "location"));
        let row = format!("{:?}", catch_up_rows(&conn));
        assert!(!row.contains("Squad sync"));
        assert!(!row.contains(LOCATION));
    }

    #[test]
    fn prefs_default_and_validate_lead() {
        let conn = conn();
        assert_eq!(
            load_prefs(&conn, "ev").unwrap(),
            SquadEventReminderPrefs::default()
        );
        assert_eq!(SquadEventReminderPrefs::default().lead_minutes, 15);
        assert!(save_prefs(&conn, "ev", -1, false).is_err());
        assert!(save_prefs(&conn, "ev", MAX_LEAD_MINUTES + 1, false).is_err());
        save_prefs(&conn, "ev", MAX_LEAD_MINUTES, true).unwrap();
        assert_eq!(
            load_prefs(&conn, "ev").unwrap(),
            SquadEventReminderPrefs {
                lead_minutes: MAX_LEAD_MINUTES,
                muted: true
            }
        );
        let json = serde_json::to_value(load_prefs(&conn, "ev").unwrap()).unwrap();
        assert_eq!(json["leadMinutes"], MAX_LEAD_MINUTES);
        assert_eq!(json["muted"], true);
    }

    #[test]
    fn past_rows_are_pruned_after_the_start() {
        let conn = conn();
        let start = T0 + 60 * MIN;
        insert_timed(&conn, "ev", start);
        rsvp(&conn, "ev", ME, "accepted");
        run_scan(&conn, ME, start - 10 * MIN, T0).unwrap();
        run_scan(&conn, ME, start + START_GRACE_MS, T0).unwrap();
        assert!(fires(&conn, "ev").is_empty());
    }

    #[test]
    fn going_after_unlock_inside_the_lead_is_on_time_without_catch_up() {
        let conn = conn();
        let start = T0 + 60 * MIN;
        insert_timed(&conn, "ev", start);
        let unlock = T0;
        run_scan(&conn, ME, unlock, unlock).unwrap();

        rsvp(&conn, "ev", ME, "accepted");
        let out = run_scan(&conn, ME, start - 10 * MIN, unlock).unwrap();
        assert_eq!(out.due.len(), 1);
        assert_eq!(out.missed, 0);
        assert!(catch_up_rows(&conn).is_empty());
    }

    #[test]
    fn fire_first_seen_after_unlock_with_start_ahead_is_on_time() {
        let conn = conn();
        let start = T0 + 60 * MIN;
        insert_timed(&conn, "ev", start);
        rsvp(&conn, "ev", ME, "accepted");
        // Never scheduled before this unlock (e.g. event synced in after the fire time).
        let unlock = start - 10 * MIN;
        let out = run_scan(&conn, ME, unlock, unlock).unwrap();
        assert_eq!(out.due.len(), 1);
        assert_eq!(out.missed, 0);
        assert!(catch_up_rows(&conn).is_empty());
    }

    #[test]
    fn raising_the_lead_after_a_fire_does_not_fire_again() {
        let conn = conn();
        let start = T0 + 60 * MIN;
        insert_timed(&conn, "ev", start);
        rsvp(&conn, "ev", ME, "accepted");
        run_scan(&conn, ME, T0, T0).unwrap();
        let out = run_scan(&conn, ME, start - 14 * MIN, T0).unwrap();
        assert_eq!(out.due.len(), 1);

        save_prefs(&conn, "ev", 30, false).unwrap();
        let out = run_scan(&conn, ME, start - 13 * MIN, T0).unwrap();
        assert!(out.due.is_empty());
        assert!(catch_up_rows(&conn).is_empty());
    }

    #[test]
    fn evicted_or_unknown_group_drops_pending_and_never_fires() {
        let conn = conn();
        let start = T0 + 60 * MIN;
        insert_timed(&conn, "ev", start);
        rsvp(&conn, "ev", ME, "accepted");
        run_scan(&conn, ME, T0, T0).unwrap();
        assert_eq!(scheduled(&conn, "ev").len(), 1);

        conn.execute(
            "UPDATE mls_groups SET evicted = 1 WHERE group_id = 'ann-group'",
            [],
        )
        .unwrap();
        let out = run_scan(&conn, ME, T0 + MIN, T0).unwrap();
        assert_eq!(out.dropped, 1);
        assert!(scheduled(&conn, "ev").is_empty());
        let unlock = start - 10 * MIN;
        let out = run_scan(&conn, ME, unlock, unlock).unwrap();
        assert!(out.due.is_empty());
        assert_eq!(out.missed, 0);

        conn.execute("DELETE FROM mls_groups", []).unwrap();
        let out = run_scan(&conn, ME, unlock + MIN, T0).unwrap();
        assert!(out.due.is_empty());
    }

    #[test]
    fn stored_level_is_read_from_chats_and_unknown_is_none() {
        let conn = conn();
        assert_eq!(stored_notification_level(&conn, "ann-group").unwrap(), None);
        conn.execute(
            "INSERT INTO chats (chat_identifier, chat_type, participants, created_at, notification_level)
             VALUES ('ann-group', 1, '[]', 0, 'nothing')",
            [],
        )
        .unwrap();
        assert_eq!(
            stored_notification_level(&conn, "ann-group").unwrap(),
            Some(NotificationLevel::Nothing)
        );
    }
}
