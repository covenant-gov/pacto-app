//! Estimate-pass ceilings. Factory stays at 14M call gas, not the 1.5M heavy-gov ceiling.

use alloy::primitives::U256;
use alloy::sol_types::SolCall;

use super::policy::policy;
use super::transport::{fallback_call_gas_limit, heavy_call_gas_limit, userop_max_cost_wei};
use crate::evm::contracts::pacto_gov::read_bindings::IMutinyModule::{
    captainResignCall, executeMutinyCall,
};
use crate::evm::contracts::pacto_gov::read_bindings::IQuartermaster::{
    bootstrapCrewCall, executeAddCrewCall, executeOffboardCall, executeRemoveCrewCall,
};
use crate::evm::contracts::pacto_gov::read_bindings::ITreasuryAuthority::executeCall as treasuryExecuteCall;
use crate::evm::global_paymaster::{
    default_global_paymaster_verification_gas_limit, default_global_post_op_gas_limit,
};
use crate::evm::sponsor_paymaster::{
    default_paymaster_verification_gas_limit, default_post_op_gas_limit,
    default_verification_gas_limit,
};

pub const CLAIM_USERNAME_SELECTOR: [u8; 4] = [0x98, 0x24, 0x55, 0x0d];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UseropPlaceholderLane {
    Squad,
    GovModule,
    FactoryTarget,
    UsernameBootstrap,
    UsernameMember,
}

#[derive(Clone, Copy, Debug)]
pub struct UseropGasCeilings {
    pub call: u128,
    pub verification: u128,
    pub pre_verification: u128,
    pub pm_verification: u128,
    pub pm_post: u128,
}

/// Hats / Safe execute paths need a higher estimate ceiling than vote/start.
fn is_heavy_gov_calldata(calldata: &[u8]) -> bool {
    if calldata.len() < 4 {
        return false;
    }
    let sel: [u8; 4] = calldata[..4].try_into().unwrap();
    sel == executeMutinyCall::SELECTOR
        || sel == captainResignCall::SELECTOR
        || sel == treasuryExecuteCall::SELECTOR
        || sel == bootstrapCrewCall::SELECTOR
        || sel == executeAddCrewCall::SELECTOR
        || sel == executeRemoveCrewCall::SELECTOR
        || sel == executeOffboardCall::SELECTOR
}

/// UserOp / EOA fallback call-gas ceiling for this inner gov selector.
pub(crate) fn call_gas_ceiling_for_calldata(calldata: &[u8]) -> u128 {
    if is_heavy_gov_calldata(calldata) {
        heavy_call_gas_limit()
    } else {
        fallback_call_gas_limit()
    }
}

/// Estimate-pass ceilings. Factory sum is 15.8M, under the bundler cap.
pub fn userop_gas_ceilings(calldata: &[u8], lane: UseropPlaceholderLane) -> UseropGasCeilings {
    let p = policy();
    match lane {
        UseropPlaceholderLane::FactoryTarget => UseropGasCeilings {
            call: p.factory_call_gas_limit,
            verification: p.factory_verification_gas_limit,
            pre_verification: p.factory_pre_verification_gas,
            pm_verification: default_global_paymaster_verification_gas_limit(),
            pm_post: p.factory_paymaster_post_op_gas_limit,
        },
        UseropPlaceholderLane::Squad => UseropGasCeilings {
            call: call_gas_ceiling_for_calldata(calldata),
            verification: default_verification_gas_limit(),
            pre_verification: p.fallback_pre_verification_gas,
            pm_verification: default_paymaster_verification_gas_limit(),
            pm_post: default_post_op_gas_limit(),
        },
        UseropPlaceholderLane::GovModule => UseropGasCeilings {
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
        UseropPlaceholderLane::UsernameBootstrap => UseropGasCeilings {
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
        UseropPlaceholderLane::UsernameMember => UseropGasCeilings {
            call: fallback_call_gas_limit(),
            verification: default_verification_gas_limit(),
            pre_verification: p.fallback_pre_verification_gas,
            pm_verification: default_global_paymaster_verification_gas_limit(),
            pm_post: default_global_post_op_gas_limit(),
        },
    }
}

pub fn userop_placeholder_max_cost_wei(
    calldata: &[u8],
    lane: UseropPlaceholderLane,
    max_fee_per_gas: u128,
) -> U256 {
    let ceilings = userop_gas_ceilings(calldata, lane);
    userop_max_cost_wei(
        ceilings.call,
        ceilings.verification,
        ceilings.pre_verification,
        max_fee_per_gas,
        ceilings.pm_verification,
        ceilings.pm_post,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::{address, Bytes, U256};
    use alloy::sol_types::SolCall;

    #[test]
    fn factory_target_uses_heavier_verification_than_gov_module() {
        let call = [0xde, 0xad, 0xbe, 0xef];
        let factory = userop_gas_ceilings(&call, UseropPlaceholderLane::FactoryTarget);
        let gov = userop_gas_ceilings(&call, UseropPlaceholderLane::GovModule);
        assert!(factory.verification > gov.verification);
        assert!(factory.pre_verification > gov.pre_verification);
        assert_eq!(gov.call, heavy_call_gas_limit());
        assert_ne!(factory.call, gov.call);
    }

    #[test]
    fn factory_target_call_ceiling_is_fourteen_million() {
        let call = [0xde, 0xad, 0xbe, 0xef];
        let factory = userop_gas_ceilings(&call, UseropPlaceholderLane::FactoryTarget);
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
        let heavy = userop_placeholder_max_cost_wei(
            &boot,
            UseropPlaceholderLane::GovModule,
            30_000_000_000,
        );
        let eoa_style = U256::from(300_000u64) * U256::from(30_000_000_000u64);
        assert!(heavy > eoa_style);
        let cheap =
            userop_placeholder_max_cost_wei(&boot, UseropPlaceholderLane::GovModule, 1_000_000_000);
        assert!(heavy > cheap);
    }

    #[test]
    fn call_gas_ceiling_is_heavy_for_hats_execute_selectors() {
        use crate::evm::contracts::pacto_gov::read_bindings::IMutinyModule::{
            captainResignCall, castVoteCall, executeMutinyCall,
        };
        use crate::evm::contracts::pacto_gov::read_bindings::IQuartermaster::{
            bootstrapCrewCall, executeAddCrewCall, executeOffboardCall, executeRemoveCrewCall,
        };
        use crate::evm::contracts::pacto_gov::read_bindings::ITreasuryAuthority::executeCall;

        let exec = executeMutinyCall {
            _mutinyId: U256::from(1u64),
        }
        .abi_encode();
        assert_eq!(call_gas_ceiling_for_calldata(&exec), heavy_call_gas_limit());

        let resign = captainResignCall {
            _newCaptain: address!("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            _seatFormerCaptain: true,
        }
        .abi_encode();
        assert_eq!(
            call_gas_ceiling_for_calldata(&resign),
            heavy_call_gas_limit()
        );

        let treasury = executeCall {
            _proposalId: U256::from(1u64),
            _data: Bytes::new(),
        }
        .abi_encode();
        assert_eq!(
            call_gas_ceiling_for_calldata(&treasury),
            heavy_call_gas_limit()
        );

        let boot = bootstrapCrewCall {
            _candidates: vec![],
        }
        .abi_encode();
        assert_eq!(call_gas_ceiling_for_calldata(&boot), heavy_call_gas_limit());
        assert_eq!(
            call_gas_ceiling_for_calldata(
                &executeAddCrewCall {
                    _candidate: address!("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
                }
                .abi_encode()
            ),
            heavy_call_gas_limit()
        );
        assert_eq!(
            call_gas_ceiling_for_calldata(
                &executeRemoveCrewCall {
                    _crew: address!("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
                }
                .abi_encode()
            ),
            heavy_call_gas_limit()
        );
        assert_eq!(
            call_gas_ceiling_for_calldata(
                &executeOffboardCall {
                    _offboardId: U256::from(1u64),
                }
                .abi_encode()
            ),
            heavy_call_gas_limit()
        );

        let vote = castVoteCall {
            _mutinyId: U256::from(1u64),
        }
        .abi_encode();
        assert_eq!(
            call_gas_ceiling_for_calldata(&vote),
            fallback_call_gas_limit()
        );
        assert_eq!(
            call_gas_ceiling_for_calldata(&[]),
            fallback_call_gas_limit()
        );
    }
}
