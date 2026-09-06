//! On-chain SponsorPolicyRegistry reads for topHat-tier global sponsorship.

use alloy::primitives::{Address, U256};
use alloy::providers::Provider;

use super::contracts::pacto_username::ISponsorPolicyRegistry::{
    isTopHatSponsoredCall, moduleToTopHatCall,
};
use super::rpc::call::eth_call_decode;
use super::rpc::wallet_err_json;

pub async fn is_top_hat_sponsored<P: Provider>(
    provider: &P,
    registry: Address,
    top_hat_id: U256,
) -> Result<bool, String> {
    eth_call_decode(
        provider,
        registry,
        &isTopHatSponsoredCall {
            topHatId: top_hat_id,
        },
    )
    .await
    .map_err(|e| wallet_err_json("SPONSOR_POLICY_READ", e, None))
}

pub async fn module_to_top_hat<P: Provider>(
    provider: &P,
    registry: Address,
    module: Address,
) -> Result<U256, String> {
    eth_call_decode(
        provider,
        registry,
        &moduleToTopHatCall { module },
    )
    .await
    .map_err(|e| wallet_err_json("SPONSOR_POLICY_READ", e, None))
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::{address, keccak256};
    use alloy::sol_types::SolCall;

    fn selector(signature: &str) -> [u8; 4] {
        let hash = keccak256(signature.as_bytes());
        [hash[0], hash[1], hash[2], hash[3]]
    }

    #[test]
    fn top_hat_policy_view_selectors_match_canonical_signatures() {
        assert_eq!(
            isTopHatSponsoredCall {
                topHatId: U256::from(1u64),
            }
            .abi_encode(),
            [
                selector("isTopHatSponsored(uint256)").as_slice(),
                &U256::from(1u64).to_be_bytes::<32>(),
            ]
            .concat()
        );
        let module = address!("0x1111111111111111111111111111111111111111");
        assert_eq!(
            moduleToTopHatCall { module }.abi_encode(),
            [
                selector("moduleToTopHat(address)").as_slice(),
                &[0u8; 12],
                module.as_slice(),
            ]
            .concat()
        );
    }
}
