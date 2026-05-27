use alloy::network::TransactionBuilder;
use alloy::primitives::{Address, Bytes};
use alloy::providers::Provider;
use alloy::rpc::types::TransactionRequest;
use alloy::sol_types::SolCall;

use crate::evm::wallet_security;
use super::errors::wallet_err_json;

/// Read-only contract call (`eth_call`). `calldata` is the ABI-encoded function selector + args.
pub async fn eth_call<P: Provider>(
    provider: &P,
    to: Address,
    calldata: Vec<u8>,
) -> Result<Bytes, String> {
    let tx = TransactionRequest::default()
        .with_to(to)
        .with_input(Bytes::from(calldata));

    provider
        .call(tx)
        .await
        .map(|b| b)
        .map_err(|e| {
            wallet_err_json(
                "ETH_CALL_FAILED",
                wallet_security::redact_urls_in_text(&e.to_string()),
                None,
            )
        })
}

/// Encode a view call, run `eth_call`, and decode the return data with the generated `SolCall` decoder.
pub async fn eth_call_decode<P, C>(
    provider: &P,
    to: Address,
    call: &C,
) -> Result<C::Return, String>
where
    P: Provider,
    C: SolCall,
{
    let raw = eth_call(provider, to, call.abi_encode()).await?;
    C::abi_decode_returns(raw.as_ref()).map_err(|e| {
        wallet_err_json(
            "ETH_CALL_DECODE",
            format!("could not decode return data: {}", e),
            None,
        )
    })
}
