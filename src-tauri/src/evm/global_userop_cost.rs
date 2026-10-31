//! Shared placeholder max-cost for global paymaster UserOp preflight.

use alloy::primitives::U256;
use alloy::providers::Provider;

use super::global_paymaster::{
    DEFAULT_GLOBAL_PAYMASTER_VERIFICATION_GAS_LIMIT, DEFAULT_GLOBAL_POST_OP_GAS_LIMIT,
};
use super::sponsor_paymaster::DEFAULT_VERIFICATION_GAS_LIMIT;
use super::sponsor_userop::{
    clamp_userop_eip1559_fees, userop_max_cost_wei, FALLBACK_CALL_GAS_LIMIT, FALLBACK_MAX_FEE,
    HEAVY_CALL_GAS_LIMIT,
};

pub const CLAIM_USERNAME_SELECTOR: [u8; 4] = [0x98, 0x24, 0x55, 0x0d];

/// Estimate-pass ceilings for `deployNavePirata`. Sum is 15.8M, under the 16M bundler cap.
const FACTORY_VERIFICATION_GAS_LIMIT: u128 = 1_000_000;
const FACTORY_CALL_GAS_LIMIT: u128 = 14_000_000;
const FACTORY_PRE_VERIFICATION_GAS: u128 = 200_000;
const FACTORY_PM_POST_OP_GAS: u128 = 100_000;

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
    match lane {
        GlobalUseropPlaceholderLane::FactoryTarget => GlobalUseropGasCeilings {
            call: FACTORY_CALL_GAS_LIMIT,
            verification: FACTORY_VERIFICATION_GAS_LIMIT,
            pre_verification: FACTORY_PRE_VERIFICATION_GAS,
            pm_verification: DEFAULT_GLOBAL_PAYMASTER_VERIFICATION_GAS_LIMIT,
            pm_post: FACTORY_PM_POST_OP_GAS,
        },
        GlobalUseropPlaceholderLane::GovModule => GlobalUseropGasCeilings {
            call: if calldata.len() >= 4 {
                HEAVY_CALL_GAS_LIMIT
            } else {
                FALLBACK_CALL_GAS_LIMIT
            },
            verification: DEFAULT_VERIFICATION_GAS_LIMIT,
            pre_verification: 80_000,
            pm_verification: DEFAULT_GLOBAL_PAYMASTER_VERIFICATION_GAS_LIMIT,
            pm_post: DEFAULT_GLOBAL_POST_OP_GAS_LIMIT,
        },
        GlobalUseropPlaceholderLane::UsernameBootstrap => GlobalUseropGasCeilings {
            call: if calldata.len() >= 4 && calldata[..4] == CLAIM_USERNAME_SELECTOR {
                HEAVY_CALL_GAS_LIMIT
            } else {
                FALLBACK_CALL_GAS_LIMIT
            },
            verification: DEFAULT_VERIFICATION_GAS_LIMIT,
            pre_verification: 80_000,
            pm_verification: DEFAULT_GLOBAL_PAYMASTER_VERIFICATION_GAS_LIMIT,
            pm_post: DEFAULT_GLOBAL_POST_OP_GAS_LIMIT,
        },
        GlobalUseropPlaceholderLane::UsernameMember => GlobalUseropGasCeilings {
            call: FALLBACK_CALL_GAS_LIMIT,
            verification: DEFAULT_VERIFICATION_GAS_LIMIT,
            pre_verification: 80_000,
            pm_verification: DEFAULT_GLOBAL_PAYMASTER_VERIFICATION_GAS_LIMIT,
            pm_post: DEFAULT_GLOBAL_POST_OP_GAS_LIMIT,
        },
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
        .map(|fees| {
            clamp_userop_eip1559_fees(fees.max_priority_fee_per_gas, fees.max_fee_per_gas).1
        })
        .unwrap_or(FALLBACK_MAX_FEE);
    global_userop_placeholder_max_cost_wei(calldata, lane, max_fee)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::U256;

    #[test]
    fn factory_target_uses_heavier_verification_than_gov_module() {
        let call = [0xde, 0xad, 0xbe, 0xef];
        let factory = global_userop_gas_ceilings(&call, GlobalUseropPlaceholderLane::FactoryTarget);
        let gov = global_userop_gas_ceilings(&call, GlobalUseropPlaceholderLane::GovModule);
        assert!(factory.verification > gov.verification);
        assert!(factory.pre_verification > gov.pre_verification);
        assert_eq!(gov.call, HEAVY_CALL_GAS_LIMIT);
        assert_ne!(factory.call, gov.call);
    }

    #[test]
    fn factory_target_call_ceiling_is_fourteen_million() {
        let call = [0xde, 0xad, 0xbe, 0xef];
        let factory = global_userop_gas_ceilings(&call, GlobalUseropPlaceholderLane::FactoryTarget);
        assert_eq!(factory.call, 14_000_000);
        assert_ne!(factory.call, HEAVY_CALL_GAS_LIMIT);
        assert_eq!(factory.verification, 1_000_000);
        assert_eq!(factory.pre_verification, 200_000);
        assert_eq!(factory.pm_verification, 500_000);
        assert_eq!(factory.pm_post, 100_000);
        assert_eq!(
            factory.call
                + factory.verification
                + factory.pre_verification
                + factory.pm_verification
                + factory.pm_post,
            15_800_000
        );
    }

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
        let cheap = global_userop_placeholder_max_cost_wei(
            &boot,
            GlobalUseropPlaceholderLane::GovModule,
            1_000_000_000,
        );
        assert!(heavy > cheap);
    }
}
