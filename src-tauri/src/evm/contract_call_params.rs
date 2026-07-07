//! Shared parsing for opaque contract call commands (Advanced + squad allowlisted).

use alloy::primitives::U256;

pub fn parse_data_hex(raw: &str) -> Result<Vec<u8>, String> {
    let t = raw.trim();
    if t.is_empty() || t.eq_ignore_ascii_case("0x") {
        return Ok(Vec::new());
    }
    let h = t
        .strip_prefix("0x")
        .or_else(|| t.strip_prefix("0X"))
        .unwrap_or(t);
    if h.len() % 2 != 0 {
        return Err("Calldata hex must have an even number of digits.".to_string());
    }
    if !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Calldata contains non-hex characters.".to_string());
    }
    hex::decode(h).map_err(|_| "Invalid calldata hex.".to_string())
}

pub fn parse_value_wei(raw: &str) -> Result<U256, String> {
    let t = raw.trim();
    if t.is_empty() {
        return Ok(U256::ZERO);
    }
    U256::from_str_radix(t, 10)
        .map_err(|_| "valueWei must be a non-negative decimal wei string.".to_string())
}

#[cfg(test)]
mod tests {
    use super::{parse_data_hex, parse_value_wei};
    use alloy::primitives::U256;

    #[test]
    fn parse_data_hex_accepts_empty_and_prefixed() {
        assert!(parse_data_hex("").unwrap().is_empty());
        assert_eq!(parse_data_hex("0xdeadbeef").unwrap(), vec![0xde, 0xad, 0xbe, 0xef]);
    }

    #[test]
    fn parse_value_wei_decimal() {
        assert_eq!(parse_value_wei("1000").unwrap(), U256::from(1000u64));
    }

    #[test]
    fn parse_value_wei_empty_is_zero() {
        assert_eq!(parse_value_wei("").unwrap(), U256::ZERO);
        assert_eq!(parse_value_wei("   ").unwrap(), U256::ZERO);
    }

    #[test]
    fn parse_value_wei_rejects_negative() {
        assert!(parse_value_wei("-1").is_err());
    }

    #[test]
    fn parse_value_wei_rejects_hex() {
        assert!(parse_value_wei("0x1a").is_err());
    }

    #[test]
    fn parse_data_hex_rejects_odd_length() {
        assert!(parse_data_hex("0xabc").is_err());
    }

    #[test]
    fn parse_data_hex_rejects_non_hex() {
        assert!(parse_data_hex("0xzz").is_err());
    }

    #[test]
    fn parse_data_hex_uppercase_prefix_and_case() {
        assert_eq!(parse_data_hex("0XDEADBEEF").unwrap(), vec![0xde, 0xad, 0xbe, 0xef]);
    }

    #[test]
    fn parse_data_hex_zero_prefix_returns_empty() {
        assert!(parse_data_hex("0x").unwrap().is_empty());
        assert!(parse_data_hex("0X").unwrap().is_empty());
    }
}
