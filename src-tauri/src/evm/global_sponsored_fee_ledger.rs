//! Best-effort ledger rows for global paymaster UserOp spend.

use alloy::primitives::Address;
use tauri::{AppHandle, Runtime};

use super::sponsored_action_label::sponsored_action_label;
use crate::db;

pub const LANE_GOV_MODULE: &str = "gov_module";
pub const LANE_FACTORY: &str = "factory";
pub const LANE_USERNAME_BOOTSTRAP: &str = "username_bootstrap";
pub const LANE_USERNAME_MEMBER: &str = "username_member";

pub fn persist_global_sponsored_fee_usage<R: Runtime>(
    app: &AppHandle<R>,
    lane: &str,
    parent_id: Option<&str>,
    chain: &str,
    chain_id: u64,
    actor_evm: Address,
    target: Address,
    calldata: &[u8],
    user_op_hash: &str,
    tx_hash: &str,
    amount_wei: &str,
) {
    let actor_npub = match crate::account_manager::get_current_account() {
        Ok(npub) => npub,
        Err(e) => {
            log::warn!(
                target: "pacto_wallet",
                "global sponsored fee ledger skipped (no current account): {e}"
            );
            return;
        }
    };
    let (selector, action) = sponsored_action_label(calldata);
    let row = db::GlobalSponsoredFeeUsageInsert {
        lane: lane.to_string(),
        parent_id: parent_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        chain: chain.to_string(),
        chain_id,
        actor_npub,
        actor_evm: format!("{actor_evm:#x}"),
        amount_wei: amount_wei.to_string(),
        selector,
        action,
        target: format!("{target:#x}"),
        user_op_hash: user_op_hash.to_string(),
        tx_hash: tx_hash.to_string(),
    };
    if let Err(e) = db::insert_global_sponsored_fee_usage(app, &row) {
        log::warn!(
            target: "pacto_wallet",
            "global sponsored fee ledger insert failed for {user_op_hash}: {e}"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::sponsored_action_label;
    use crate::evm::userop::CLAIM_USERNAME_SELECTOR;

    #[test]
    fn username_claim_selector_maps_to_claim_action() {
        let calldata = CLAIM_USERNAME_SELECTOR.to_vec();
        assert_eq!(sponsored_action_label(&calldata).1, "claimUsername");
    }
}
