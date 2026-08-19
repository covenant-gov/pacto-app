//! PactoSponsorPaymaster `paymasterAndData` encoding (EntryPoint v0.7).
//! Layout matches pacto-squad-sponsor client golden vectors.

use alloy::primitives::{Address, Bytes, B256, U256};
use alloy::sol_types::SolValue;

pub const PAYMASTER_DATA_VERSION: u8 = 1;
/// Header length of `paymasterAndData` (paymaster + verificationGasLimit + postOpGasLimit); `paymasterData` starts here.
pub const PAYMASTER_DATA_OFFSET: usize = 52;
pub const BALANCE_HEADROOM_BPS: u64 = 11_500;
/// Account `verificationGasLimit` (PactoSimple7702Account validateUserOp).
pub const DEFAULT_VERIFICATION_GAS_LIMIT: u128 = 100_000;
/// Estimate-request ceiling for paymaster verification (OOG-safe placeholder before bundler estimate).
pub const DEFAULT_PAYMASTER_VERIFICATION_GAS_LIMIT: u128 = 500_000;
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
        let paymaster = address!("0x78197483Ac3180361cDb1F59Dd702Ea8ca34AC3A");
        let squad_id = b256!("0x1111111111111111111111111111111111111111111111111111111111111111");
        let sponsor = address!("0x2222222222222222222222222222222222222222");
        let member = address!("0x3333333333333333333333333333333333333333");
        let encoded = encode_paymaster_and_data(
            paymaster,
            squad_id,
            sponsor,
            member,
            DEFAULT_PAYMASTER_VERIFICATION_GAS_LIMIT,
            DEFAULT_POST_OP_GAS_LIMIT,
        );
        let expected = "0x78197483ac3180361cdb1f59dd702ea8ca34ac3a0000000000000000000000000007a1200000000000000000000000000000c3500000000000000000000000000000000000000000000000000000000000000001111111111111111111111111111111111111111111111111111111111111111100000000000000000000000022222222222222222222222222222222222222220000000000000000000000003333333333333333333333333333333333333333";
        assert_eq!(format!("{encoded:#x}"), expected);
        assert_eq!(encoded.len(), 180);
    }
}
