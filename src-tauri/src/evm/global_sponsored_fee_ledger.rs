//! Best-effort ledger rows for global paymaster UserOp spend.

use alloy::primitives::Address;
use alloy::sol_types::SolCall;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_username::IPactoUsernameNFT::{
    cancelAddressTransferCall, claimAddressTransferCall, claimCall,
    initiateAddressTransferCall,
};
use super::global_userop_cost::CLAIM_USERNAME_SELECTOR;
use super::gov_module_write::gov_call_action_label;
use crate::db;

pub const LANE_GOV_MODULE: &str = "gov_module";
pub const LANE_FACTORY: &str = "factory";
pub const LANE_USERNAME_BOOTSTRAP: &str = "username_bootstrap";
pub const LANE_USERNAME_MEMBER: &str = "username_member";

fn calldata_selector_hex(calldata: &[u8]) -> String {
    if calldata.len() >= 4 {
        format!("0x{}", hex::encode(&calldata[..4]))
    } else {
        "0x".to_string()
    }
}

fn username_action_label(calldata: &[u8]) -> (String, String) {
    let selector = calldata_selector_hex(calldata);
    if calldata.len() < 4 {
        return (selector.clone(), selector);
    }
    let sel: [u8; 4] = calldata[..4].try_into().unwrap();
    let name = if sel == claimCall::SELECTOR {
        "claimUsername"
    } else if sel == initiateAddressTransferCall::SELECTOR {
        "initiateAddressTransfer"
    } else if sel == claimAddressTransferCall::SELECTOR {
        "claimAddressTransfer"
    } else if sel == cancelAddressTransferCall::SELECTOR {
        "cancelAddressTransfer"
    } else if sel == CLAIM_USERNAME_SELECTOR {
        "claimUsername"
    } else {
        return (selector.clone(), selector);
    };
    (selector, name.to_string())
}

fn action_label(lane: &str, calldata: &[u8]) -> (String, String) {
    match lane {
        LANE_GOV_MODULE | LANE_FACTORY => gov_call_action_label(calldata),
        LANE_USERNAME_BOOTSTRAP | LANE_USERNAME_MEMBER => username_action_label(calldata),
        _ => {
            let selector = calldata_selector_hex(calldata);
            (selector.clone(), selector)
        }
    }
}

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
    let (selector, action) = action_label(lane, calldata);
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
    use super::*;

    #[test]
    fn username_claim_selector_maps_to_claim_action() {
        let calldata = CLAIM_USERNAME_SELECTOR.to_vec();
        assert_eq!(username_action_label(&calldata).1, "claimUsername");
    }
}
