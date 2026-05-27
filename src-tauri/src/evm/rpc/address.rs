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
