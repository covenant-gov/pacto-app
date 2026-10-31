//! Shared placeholder max-cost for global paymaster UserOp preflight.

use alloy::primitives::U256;
use alloy::providers::Provider;

use super::global_paymaster::{
    default_global_paymaster_verification_gas_limit, default_global_post_op_gas_limit,
};
use super::sponsor_paymaster::default_verification_gas_limit;
use super::sponsor_userop::{
    clamp_userop_eip1559_fees, fallback_call_gas_limit, fallback_max_fee, heavy_call_gas_limit,
    userop_max_cost_wei,
};
use super::userop_policy::policy;

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

/// Estimate-pass ceilings. Factory sum is 15.8M, under the bundler cap.
pub fn global_userop_gas_ceilings(
    calldata: &[u8],
    lane: GlobalUseropPlaceholderLane,
) -> GlobalUseropGasCeilings {
    let p = policy();
    match lane {
        GlobalUseropPlaceholderLane::FactoryTarget => GlobalUseropGasCeilings {
            call: p.factory_call_gas_limit,
            verification: p.factory_verification_gas_limit,
            pre_verification: p.factory_pre_verification_gas,
            pm_verification: default_global_paymaster_verification_gas_limit(),
            pm_post: p.factory_paymaster_post_op_gas_limit,
        },
        GlobalUseropPlaceholderLane::GovModule => GlobalUseropGasCeilings {
            call: if calldata.len() >= 4 {
                heavy_call_gas_limit()
            } else {
                fallback_call_gas_limit()
            },
            verification: default_verification_gas_limit(),
            pre_verification: p.fallback_pre_verification_gas,
            pm_verification: default_global_paymaster_verification_gas_limit(),
            pm_post: default_global_post_op_gas_limit(),
        },
        GlobalUseropPlaceholderLane::UsernameBootstrap => GlobalUseropGasCeilings {
            call: if calldata.len() >= 4 && calldata[..4] == CLAIM_USERNAME_SELECTOR {
                heavy_call_gas_limit()
            } else {
                fallback_call_gas_limit()
            },
            verification: default_verification_gas_limit(),
            pre_verification: p.fallback_pre_verification_gas,
            pm_verification: default_global_paymaster_verification_gas_limit(),
            pm_post: default_global_post_op_gas_limit(),
        },
        GlobalUseropPlaceholderLane::UsernameMember => GlobalUseropGasCeilings {
            call: fallback_call_gas_limit(),
            verification: default_verification_gas_limit(),
            pre_verification: p.fallback_pre_verification_gas,
            pm_verification: default_global_paymaster_verification_gas_limit(),
            pm_post: default_global_post_op_gas_limit(),
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
        .unwrap_or(fallback_max_fee());
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
        assert_eq!(gov.call, heavy_call_gas_limit());
        assert_ne!(factory.call, gov.call);
    }

    #[test]
    fn factory_target_call_ceiling_is_fourteen_million() {
        let call = [0xde, 0xad, 0xbe, 0xef];
        let factory = global_userop_gas_ceilings(&call, GlobalUseropPlaceholderLane::FactoryTarget);
        assert_eq!(factory.call, 14_000_000);
        assert_ne!(factory.call, heavy_call_gas_limit());
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
