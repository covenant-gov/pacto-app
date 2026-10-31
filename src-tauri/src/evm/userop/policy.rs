//! Shared ERC-4337 bundler gas policy.
//! Source: `src/lib/evm/userop-bundler-policy.json`.

use once_cell::sync::Lazy;
use serde::Deserialize;

const EMBEDDED_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../src/lib/evm/userop-bundler-policy.json"
));

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BundlerPolicy {
    pub(crate) bundler_user_op_gas_cap: u128,
    pub(crate) call_gas_margin_bps: u128,
    pub(crate) verification_gas_max_pad_bps: u128,
    pub(crate) fallback_call_gas_limit: u128,
    pub(crate) heavy_call_gas_limit: u128,
    pub(crate) fallback_pre_verification_gas: u128,
    pub(crate) default_verification_gas_limit: u128,
    pub(crate) default_paymaster_verification_gas_limit: u128,
    pub(crate) default_post_op_gas_limit: u128,
    pub(crate) factory_call_gas_limit: u128,
    pub(crate) factory_verification_gas_limit: u128,
    pub(crate) factory_pre_verification_gas: u128,
    pub(crate) factory_paymaster_post_op_gas_limit: u128,
    /// Locked by the JSON test. The pipeline switches on `factory_style`.
    #[allow(dead_code)]
    pub(crate) factory_pad: bool,
    /// Locked by the JSON test. The pipeline switches on `factory_style`.
    #[allow(dead_code)]
    pub(crate) factory_calibrate: bool,
    pub(crate) fallback_max_priority_fee_wei: u128,
    pub(crate) fallback_max_fee_wei: u128,
    pub(crate) pool_balance_headroom_bps: u64,
    pub(crate) paymaster_data_offset: usize,
    /// Human note in the JSON. Not a gas knob.
    #[allow(dead_code)]
    notes: String,
}

static POLICY: Lazy<BundlerPolicy> = Lazy::new(|| {
    serde_json::from_str(EMBEDDED_JSON).expect("userop-bundler-policy.json must parse")
});

pub(crate) fn policy() -> &'static BundlerPolicy {
    &POLICY
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_json_matches_landed_knobs() {
        let p = policy();
        assert_eq!(p.bundler_user_op_gas_cap, 16_000_000);
        assert_eq!(p.call_gas_margin_bps, 12_000);
        assert_eq!(p.verification_gas_max_pad_bps, 20_000);
        assert_eq!(p.fallback_call_gas_limit, 500_000);
        assert_eq!(p.heavy_call_gas_limit, 1_500_000);
        assert_eq!(p.fallback_pre_verification_gas, 80_000);
        assert_eq!(p.default_verification_gas_limit, 100_000);
        assert_eq!(p.default_paymaster_verification_gas_limit, 500_000);
        assert_eq!(p.default_post_op_gas_limit, 50_000);
        assert_eq!(p.factory_call_gas_limit, 14_000_000);
        assert_eq!(p.factory_verification_gas_limit, 1_000_000);
        assert_eq!(p.factory_pre_verification_gas, 200_000);
        assert_eq!(p.factory_paymaster_post_op_gas_limit, 100_000);
        assert!(!p.factory_pad);
        assert!(!p.factory_calibrate);
        assert_eq!(p.fallback_max_priority_fee_wei, 1_000_000_000);
        assert_eq!(p.fallback_max_fee_wei, 30_000_000_000);
        assert_eq!(p.pool_balance_headroom_bps, 11_500);
        assert_eq!(p.paymaster_data_offset, 52);
        assert_eq!(
            p.factory_call_gas_limit
                + p.factory_verification_gas_limit
                + p.factory_pre_verification_gas
                + p.default_paymaster_verification_gas_limit
                + p.factory_paymaster_post_op_gas_limit,
            15_800_000
        );
        assert!(p.notes.contains("Pimlico"));
        assert!(p.notes.to_lowercase().contains("last-resort"));
    }
}
