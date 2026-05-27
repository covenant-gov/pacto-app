//! Blockchain / EVM layer: key derivation, RPC, contract bindings, wallet, governance deploy.
//! Kept separate from core messaging, MLS, and Nostr sync logic in the crate root.

pub mod advanced_contract_call;
pub mod contract_call_params;
pub mod contracts;
pub mod evm_accounts;
pub mod evm_keys;
pub mod gov_read;
pub mod hats_read;
pub mod member_governance_read;
pub mod nave_pirata_deploy;
pub mod nave_pirata_read;
pub mod pacto_chain_config;
pub mod rpc;
pub mod safe_deploy;
pub mod squad_sponsor_common;
pub mod squad_sponsor_deploy;
pub mod squad_sponsor_deposit;
pub mod squad_sponsor_read;
pub mod squad_admin_deploy;
pub mod squad_admin_write;
pub mod squad_allowlist;
pub mod treasury_proposals_read;
pub mod wallet_chain_config;
pub mod wallet_ops;
pub mod wallet_prices;
pub mod wallet_rpc_providers;
pub mod wallet_security;

pub use evm_keys::{
    address_from_evm_secret_32, derive_eth_bip44_v1_from_mnemonic_phrase,
    derive_evm_hex_from_nostr_secret, normalize_hex_address,
};
