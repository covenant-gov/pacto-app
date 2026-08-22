use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WalletOpError {
    code: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    npub: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tx_hash: Option<String>,
}

/// MutinyModule_NoActiveMutiny()
const SEL_MUTINY_NOT_ACTIVE: &str = "c4aedfdd";
/// MutinyModule_NotExpired(uint256,uint256)
const SEL_MUTINY_NOT_EXPIRED: &str = "06dc7f6f";
/// MutinyModule_Expired(uint256)
const SEL_MUTINY_EXPIRED: &str = "42af4065";

pub fn wallet_err_json(code: &str, message: impl Into<String>, npub: Option<String>) -> String {
    serde_json::to_string(&WalletOpError {
        code: code.to_string(),
        message: message.into(),
        npub,
        tx_hash: None,
    })
    .unwrap_or_else(|_| r#"{"code":"INTERNAL","message":"serialize"}"#.to_string())
}

pub fn wallet_err_json_with_tx_hash(
    code: &str,
    message: impl Into<String>,
    npub: Option<String>,
    tx_hash: String,
) -> String {
    serde_json::to_string(&WalletOpError {
        code: code.to_string(),
        message: message.into(),
        npub,
        tx_hash: Some(tx_hash),
    })
    .unwrap_or_else(|_| r#"{"code":"INTERNAL","message":"serialize"}"#.to_string())
}

/// First 4-byte revert selector in `raw`, if any (`data: '0x…'` preferred).
pub fn extract_revert_selector(raw: &str) -> Option<String> {
    let lower = raw.to_ascii_lowercase();
    const MARKERS: &[&str] = &[
        "data: '0x",
        "data: \"0x",
        "data:'0x",
        "data:\"0x",
        "revertdata\":\"0x",
        "revert_data\":\"0x",
    ];
    for marker in MARKERS {
        if let Some(i) = lower.find(marker) {
            let hex: String = lower[i + marker.len()..].chars().take(8).collect();
            if hex.len() == 8 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
                return Some(hex);
            }
        }
    }
    if let Some(i) = lower.find("0x") {
        let hex: String = lower[i + 2..].chars().take(8).collect();
        if hex.len() == 8 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(hex);
        }
    }
    None
}

/// Known pacto-gov revert → structured code. `None` if unrecognized.
pub fn classify_gov_call_revert(raw: &str) -> Option<(&'static str, &'static str)> {
    let lower = raw.to_ascii_lowercase();
    if let Some(sel) = extract_revert_selector(&lower) {
        match sel.as_str() {
            SEL_MUTINY_NOT_ACTIVE => {
                return Some(("MUTINY_NOT_ACTIVE", "no active mutiny matching this id"));
            }
            SEL_MUTINY_NOT_EXPIRED => {
                return Some(("MUTINY_NOT_EXPIRED", "mutiny voting window is still open"));
            }
            SEL_MUTINY_EXPIRED => {
                return Some(("MUTINY_EXPIRED", "mutiny deadline has passed"));
            }
            _ => {}
        }
    }
    if lower.contains("mutinymodule_noactivemutiny") {
        return Some(("MUTINY_NOT_ACTIVE", "no active mutiny matching this id"));
    }
    if lower.contains("mutinymodule_notexpired") {
        return Some(("MUTINY_NOT_EXPIRED", "mutiny voting window is still open"));
    }
    if lower.contains("mutinymodule_expired") {
        return Some(("MUTINY_EXPIRED", "mutiny deadline has passed"));
    }
    None
}

/// EOA `eth_estimateGas` / send failure: known revert, generic revert, or raw SEND_FAILED.
pub fn wallet_err_from_send_failure(redacted: &str) -> String {
    if let Some((code, msg)) = classify_gov_call_revert(redacted) {
        return wallet_err_json(code, msg, None);
    }
    if redacted.to_ascii_lowercase().contains("execution reverted") {
        return wallet_err_json("GOV_CALL_REVERTED", "call reverted on-chain", None);
    }
    wallet_err_json("SEND_FAILED", redacted, None)
}

#[cfg(test)]
mod tests {
    use super::{classify_gov_call_revert, extract_revert_selector, wallet_err_from_send_failure};

    #[test]
    fn extract_selector_from_alloy_data_field() {
        let raw =
            "server returned an error response: error code 3: execution reverted, data: '0xc4aedfdd'";
        assert_eq!(extract_revert_selector(raw).as_deref(), Some("c4aedfdd"));
    }

    #[test]
    fn classify_mutiny_trio_selectors() {
        assert_eq!(
            classify_gov_call_revert("data: '0xc4aedfdd'").map(|p| p.0),
            Some("MUTINY_NOT_ACTIVE")
        );
        assert_eq!(
            classify_gov_call_revert("data: '0x06dc7f6f'").map(|p| p.0),
            Some("MUTINY_NOT_EXPIRED")
        );
        assert_eq!(
            classify_gov_call_revert("data: '0x42af4065'").map(|p| p.0),
            Some("MUTINY_EXPIRED")
        );
        assert_eq!(
            classify_gov_call_revert("reason: MutinyModule_Expired").map(|p| p.0),
            Some("MUTINY_EXPIRED")
        );
        assert!(classify_gov_call_revert("data: '0xdeadbeef'").is_none());
    }

    #[test]
    fn send_failure_maps_known_and_unknown_reverts() {
        let known = wallet_err_from_send_failure(
            "server returned an error response: error code 3: execution reverted, data: '0xc4aedfdd'",
        );
        assert!(known.contains("MUTINY_NOT_ACTIVE"));
        assert!(!known.contains("0xc4aedfdd"));

        let unknown = wallet_err_from_send_failure(
            "server returned an error response: error code 3: execution reverted, data: '0xdeadbeef'",
        );
        assert!(unknown.contains("GOV_CALL_REVERTED"));
        assert!(!unknown.contains("deadbeef"));

        let other = wallet_err_from_send_failure("nonce too low");
        assert!(other.contains("SEND_FAILED"));
    }
}
