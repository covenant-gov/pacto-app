use alloy::primitives::Address;

pub fn parse_address(s: &str) -> Result<Address, String> {
    let t = s.trim();
    let h = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")).unwrap_or(t);
    if h.len() != 40 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("invalid EVM address".into());
    }
    let mut b = [0u8; 20];
    for i in 0..20 {
        b[i] = u8::from_str_radix(&h[i * 2..i * 2 + 2], 16)
            .map_err(|_| "invalid EVM address".to_string())?;
    }
    Ok(Address::from(b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_address_valid_with_prefix() {
        let a = parse_address("0x0000000000000000000000000000000000000001").unwrap();
        assert_eq!(a, Address::from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]));
    }

    #[test]
    fn parse_address_valid_without_prefix() {
        let a = parse_address("0000000000000000000000000000000000000001").unwrap();
        assert_eq!(a, Address::from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]));
    }

    #[test]
    fn parse_address_uppercase_prefix() {
        let a = parse_address("0Xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").unwrap();
        let b = parse_address("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn parse_address_trims_whitespace() {
        let a = parse_address("  0x0000000000000000000000000000000000000001  ").unwrap();
        assert_eq!(a, Address::from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]));
    }

    #[test]
    fn parse_address_rejects_wrong_length() {
        assert!(parse_address("0x123").is_err());
        assert!(parse_address("0x").is_err());
        assert!(parse_address("0x0000000000000000000000000000000000000001a").is_err());
    }

    #[test]
    fn parse_address_rejects_non_hex() {
        assert!(parse_address("0xgggggggggggggggggggggggggggggggggggggggg").is_err());
    }

    #[test]
    fn parse_address_rejects_empty() {
        assert!(parse_address("").is_err());
        assert!(parse_address("   ").is_err());
    }
}
