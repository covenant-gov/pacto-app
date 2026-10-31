//! UserOp gas price. Pimlico first; last-resort policy fees if that RPC is down.

use super::policy::policy;
use super::transport::bundler_get_user_operation_gas_price;

/// Floor tip so bundler prechecks do not reject a near-zero quote.
#[inline]
pub(crate) fn fallback_max_priority_fee() -> u128 {
    policy().fallback_max_priority_fee_wei
}

/// Send last-resort max fee when the Pimlico price RPC is down.
#[inline]
pub(crate) fn fallback_max_fee() -> u128 {
    policy().fallback_max_fee_wei
}

/// Raise a non-Pimlico quote to the policy last-resort tip and max fee.
/// The send path does not call this; the unit test locks the floor.
#[cfg(test)]
pub(crate) fn clamp_userop_eip1559_fees(priority: u128, max_fee: u128) -> (u128, u128) {
    let priority = priority.max(fallback_max_priority_fee());
    let max_fee = max_fee.max(priority).max(fallback_max_fee());
    (priority, max_fee)
}

/// Bundler `standard` tier. Last-resort policy fees if the price RPC is down.
pub(crate) async fn resolve_userop_eip1559_fees(bundler_url: &str) -> (u128, u128) {
    match bundler_get_user_operation_gas_price(bundler_url).await {
        Ok(fees) => fees,
        Err(e) => {
            log::warn!(
                target: "pacto_wallet",
                "pimlico_getUserOperationGasPrice failed; using last-resort fees: {e}"
            );
            (fallback_max_priority_fee(), fallback_max_fee())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_userop_fees_raises_tip_floor_and_keeps_max_fee_above_tip() {
        let (p, f) = clamp_userop_eip1559_fees(1_500_000, 20_000_000_000);
        assert_eq!(p, fallback_max_priority_fee());
        assert_eq!(f, fallback_max_fee());

        let (p, f) = clamp_userop_eip1559_fees(1_500_000, 500_000);
        assert_eq!(p, fallback_max_priority_fee());
        assert_eq!(f, fallback_max_fee());

        let (p, f) = clamp_userop_eip1559_fees(2_000_000_000, 40_000_000_000);
        assert_eq!(p, 2_000_000_000);
        assert_eq!(f, 40_000_000_000);
    }
}
