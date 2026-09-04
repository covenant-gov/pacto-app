//! PactoGlobalPaymaster `paymasterAndData` encoding (EntryPoint v0.7).
//! Layout: 52-byte header + abi.encode(uint8 version, bytes32 npubHash, address member, address policy).

use alloy::primitives::{Address, Bytes, B256, U256};
use alloy::sol_types::SolValue;

pub const GLOBAL_PAYMASTER_DATA_VERSION: u8 = 1;
pub const GLOBAL_PAYMASTER_DATA_OFFSET: usize = 52;
pub const GLOBAL_BALANCE_HEADROOM_BPS: u64 = 11_500;
pub const DEFAULT_GLOBAL_PAYMASTER_VERIFICATION_GAS_LIMIT: u128 = 500_000;
pub const DEFAULT_GLOBAL_POST_OP_GAS_LIMIT: u128 = 50_000;

/// Pool wei required for EntryPoint `maxCost` (115% headroom).
pub fn required_global_pool_balance(max_cost_wei: U256) -> U256 {
    max_cost_wei * U256::from(GLOBAL_BALANCE_HEADROOM_BPS) / U256::from(10_000u64)
}

/// Full ERC-4337 `paymasterAndData` (52-byte header + 128-byte ABI payload).
/// Member path: pass `Address::ZERO` for `policy`.
pub fn encode_global_paymaster_and_data(
    paymaster: Address,
    npub_hash: B256,
    member: Address,
    policy: Address,
    verification_gas_limit: u128,
    post_op_gas_limit: u128,
) -> Bytes {
    let mut out = Vec::with_capacity(180);
    out.extend_from_slice(paymaster.as_slice());
    out.extend_from_slice(&verification_gas_limit.to_be_bytes());
    out.extend_from_slice(&post_op_gas_limit.to_be_bytes());
    let payload = (
        U256::from(GLOBAL_PAYMASTER_DATA_VERSION),
        npub_hash,
        member,
        policy,
    )
        .abi_encode();
    out.extend_from_slice(&payload);
    Bytes::from(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::{address, b256};

    #[test]
    fn required_global_pool_balance_matches_golden_headroom() {
        let max = U256::from(1_000_000_000_000_000_000u64);
        assert_eq!(
            required_global_pool_balance(max),
            U256::from(1_150_000_000_000_000_000u64)
        );
    }

    #[test]
    fn encode_global_paymaster_and_data_matches_golden_vector() {
        let paymaster = address!("0x1C2eb4Ac1cD57aF67ad8B20838A28FB23d39d5b8");
        let npub_hash = b256!("0x540d126644e922328318f1870ba0c9de3b2d5c0c271e27af7efea3e44025fdc1");
        let member = address!("0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7");
        let encoded = encode_global_paymaster_and_data(
            paymaster,
            npub_hash,
            member,
            Address::ZERO,
            DEFAULT_GLOBAL_PAYMASTER_VERIFICATION_GAS_LIMIT,
            DEFAULT_GLOBAL_POST_OP_GAS_LIMIT,
        );
        let expected = "0x1c2eb4ac1cd57af67ad8b20838a28fb23d39d5b80000000000000000000000000007a1200000000000000000000000000000c3500000000000000000000000000000000000000000000000000000000000000001540d126644e922328318f1870ba0c9de3b2d5c0c271e27af7efea3e44025fdc1000000000000000000000000e05fcc23807536bee418f142d19fa0d21bb0cff70000000000000000000000000000000000000000000000000000000000000000";
        assert_eq!(format!("{encoded:#x}"), expected);
        assert_eq!(encoded.len(), GLOBAL_PAYMASTER_DATA_OFFSET + 128);
    }
}
