//! Civil-time conversions for squad events (IANA zones from the bundled tz database).

use chrono::{Days, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, TimeDelta, TimeZone};
use chrono_tz::Tz;

const LOCAL_FORMAT: &str = "%Y-%m-%dT%H:%M";
const DATE_FORMAT: &str = "%Y-%m-%d";
/// Upper bound on a DST gap walk; real gaps are at most a day.
const MAX_GAP_MINUTES: i64 = 26 * 60;

pub fn validate_tzid(tzid: &str) -> Result<(), String> {
    parse_tz(tzid).map(|_| ())
}

/// Civil "YYYY-MM-DDTHH:MM" in tzid -> unix seconds. DST gap: first valid instant after the gap. Ambiguous: earlier offset.
pub fn civil_to_unix(local: &str, tzid: &str) -> Result<i64, String> {
    let tz = parse_tz(tzid)?;
    resolve(&tz, parse_local(local)?)
}

/// `count` starts, each 7 civil days after the previous at the same wall clock in tzid (gap/ambiguity rules above).
pub fn weekly_timed_starts(local: &str, tzid: &str, count: usize) -> Result<Vec<i64>, String> {
    let tz = parse_tz(tzid)?;
    let first = parse_local(local)?;
    (0..count)
        .map(|i| {
            let naive = first
                .checked_add_days(weeks(i)?)
                .ok_or_else(|| "date out of range".to_string())?;
            resolve(&tz, naive)
        })
        .collect()
}

/// `count` dates "YYYY-MM-DD", 7 days apart.
pub fn weekly_all_day_dates(date: &str, count: usize) -> Result<Vec<String>, String> {
    let first = parse_date(date)?;
    (0..count)
        .map(|i| {
            first
                .checked_add_days(weeks(i)?)
                .map(|d| d.format(DATE_FORMAT).to_string())
                .ok_or_else(|| "date out of range".to_string())
        })
        .collect()
}

/// Unix seconds for HH:MM on civil `date` in `tzid`; `None` tzid = system zone.
pub fn civil_date_time_to_unix(
    date: &str,
    hour: u32,
    minute: u32,
    tzid: Option<&str>,
) -> Result<i64, String> {
    let time =
        NaiveTime::from_hms_opt(hour, minute, 0).ok_or_else(|| "invalid time".to_string())?;
    let naive = parse_date(date)?.and_time(time);
    match tzid {
        Some(tzid) => resolve(&parse_tz(tzid)?, naive),
        None => resolve(&chrono::Local, naive),
    }
}

fn parse_tz(tzid: &str) -> Result<Tz, String> {
    tzid.parse::<Tz>()
        .map_err(|_| format!("unknown time zone: {tzid}"))
}

fn parse_local(local: &str) -> Result<NaiveDateTime, String> {
    NaiveDateTime::parse_from_str(local, LOCAL_FORMAT)
        .map_err(|_| "expected local time YYYY-MM-DDTHH:MM".to_string())
}

fn parse_date(date: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(date, DATE_FORMAT).map_err(|_| "expected date YYYY-MM-DD".to_string())
}

fn weeks(i: usize) -> Result<Days, String> {
    u64::try_from(i)
        .ok()
        .and_then(|i| i.checked_mul(7))
        .map(Days::new)
        .ok_or_else(|| "too many occurrences".to_string())
}

/// Ambiguous: earlier instant. Gap: first valid wall clock after it, which is the transition instant.
fn resolve<Z: TimeZone>(tz: &Z, naive: NaiveDateTime) -> Result<i64, String> {
    let mut candidate = naive;
    for _ in 0..=MAX_GAP_MINUTES {
        match tz.from_local_datetime(&candidate) {
            LocalResult::Single(dt) => return Ok(dt.timestamp()),
            LocalResult::Ambiguous(a, b) => return Ok(a.timestamp().min(b.timestamp())),
            LocalResult::None => {
                candidate = candidate
                    .checked_add_signed(TimeDelta::minutes(1))
                    .ok_or_else(|| "date out of range".to_string())?;
            }
        }
    }
    Err("local time does not exist in this time zone".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    const NY: &str = "America/New_York";

    fn utc(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> i64 {
        Utc.with_ymd_and_hms(y, mo, d, h, mi, 0)
            .unwrap()
            .timestamp()
    }

    #[test]
    fn unknown_tzid_is_rejected() {
        assert!(validate_tzid("Mars/Olympus_Mons").is_err());
        assert!(validate_tzid("").is_err());
        assert!(civil_to_unix("2026-03-08T09:00", "Nope/Zone").is_err());
        assert!(validate_tzid(NY).is_ok());
    }

    #[test]
    fn plain_local_time_converts() {
        assert_eq!(
            civil_to_unix("2026-01-15T09:00", NY),
            Ok(utc(2026, 1, 15, 14, 0))
        );
    }

    #[test]
    fn dst_gap_moves_to_first_valid_instant() {
        assert_eq!(
            civil_to_unix("2026-03-08T02:30", NY),
            Ok(utc(2026, 3, 8, 7, 0))
        );
        assert_eq!(
            civil_to_unix("2026-03-08T02:00", NY),
            Ok(utc(2026, 3, 8, 7, 0))
        );
    }

    #[test]
    fn ambiguous_time_takes_earlier_offset() {
        assert_eq!(
            civil_to_unix("2026-11-01T01:30", NY),
            Ok(utc(2026, 11, 1, 5, 30))
        );
    }

    #[test]
    fn weekly_series_keeps_wall_clock_across_spring_forward() {
        let starts = weekly_timed_starts("2026-03-01T09:00", NY, 3).unwrap();
        assert_eq!(
            starts,
            vec![
                utc(2026, 3, 1, 14, 0),
                utc(2026, 3, 8, 13, 0),
                utc(2026, 3, 15, 13, 0)
            ]
        );
        let tz: Tz = NY.parse().unwrap();
        for s in starts {
            let local = tz.timestamp_opt(s, 0).unwrap().naive_local();
            assert_eq!(local.time(), NaiveTime::from_hms_opt(9, 0, 0).unwrap());
        }
    }

    #[test]
    fn weekly_series_occurrence_in_gap_uses_gap_rule() {
        let starts = weekly_timed_starts("2026-03-01T02:30", NY, 2).unwrap();
        assert_eq!(starts, vec![utc(2026, 3, 1, 7, 30), utc(2026, 3, 8, 7, 0)]);
    }

    #[test]
    fn weekly_all_day_dates_step_seven_days() {
        assert_eq!(
            weekly_all_day_dates("2026-12-24", 3).unwrap(),
            vec!["2026-12-24", "2026-12-31", "2027-01-07"]
        );
        assert!(weekly_all_day_dates("2026-13-01", 1).is_err());
        assert!(weekly_all_day_dates("2026-12-24", 0).unwrap().is_empty());
    }

    #[test]
    fn civil_date_time_in_named_zone() {
        assert_eq!(
            civil_date_time_to_unix("2026-03-08", 9, 0, Some(NY)),
            Ok(utc(2026, 3, 8, 13, 0))
        );
        assert!(civil_date_time_to_unix("2026-03-08", 24, 0, Some(NY)).is_err());
        assert!(civil_date_time_to_unix("2026-03-08", 9, 0, Some("Bad/Zone")).is_err());
    }

    #[test]
    fn civil_date_time_in_system_zone() {
        assert!(civil_date_time_to_unix("2026-03-08", 9, 0, None).is_ok());
    }

    #[test]
    fn malformed_local_time_is_rejected() {
        assert!(civil_to_unix("2026-03-08 09:00", NY).is_err());
        assert!(civil_to_unix("2026-03-08", NY).is_err());
    }
}
