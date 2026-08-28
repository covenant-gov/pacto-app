use alloy::primitives::U256;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const RECEIPT_WAIT_TIMEOUT: Duration = Duration::from_secs(180);

pub fn parse_salt_nonce(raw: Option<String>) -> Result<U256, String> {
    let Some(s) = raw.filter(|x| !x.trim().is_empty()) else {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "system time before UNIX epoch".to_string())?
            .as_nanos();
        return Ok(U256::from(nanos));
    };
    let t = s.trim();
    if let Some(h) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
        return U256::from_str_radix(h, 16).map_err(|_| "invalid salt_nonce hex".to_string());
    }
    U256::from_str_radix(t, 10).map_err(|_| "invalid salt_nonce decimal".to_string())
}
