use alloy::network::TransactionBuilder;
use alloy::primitives::{Address, Bytes, U256};
use alloy::providers::Provider;
use alloy::rpc::types::TransactionRequest;
use alloy::sol_types::SolCall;

use crate::evm::wallet_security;
use super::errors::wallet_err_json;

/// ABI `uint256` return. Empty or short RPC payloads → zero (EOA target, no code, stripped leading zeros).
pub fn decode_abi_u256_return(data: &[u8]) -> U256 {
    if data.is_empty() {
        return U256::ZERO;
    }
    if data.len() >= 32 {
        return U256::from_be_slice(&data[data.len() - 32..]);
    }
    let mut word = [0u8; 32];
    word[32 - data.len()..].copy_from_slice(data);
    U256::from_be_slice(&word)
}

/// Read-only `eth_call` expecting a single `uint256` return word.
pub async fn eth_call_u256<P: Provider>(
    provider: &P,
    to: Address,
    calldata: Vec<u8>,
) -> Result<U256, String> {
    let raw = eth_call(provider, to, calldata).await?;
    Ok(decode_abi_u256_return(raw.as_ref()))
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_abi_u256_empty_is_zero() {
        assert_eq!(decode_abi_u256_return(&[]), U256::ZERO);
    }

    #[test]
    fn decode_abi_u256_short_is_left_padded() {
        assert_eq!(decode_abi_u256_return(&[1]), U256::from(1));
        assert_eq!(decode_abi_u256_return(&[0, 0, 1]), U256::from(1));
    }

    #[test]
    fn decode_abi_u256_word() {
        let mut word = [0u8; 32];
        word[31] = 42;
        assert_eq!(decode_abi_u256_return(&word), U256::from(42));
    }
}
