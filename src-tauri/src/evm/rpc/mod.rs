//! Shared EVM helpers: RPC providers, signing, `eth_call`, and structured wallet errors.
//! Contract ABIs live under `crate::evm::contracts`; deployment addresses under `crate::evm::pacto_chain_config`.

pub mod address;
pub mod call;
pub mod config;
pub mod errors;
pub mod provider;
pub mod signer;

pub use address::parse_address;
pub use config::{parse_salt_nonce, RECEIPT_WAIT_TIMEOUT};
pub use errors::{wallet_err_json, wallet_err_json_with_tx_hash};
pub use provider::{connect_read_provider, connect_signing_provider, contract_call_request, send_and_confirm};
