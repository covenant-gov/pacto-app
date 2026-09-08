//! Shared placeholder max-cost for global paymaster UserOp preflight.

use alloy::primitives::U256;
use alloy::providers::Provider;

use super::global_paymaster::{
    DEFAULT_GLOBAL_PAYMASTER_VERIFICATION_GAS_LIMIT, DEFAULT_GLOBAL_POST_OP_GAS_LIMIT,
};
use super::sponsor_paymaster::DEFAULT_VERIFICATION_GAS_LIMIT;
use super::sponsor_userop::{
    userop_max_cost_wei, FALLBACK_CALL_GAS_LIMIT, FALLBACK_MAX_FEE, HEAVY_CALL_GAS_LIMIT,
};

pub const CLAIM_USERNAME_SELECTOR: [u8; 4] = [0x98, 0x24, 0x55, 0x0d];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GlobalUseropPlaceholderLane {
    GovModule,
    FactoryTarget,
    UsernameBootstrap,
    UsernameMember,
}

#[derive(Clone, Copy, Debug)]
pub struct GlobalUseropGasCeilings {
    pub call: u128,
    pub verification: u128,
    pub pre_verification: u128,
    pub pm_verification: u128,
    pub pm_post: u128,
}

pub fn global_userop_gas_ceilings(
    calldata: &[u8],
    lane: GlobalUseropPlaceholderLane,
) -> GlobalUseropGasCeilings {
    let call = match lane {
        GlobalUseropPlaceholderLane::GovModule | GlobalUseropPlaceholderLane::FactoryTarget => {
            if calldata.len() >= 4 {
                HEAVY_CALL_GAS_LIMIT
            } else {
                FALLBACK_CALL_GAS_LIMIT
            }
        }
        GlobalUseropPlaceholderLane::UsernameBootstrap => {
            if calldata.len() >= 4 && calldata[..4] == CLAIM_USERNAME_SELECTOR {
                HEAVY_CALL_GAS_LIMIT
            } else {
                FALLBACK_CALL_GAS_LIMIT
            }
        }
        GlobalUseropPlaceholderLane::UsernameMember => FALLBACK_CALL_GAS_LIMIT,
    };
    GlobalUseropGasCeilings {
        call,
        verification: DEFAULT_VERIFICATION_GAS_LIMIT,
        pre_verification: 80_000,
        pm_verification: DEFAULT_GLOBAL_PAYMASTER_VERIFICATION_GAS_LIMIT,
        pm_post: DEFAULT_GLOBAL_POST_OP_GAS_LIMIT,
    }
}

pub fn global_userop_placeholder_max_cost_wei(
    calldata: &[u8],
    lane: GlobalUseropPlaceholderLane,
    max_fee_per_gas: u128,
) -> U256 {
    let ceilings = global_userop_gas_ceilings(calldata, lane);
    userop_max_cost_wei(
        ceilings.call,
        ceilings.verification,
        ceilings.pre_verification,
        max_fee_per_gas,
        ceilings.pm_verification,
        ceilings.pm_post,
    )
}

pub async fn global_userop_placeholder_max_cost<P: Provider>(
    provider: &P,
    calldata: &[u8],
    lane: GlobalUseropPlaceholderLane,
) -> U256 {
    let max_fee = provider
        .estimate_eip1559_fees()
        .await
        .map(|fees| fees.max_fee_per_gas)
        .unwrap_or(FALLBACK_MAX_FEE);
    global_userop_placeholder_max_cost_wei(calldata, lane, max_fee)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::U256;

    #[test]
    fn gov_module_placeholder_exceeds_typical_eoa_estimate() {
        let boot = [0xde, 0xad, 0xbe, 0xef];
        let heavy = global_userop_placeholder_max_cost_wei(
            &boot,
            GlobalUseropPlaceholderLane::GovModule,
            30_000_000_000,
        );
        let eoa_style = U256::from(300_000u64) * U256::from(30_000_000_000u64);
        assert!(heavy > eoa_style);
    }
}
