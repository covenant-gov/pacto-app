//! Client-side SquadAdmin privilege role `bytes32` packing (pacto-gov SquadAdmin.md v1).

use alloy::primitives::B256;

pub const PRIVILEGE_ROLE_ENCODING_VERSION: u8 = 1;
pub const PRIVILEGE_ROLE_NAME_MAX_BYTES: usize = 28;

pub const FLAG_INVITE_ACCEPT: u16 = 1 << 0;
pub const FLAG_CREATE_CHANNEL: u16 = 1 << 1;
pub const FLAG_BROADCAST: u16 = 1 << 2;
pub const FLAG_MANAGE_NETWORK: u16 = 1 << 3;
pub const FLAG_FIRST_MATE: u16 = 1 << 4;

pub const PRIVILEGE_KNOWN_ACTION_MASK: u16 = FLAG_INVITE_ACCEPT
    | FLAG_CREATE_CHANNEL
    | FLAG_BROADCAST
    | FLAG_MANAGE_NETWORK
    | FLAG_FIRST_MATE;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedPrivilegeRoleId {
    pub version: u8,
    pub flags: u16,
    pub known_flags: u16,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PrivilegeRoleIdDecodeError {
    UnknownVersion,
    ReservedNonzero,
}

pub fn encode_privilege_role_id(name: &str, flags: u16) -> Result<B256, String> {
    if flags & !PRIVILEGE_KNOWN_ACTION_MASK != 0 {
        return Err("unknown/reserved privilege flag bits must be 0 when encoding v1".into());
    }
    let name_bytes = name.as_bytes();
    if name_bytes.len() > PRIVILEGE_ROLE_NAME_MAX_BYTES {
        return Err(format!(
            "role name must be at most {PRIVILEGE_ROLE_NAME_MAX_BYTES} bytes"
        ));
    }
    let mut buf = [0u8; 32];
    buf[..name_bytes.len()].copy_from_slice(name_bytes);
    buf[28] = 0;
    buf[29] = PRIVILEGE_ROLE_ENCODING_VERSION;
    buf[30] = ((flags >> 8) & 0xff) as u8;
    buf[31] = (flags & 0xff) as u8;
    Ok(B256::from(buf))
}

pub fn decode_privilege_role_id(role: B256) -> Result<DecodedPrivilegeRoleId, PrivilegeRoleIdDecodeError> {
    let bytes = role.as_slice();
    let reserved = bytes[28];
    let version = bytes[29];
    let flags = u16::from_be_bytes([bytes[30], bytes[31]]);
    if version != PRIVILEGE_ROLE_ENCODING_VERSION {
        return Err(PrivilegeRoleIdDecodeError::UnknownVersion);
    }
    if reserved != 0 {
        return Err(PrivilegeRoleIdDecodeError::ReservedNonzero);
    }
    let mut end = PRIVILEGE_ROLE_NAME_MAX_BYTES;
    while end > 0 && bytes[end - 1] == 0 {
        end -= 1;
    }
    let name = String::from_utf8_lossy(&bytes[..end]).into_owned();
    Ok(DecodedPrivilegeRoleId {
        version,
        flags,
        known_flags: flags & PRIVILEGE_KNOWN_ACTION_MASK,
        name,
    })
}

pub fn parse_role_id_hex(raw: &str) -> Result<B256, String> {
    let t = raw.trim();
    let h = t
        .strip_prefix("0x")
        .or_else(|| t.strip_prefix("0X"))
        .unwrap_or(t);
    if h.len() != 64 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("expected 32-byte hex role id".into());
    }
    let bytes = hex::decode(h).map_err(|e| format!("invalid hex: {e}"))?;
    Ok(B256::from_slice(&bytes))
}

pub fn role_id_to_hex(role: B256) -> String {
    format!("{:#x}", role)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex_role(s: &str) -> B256 {
        parse_role_id_hex(s).expect("hex")
    }

    #[test]
    fn round_trip_vectors() {
        let cases: &[(&str, u16, &str)] = &[
            (
                "0x4d6f64657261746f720000000000000000000000000000000000000000010001",
                FLAG_INVITE_ACCEPT,
                "Moderator",
            ),
            (
                "0x4d6f640000000000000000000000000000000000000000000000000000010003",
                FLAG_INVITE_ACCEPT | FLAG_CREATE_CHANNEL,
                "Mod",
            ),
            (
                "0x0000000000000000000000000000000000000000000000000000000000010004",
                FLAG_BROADCAST,
                "",
            ),
            (
                "0x4142434445464748494a4b4c4d4e4f505152535455565758595a313200010001",
                FLAG_INVITE_ACCEPT,
                "ABCDEFGHIJKLMNOPQRSTUVWXYZ12",
            ),
            (
                "0x4d61746500000000000000000000000000000000000000000000000000010007",
                FLAG_INVITE_ACCEPT | FLAG_CREATE_CHANNEL | FLAG_BROADCAST,
                "Mate",
            ),
            (
                "0x4f7073000000000000000000000000000000000000000000000000000001001f",
                PRIVILEGE_KNOWN_ACTION_MASK,
                "Ops",
            ),
            (
                "0x416c706861000000000000000000000000000000000000000000000000010004",
                FLAG_BROADCAST,
                "Alpha",
            ),
            (
                "0x4265746100000000000000000000000000000000000000000000000000010004",
                FLAG_BROADCAST,
                "Beta",
            ),
        ];
        for (hex, flags, name) in cases {
            let encoded = encode_privilege_role_id(name, *flags).expect("encode");
            assert_eq!(role_id_to_hex(encoded), *hex, "encode {name}");
            let decoded = decode_privilege_role_id(hex_role(hex)).expect("decode");
            assert_eq!(decoded.flags, *flags);
            assert_eq!(decoded.known_flags, *flags);
            assert_eq!(decoded.name, *name);
            assert_eq!(decoded.version, 1);
        }
    }

    #[test]
    fn fail_closed_version_and_reserved() {
        assert_eq!(
            decode_privilege_role_id(hex_role(
                "0x5800000000000000000000000000000000000000000000000000000000000001"
            )),
            Err(PrivilegeRoleIdDecodeError::UnknownVersion)
        );
        assert_eq!(
            decode_privilege_role_id(hex_role(
                "0x5800000000000000000000000000000000000000000000000000000000020001"
            )),
            Err(PrivilegeRoleIdDecodeError::UnknownVersion)
        );
        assert_eq!(
            decode_privilege_role_id(hex_role(
                "0x58000000000000000000000000000000000000000000000000000000ab010001"
            )),
            Err(PrivilegeRoleIdDecodeError::ReservedNonzero)
        );
    }

    #[test]
    fn bit5_grants_known_bit0_only() {
        let decoded = decode_privilege_role_id(hex_role(
            "0x5800000000000000000000000000000000000000000000000000000000010021",
        ))
        .expect("decode");
        assert_eq!(decoded.flags, 0x0021);
        assert_eq!(decoded.known_flags, FLAG_INVITE_ACCEPT);
        assert_eq!(decoded.name, "X");
    }

    #[test]
    fn encode_rejects_reserved_bits_and_overlong_name() {
        assert!(encode_privilege_role_id("X", 1 << 5).is_err());
        assert!(encode_privilege_role_id("ABCDEFGHIJKLMNOPQRSTUVWXYZ123", 0).is_err());
    }
}
