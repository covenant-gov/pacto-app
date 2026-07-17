//! PactoSponsorPaymaster `paymasterAndData` encoding (EntryPoint v0.7).
//! Layout matches pacto-squad-sponsor client golden vectors.

use alloy::primitives::{Address, B256, Bytes, U256};
use alloy::sol_types::SolValue;

pub const PAYMASTER_DATA_VERSION: u8 = 1;
/// Header length of `paymasterAndData` (paymaster + verificationGasLimit + postOpGasLimit); `paymasterData` starts here.
pub const PAYMASTER_DATA_OFFSET: usize = 52;
pub const BALANCE_HEADROOM_BPS: u64 = 11_500;
pub const DEFAULT_VERIFICATION_GAS_LIMIT: u128 = 100_000;
pub const DEFAULT_POST_OP_GAS_LIMIT: u128 = 50_000;

/// Pool wei required for EntryPoint `maxCost` (115% headroom).
pub fn required_pool_balance(max_cost_wei: U256) -> U256 {
    max_cost_wei * U256::from(BALANCE_HEADROOM_BPS) / U256::from(10_000u64)
}

/// Full ERC-4337 `paymasterAndData` (52-byte header + 128-byte ABI payload).
pub fn encode_paymaster_and_data(
    paymaster: Address,
    squad_id: B256,
    sponsor: Address,
    member: Address,
    verification_gas_limit: u128,
    post_op_gas_limit: u128,
) -> Bytes {
    let mut out = Vec::with_capacity(180);
    out.extend_from_slice(paymaster.as_slice());
    out.extend_from_slice(&verification_gas_limit.to_be_bytes());
    out.extend_from_slice(&post_op_gas_limit.to_be_bytes());
    let payload = (
        U256::from(PAYMASTER_DATA_VERSION),
        squad_id,
        sponsor,
        member,
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
    fn required_pool_balance_matches_golden_headroom() {
        let max = U256::from(1_000_000_000_000_000_000u64);
        assert_eq!(
            required_pool_balance(max),
            U256::from(1_150_000_000_000_000_000u64)
        );
    }

    #[test]
    fn encode_paymaster_and_data_matches_golden_vector() {
        let paymaster = address!("0xF7f557a9443671EB0f5a3F1b233Ac44A9eDa24B8");
        let squad_id =
            b256!("0x1111111111111111111111111111111111111111111111111111111111111111");
        let sponsor = address!("0x2222222222222222222222222222222222222222");
        let member = address!("0x3333333333333333333333333333333333333333");
        let encoded = encode_paymaster_and_data(
            paymaster,
            squad_id,
            sponsor,
            member,
            DEFAULT_VERIFICATION_GAS_LIMIT,
            DEFAULT_POST_OP_GAS_LIMIT,
        );
        let expected = "0xf7f557a9443671eb0f5a3f1b233ac44a9eda24b8000000000000000000000000000186a00000000000000000000000000000c3500000000000000000000000000000000000000000000000000000000000000001111111111111111111111111111111111111111111111111111111111111111100000000000000000000000022222222222222222222222222222222222222220000000000000000000000003333333333333333333333333333333333333333";
        assert_eq!(format!("{encoded:#x}"), expected);
        assert_eq!(encoded.len(), 180);
    }
}
