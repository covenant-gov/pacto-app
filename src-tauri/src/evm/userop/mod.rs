//! Shared ERC-4337 / EIP-7702 UserOp transport.

pub(crate) mod eip7702;
pub(crate) mod fees;
pub(crate) mod pipeline;
pub(crate) mod placeholder;
pub(crate) mod policy;
pub(crate) mod transport;

pub(crate) use eip7702::{resolve_eip7702_auth_for_sender, sign_eip7702_authorization};
pub(crate) use fees::{fallback_max_fee, fallback_max_priority_fee, resolve_userop_eip1559_fees};
pub(crate) use pipeline::{
    estimate_sponsored_userop, finalize_for_style, sign_and_send_sponsored_userop,
    SponsoredUserOpBuild,
};
pub use placeholder::CLAIM_USERNAME_SELECTOR;
pub(crate) use placeholder::{
    call_gas_ceiling_for_calldata, userop_gas_ceilings, userop_placeholder_max_cost_wei,
    UseropGasCeilings, UseropPlaceholderLane,
};
pub use transport::wait_for_user_operation_receipt;
pub(crate) use transport::{
    apply_userop_gas_margin, apply_verification_gas_margin, bundler_cap_fallback_estimate,
    bundler_estimate_user_operation_gas, bundler_send_user_operation, bundler_userop_gas_cap,
    call_gas_with_margin, clamp_estimated_gas_to_bundler_cap, clamp_userop_gas_limits_to_cap,
    dummy_userop_signature, estimate_call_gas, factory_userop_too_large_error,
    fallback_call_gas_limit, finalize_factory_userop_gas_limits, finalize_userop_gas_limits,
    heavy_call_gas_limit, is_bundler_gas_limit_error, pack_u128s,
    parse_user_operation_gas_price_response, pass2_or_clamped_pass1, paymaster_data,
    paymaster_entry_point_deposit_preflight, should_skip_estimate_calibrate, user_op_json,
    userop_gas_limit_sum, userop_max_cost_wei, wallet_error_code, EstimatedUserOpGas,
    FinalGasLimits, IAccountExecute, IEntryPointV07, UserOpParams,
};
#[allow(unused_imports)]
pub use transport::{
    parse_sponsored_user_op_receipt, wait_for_user_operation_tx_hash, SponsoredUserOpReceipt,
};
