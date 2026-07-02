//! Normalized virtual bucket for MLS default channels (`announcements` | `inbox` | `polls`).
//! Mirrors `docs/mls/VIRTUAL_CHANNEL_ROUTING_ADR.md` for SQLite persistence and list APIs.

use crate::stored_event::event_kind;

/// Resolve persisted bucket for timeline message kinds (14, 15, 30078). Other kinds return `None`.
pub fn normalize_virtual_bucket_for_message(kind: u16, content: &str, tags: &[Vec<String>]) -> Option<String> {
    if kind != event_kind::PRIVATE_DIRECT_MESSAGE
        && kind != event_kind::FILE_ATTACHMENT
        && kind != event_kind::APPLICATION_SPECIFIC
    {
        return None;
    }

    if let Some(v) = tags
        .iter()
        .find(|t| t.first().map(|s| s.as_str()) == Some("pacto_bucket"))
        .and_then(|t| t.get(1).map(|s| s.as_str()))
    {
        if matches!(v, "announcements" | "inbox" | "polls") {
            return Some(v.to_string());
        }
    }

    let trimmed = content.trim();
    if trimmed.starts_with('{') {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(vb) = val.get("pacto_virtual_bucket").and_then(|x| x.as_str()) {
                if matches!(vb, "announcements" | "inbox" | "polls") {
                    return Some(vb.to_string());
                }
            }
            if val.get("schema").and_then(|x| x.as_str()) == Some("pacto.dashboard_poll.v1")
                && val.get("action").and_then(|x| x.as_str()) == Some("vote")
            {
                return Some("polls".to_string());
            }
            let ty = val.get("type").and_then(|x| x.as_str());
            if ty == Some("dashboard_poll_created") {
                return Some("announcements".to_string());
            }
            if ty == Some("governance_updated") {
                let sponsor = val
                    .get("payload")
                    .and_then(|p| p.get("provider"))
                    .and_then(|x| x.as_str())
                    .map(|s| s.trim().eq_ignore_ascii_case("sponsor"))
                    .unwrap_or(false);
                return Some(if sponsor {
                    "announcements".to_string()
                } else {
                    "inbox".to_string()
                });
            }
            if matches!(ty, Some("squad_safe_updated" | "safe_proposal" | "squad_member_evm_share")) {
                return Some("inbox".to_string());
            }
        }
    }

    if tags.iter().any(|t| {
        t.first().map(|s| s.as_str()) == Some("d")
            && t.get(1).map(|s| s.as_str()) == Some(crate::dashboard_poll::DASHBOARD_POLL_D_TAG)
    }) {
        if trimmed.starts_with('{') {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
                if val.get("schema").and_then(|x| x.as_str()) == Some("pacto.dashboard_poll.v1")
                    && val.get("action").and_then(|x| x.as_str()) == Some("vote")
                {
                    return Some("polls".to_string());
                }
                if val.get("type").and_then(|x| x.as_str()) == Some("dashboard_poll_created") {
                    return Some("announcements".to_string());
                }
            }
        }
        return Some("polls".to_string());
    }

    Some("announcements".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stored_event::event_kind;

    #[test]
    fn governance_announce_derives_inbox_bucket() {
        let content = r#"{"type":"governance_updated","payload":{"parent_id":"p","provider":"pacto_gov","canonical_ref":"1"}}"#;
        let bucket = normalize_virtual_bucket_for_message(
            event_kind::PRIVATE_DIRECT_MESSAGE,
            content,
            &[],
        );
        assert_eq!(bucket.as_deref(), Some("inbox"));
    }

    #[test]
    fn sponsor_governance_announce_derives_announcements_bucket() {
        let content = r#"{"type":"governance_updated","payload":{"parent_id":"p","provider":"sponsor","canonical_ref":"0x1"}}"#;
        let bucket = normalize_virtual_bucket_for_message(
            event_kind::PRIVATE_DIRECT_MESSAGE,
            content,
            &[],
        );
        assert_eq!(bucket.as_deref(), Some("announcements"));
    }

    #[test]
    fn explicit_inbox_field_wins() {
        let content = r#"{"pacto_virtual_bucket":"inbox","type":"note"}"#;
        let bucket = normalize_virtual_bucket_for_message(
            event_kind::PRIVATE_DIRECT_MESSAGE,
            content,
            &[],
        );
        assert_eq!(bucket.as_deref(), Some("inbox"));
    }

    #[test]
    fn dashboard_poll_created_derives_announcements_bucket() {
        let content = r#"{"type":"dashboard_poll_created","payload":{"parent_id":"p","poll_id":"poll","title":"T","options":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}}"#;
        let bucket = normalize_virtual_bucket_for_message(
            event_kind::APPLICATION_SPECIFIC,
            content,
            &[],
        );
        assert_eq!(bucket.as_deref(), Some("announcements"));
    }
}
