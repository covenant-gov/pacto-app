//! Username NFT command DTOs and local policy floor.

use serde::Serialize;

/// Local catalog floor; must stay ≥ on-chain `SponsorPolicyRegistry.policyVersion()`.
pub const PACTO_ACTIONS_POLICY_VERSION: u64 = 3;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsernameRecordDto {
    pub name: String,
    pub evm_address: String,
    pub pending_address: String,
    pub token_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsernameEligibleMemberDto {
    pub npub_hash: String,
    pub token_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsernameClaimResult {
    pub network: String,
    pub chain_id: u64,
    pub path: String,
    pub username: String,
    pub npub_hash: String,
    pub token_id: String,
    pub link_event_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_op_hash: Option<String>,
    pub evm_address: String,
    pub policy_version: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsernameTransferResult {
    pub network: String,
    pub chain_id: u64,
    pub path: String,
    pub npub_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_op_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_address: Option<String>,
}
