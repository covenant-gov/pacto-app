//! Normalized virtual bucket for MLS default channels
//! (`announcements` | `inbox` | `polls` | `join_requests`).
//! Mirrors `docs/mls/VIRTUAL_CHANNEL_ROUTING_ADR.md` for SQLite persistence and list APIs.

use crate::stored_event::event_kind;

fn is_valid_virtual_bucket(v: &str) -> bool {
    matches!(v, "announcements" | "inbox" | "polls" | "join_requests")
}

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
        if is_valid_virtual_bucket(v) {
            return Some(v.to_string());
        }
    }

    let trimmed = content.trim();
    if trimmed.starts_with('{') {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(vb) = val.get("pacto_virtual_bucket").and_then(|x| x.as_str()) {
                if is_valid_virtual_bucket(vb) {
                    return Some(vb.to_string());
                }
            }
            if val.get("schema").and_then(|x| x.as_str()) == Some("pacto.dashboard_poll.v1")
                && val.get("action").and_then(|x| x.as_str()) == Some("vote")
            {
                return Some("polls".to_string());
            }
            let schema = val.get("schema").and_then(|x| x.as_str());
            if matches!(
                schema,
                Some("pacto.squad.join_request.v1" | "pacto.squad.join_request_response.v1")
            ) {
                return Some("join_requests".to_string());
            }
            if matches!(
                schema,
                Some("pacto.squad_bot.meta.v1" | "pacto.squad_bot.key_rotated.v1")
            ) {
                return Some("announcements".to_string());
            }
            if schema == Some("pacto.squad_bot.rotate_prompt.v1") {
                return Some("inbox".to_string());
            }
            let ty = val.get("type").and_then(|x| x.as_str());
            if ty == Some("dashboard_poll_created") {
                return Some("announcements".to_string());
            }
            if ty == Some("governance_updated") {
                let public_gov = val
                    .get("payload")
                    .and_then(|p| p.get("provider"))
                    .and_then(|x| x.as_str())
                    .map(|s| {
                        let p = s.trim();
                        p.eq_ignore_ascii_case("sponsor") || p.eq_ignore_ascii_case("pacto_gov")
                    })
                    .unwrap_or(false);
                return Some(if public_gov {
                    "announcements".to_string()
                } else {
                    "inbox".to_string()
                });
            }
            if matches!(ty, Some("squad_safe_updated" | "safe_proposal")) {
                return Some("inbox".to_string());
            }
            if ty == Some("squad_member_evm_share") {
                return Some("announcements".to_string());
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
    fn pacto_gov_governance_announce_derives_announcements_bucket() {
        let content = r#"{"type":"governance_updated","payload":{"parent_id":"p","provider":"pacto_gov","canonical_ref":"1"}}"#;
        let bucket = normalize_virtual_bucket_for_message(
            event_kind::PRIVATE_DIRECT_MESSAGE,
            content,
            &[],
        );
        assert_eq!(bucket.as_deref(), Some("announcements"));
    }

    #[test]
    fn non_public_governance_announce_derives_inbox_bucket() {
        let content = r#"{"type":"governance_updated","payload":{"parent_id":"p","provider":"gnosis_safe","canonical_ref":"0x1"}}"#;
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
    fn squad_member_evm_share_derives_announcements_bucket() {
        let content = r#"{"type":"squad_member_evm_share","payload":{"parent_id":"p","evm_address":"0x1"}}"#;
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

    #[test]
    fn join_request_schema_derives_join_requests_bucket() {
        let content = r#"{"schema":"pacto.squad.join_request.v1","requestId":"r1","squadId":"s","status":"pending"}"#;
        let bucket = normalize_virtual_bucket_for_message(
            event_kind::PRIVATE_DIRECT_MESSAGE,
            content,
            &[],
        );
        assert_eq!(bucket.as_deref(), Some("join_requests"));
    }

    #[test]
    fn explicit_join_requests_field_wins() {
        let content = r#"{"pacto_virtual_bucket":"join_requests","schema":"pacto.squad.join_request_response.v1"}"#;
        let bucket = normalize_virtual_bucket_for_message(
            event_kind::PRIVATE_DIRECT_MESSAGE,
            content,
            &[],
        );
        assert_eq!(bucket.as_deref(), Some("join_requests"));
    }

    #[test]
    fn squad_bot_meta_derives_announcements_bucket() {
        let content = r#"{"schema":"pacto.squad_bot.meta.v1","botNpub":"npub1x","keyEpoch":1}"#;
        let bucket = normalize_virtual_bucket_for_message(
            event_kind::PRIVATE_DIRECT_MESSAGE,
            content,
            &[],
        );
        assert_eq!(bucket.as_deref(), Some("announcements"));
    }
}
