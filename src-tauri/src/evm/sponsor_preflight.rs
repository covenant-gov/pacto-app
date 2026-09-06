//! Shared sponsorship preflight for squad, global factory, and gov-module paths.

use alloy::primitives::{Address, B256, U256};
use alloy::providers::Provider;

use super::contracts::pacto_username::IPactoUsernameNFT::eligibleMemberCall;
use super::contracts::pacto_username::IGlobalSponsorPool::spendablePoolWeiCall as globalSpendablePoolWeiCall;
use super::contracts::pacto_username::ISponsorPolicyRegistry::{
    isContractAllowedCall, policyVersionCall,
};
use super::contracts::pacto_sponsor::ISquadSponsorBase::spendablePoolWeiCall as squadSpendablePoolWeiCall;
use super::global_paymaster::required_global_pool_balance;
use super::pacto_chain_config::GlobalUsernameSponsorAddresses;
use super::rpc::call::eth_call_decode;
use super::rpc::wallet_err_json;
use super::sponsor_paymaster::required_pool_balance;
use super::sponsor_policy_registry::{is_top_hat_sponsored, module_to_top_hat};
use super::sponsor_userop::sponsor_eligibility_preflight;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EligibleMember {
    pub npub_hash: B256,
    pub token_id: U256,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GovModuleTopHatStatus {
    NotIndexed,
    NotSponsored { top_hat_id: U256 },
    Sponsored { top_hat_id: U256 },
}

pub fn eligible_member_from_npub(npub_hash: B256, token_id: U256) -> Option<EligibleMember> {
    if npub_hash.is_zero() {
        None
    } else {
        Some(EligibleMember {
            npub_hash,
            token_id,
        })
    }
}

pub fn gov_module_tophat_ok(status: GovModuleTopHatStatus) -> bool {
    matches!(status, GovModuleTopHatStatus::Sponsored { .. })
}

pub fn global_pool_covers_cost(spendable_wei: U256, estimated_max_cost_wei: U256) -> bool {
    spendable_wei >= required_global_pool_balance(estimated_max_cost_wei)
}

pub fn squad_pool_covers_cost(spendable_wei: U256, estimated_max_cost_wei: U256) -> bool {
    spendable_wei >= required_pool_balance(estimated_max_cost_wei)
}

pub async fn read_eligible_member<P: Provider>(
    provider: &P,
    nft: Address,
    member: Address,
) -> Result<Option<EligibleMember>, String> {
    let ret = eth_call_decode(provider, nft, &eligibleMemberCall { member })
        .await
        .map_err(|e| wallet_err_json("USERNAME_READ", e, None))?;
    Ok(eligible_member_from_npub(ret.npubHash, ret.tokenId))
}

pub async fn read_global_pool_spendable<P: Provider>(
    provider: &P,
    pool: Address,
) -> Result<U256, String> {
    eth_call_decode(provider, pool, &globalSpendablePoolWeiCall {})
        .await
        .map_err(|e| wallet_err_json("USERNAME_POOL_READ", e, None))
}

pub async fn read_squad_pool_spendable<P: Provider>(
    provider: &P,
    sponsor_clone: Address,
) -> Result<U256, String> {
    eth_call_decode(provider, sponsor_clone, &squadSpendablePoolWeiCall {})
        .await
        .map_err(|e| wallet_err_json("SPONSOR_READ", e, None))
}

pub async fn global_pool_headroom_ok<P: Provider>(
    provider: &P,
    pool: Address,
    estimated_max_cost_wei: U256,
) -> Result<bool, String> {
    let spendable = read_global_pool_spendable(provider, pool).await?;
    Ok(global_pool_covers_cost(spendable, estimated_max_cost_wei))
}

pub async fn squad_pool_headroom_ok<P: Provider>(
    provider: &P,
    sponsor_clone: Address,
    estimated_max_cost_wei: U256,
) -> Result<bool, String> {
    let spendable = read_squad_pool_spendable(provider, sponsor_clone).await?;
    Ok(squad_pool_covers_cost(spendable, estimated_max_cost_wei))
}

pub async fn policy_version_fresh<P: Provider>(
    provider: &P,
    registry: Address,
    catalog_policy_version: u64,
) -> Result<bool, String> {
    let on_chain: U256 = eth_call_decode(provider, registry, &policyVersionCall {})
        .await
        .map_err(|e| wallet_err_json("SPONSOR_POLICY_READ", e, None))?;
    Ok(on_chain <= U256::from(catalog_policy_version))
}

pub async fn factory_target_allowed<P: Provider>(
    provider: &P,
    registry: Address,
    catalog_policy_version: u64,
    factory: Address,
) -> Result<bool, String> {
    if !policy_version_fresh(provider, registry, catalog_policy_version).await? {
        return Ok(false);
    }
    let allowed: bool = eth_call_decode(
        provider,
        registry,
        &isContractAllowedCall { target: factory },
    )
    .await
    .map_err(|e| wallet_err_json("SPONSOR_POLICY_READ", e, None))?;
    Ok(allowed)
}

pub async fn gov_module_tophat_status<P: Provider>(
    provider: &P,
    registry: Address,
    module: Address,
) -> Result<GovModuleTopHatStatus, String> {
    let top_hat_id = module_to_top_hat(provider, registry, module).await?;
    if top_hat_id.is_zero() {
        return Ok(GovModuleTopHatStatus::NotIndexed);
    }
    let sponsored = is_top_hat_sponsored(provider, registry, top_hat_id).await?;
    if sponsored {
        Ok(GovModuleTopHatStatus::Sponsored { top_hat_id })
    } else {
        Ok(GovModuleTopHatStatus::NotSponsored { top_hat_id })
    }
}

/// Soft squad-path probe for router selection (any reject → `false`).
pub async fn squad_sponsor_path_ok<P: Provider>(
    provider: &P,
    factory: Address,
    expected_paymaster: Address,
    squad_id: B256,
    member: Address,
    estimated_max_cost_wei: U256,
) -> Result<bool, String> {
    Ok(
        sponsor_eligibility_preflight(
            provider,
            factory,
            expected_paymaster,
            squad_id,
            member,
            estimated_max_cost_wei,
        )
        .await
        .is_ok(),
    )
}

/// Global factory deploy lane: `eligibleMember` + `isContractAllowed(factory)` + pool headroom.
pub async fn global_factory_path_ok<P: Provider>(
    provider: &P,
    addrs: &GlobalUsernameSponsorAddresses,
    member: Address,
    factory: Address,
    estimated_max_cost_wei: U256,
) -> Result<bool, String> {
    if read_eligible_member(provider, addrs.pacto_username_nft, member)
        .await?
        .is_none()
    {
        return Ok(false);
    }
    if !factory_target_allowed(
        provider,
        addrs.sponsor_policy_registry,
        addrs.policy_version,
        factory,
    )
    .await?
    {
        return Ok(false);
    }
    global_pool_headroom_ok(provider, addrs.global_sponsor_pool, estimated_max_cost_wei).await
}

/// Global gov-module lane: `eligibleMember` + indexed topHat + pool headroom.
pub async fn global_gov_module_path_ok<P: Provider>(
    provider: &P,
    addrs: &GlobalUsernameSponsorAddresses,
    member: Address,
    module: Address,
    estimated_max_cost_wei: U256,
) -> Result<bool, String> {
    if read_eligible_member(provider, addrs.pacto_username_nft, member)
        .await?
        .is_none()
    {
        return Ok(false);
    }
    let status =
        gov_module_tophat_status(provider, addrs.sponsor_policy_registry, module).await?;
    if !gov_module_tophat_ok(status) {
        return Ok(false);
    }
    global_pool_headroom_ok(provider, addrs.global_sponsor_pool, estimated_max_cost_wei).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::b256;

    #[test]
    fn eligible_member_requires_nonzero_npub_hash() {
        assert!(eligible_member_from_npub(B256::ZERO, U256::from(1u64)).is_none());
        let npub = b256!("0x540d126644e922328318f1870ba0c9de3b2d5c0c271e27af7efea3e44025fdc1");
        let member = eligible_member_from_npub(npub, U256::from(7u64)).expect("eligible");
        assert_eq!(member.npub_hash, npub);
        assert_eq!(member.token_id, U256::from(7u64));
    }

    #[test]
    fn gov_module_tophat_ok_only_when_sponsored() {
        assert!(!gov_module_tophat_ok(GovModuleTopHatStatus::NotIndexed));
        assert!(!gov_module_tophat_ok(GovModuleTopHatStatus::NotSponsored {
            top_hat_id: U256::from(9u64),
        }));
        assert!(gov_module_tophat_ok(GovModuleTopHatStatus::Sponsored {
            top_hat_id: U256::from(9u64),
        }));
    }

    #[test]
    fn pool_headroom_helpers_use_paymaster_margins() {
        let max = U256::from(1_000_000u64);
        let global_need = required_global_pool_balance(max);
        let squad_need = required_pool_balance(max);
        assert!(!global_pool_covers_cost(global_need - U256::from(1u64), max));
        assert!(global_pool_covers_cost(global_need, max));
        assert!(!squad_pool_covers_cost(squad_need - U256::from(1u64), max));
        assert!(squad_pool_covers_cost(squad_need, max));
    }
}
