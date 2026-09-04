use alloy::network::TransactionBuilder;
use alloy::primitives::{Address, Bytes, U256};
use alloy::providers::Provider;
use alloy::rpc::types::state::StateOverride;
use alloy::rpc::types::TransactionRequest;
use alloy::sol_types::SolCall;
use alloy::transports::{TransportError, TransportErrorKind};
use serde_json::Value;

use super::errors::wallet_err_json;
use crate::evm::wallet_security;

/// Transient HTTP / JSON-RPC transport failures — try the next URL.
pub fn is_retryable_gov_rpc_error(msg: &str) -> bool {
    let m = msg.to_lowercase();
    m.contains("429")
        || m.contains("rate limit")
        || m.contains("-32005")
        || m.contains("502")
        || m.contains("503")
        || m.contains("504")
        || m.contains("522")
        || m.contains("523")
        || m.contains("524")
        || m.contains("timeout")
        || m.contains("timed out")
}

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
    eth_call_from(provider, to, None, None, calldata).await
}

/// `eth_call` with optional `from` (for `msg.sender`-sensitive writes simulated as the roster EOA).
/// Optional `gas` avoids OOG on heavy views (e.g. claim + BIP-340).
pub async fn eth_call_from<P: Provider>(
    provider: &P,
    to: Address,
    from: Option<Address>,
    gas: Option<u64>,
    calldata: Vec<u8>,
) -> Result<Bytes, String> {
    eth_call_from_with_overrides(provider, to, from, gas, calldata, None).await
}

/// `eth_call` with optional EIP-1193 `stateOverride` (e.g. EIP-7702 delegation stub on an EOA).
pub async fn eth_call_from_with_overrides<P: Provider>(
    provider: &P,
    to: Address,
    from: Option<Address>,
    gas: Option<u64>,
    calldata: Vec<u8>,
    state_overrides: Option<StateOverride>,
) -> Result<Bytes, String> {
    let mut tx = TransactionRequest::default()
        .with_to(to)
        .with_input(Bytes::from(calldata));
    if let Some(from) = from {
        tx = tx.with_from(from);
    }
    if let Some(gas) = gas {
        tx = tx.with_gas_limit(gas);
    }

    let mut call = provider.call(tx);
    if let Some(overrides) = state_overrides {
        call = call.overrides(overrides);
    }
    call.await.map(|b| b).map_err(|e| {
        wallet_err_json(
            "ETH_CALL_FAILED",
            wallet_security::redact_urls_in_text(&format_eth_call_error(&e)),
            None,
        )
    })
}

/// Prefer structured RPC revert `data` over Display alone (Display often omits nested hex).
pub fn format_eth_call_error(e: &TransportError) -> String {
    let display = e.to_string();
    if let Some(hex) = extract_revert_hex_from_transport(e) {
        let lower = display.to_ascii_lowercase();
        if !lower.contains(&hex.to_ascii_lowercase()) {
            return format!("{display}, data: '{hex}'");
        }
    }
    display
}

fn extract_revert_hex_from_transport(e: &TransportError) -> Option<String> {
    if let Some(payload) = e.as_error_resp() {
        if let Some(bytes) = payload.as_revert_data() {
            if !bytes.is_empty() {
                return Some(format!("0x{}", hex::encode(bytes)));
            }
        }
        if let Some(raw) = payload.data.as_ref() {
            if let Ok(value) = serde_json::from_str::<Value>(raw.get()) {
                if let Some(bytes) = spelunk_revert_bytes(&value) {
                    if !bytes.is_empty() {
                        return Some(format!("0x{}", hex::encode(bytes)));
                    }
                }
            }
            let trimmed = raw.get().trim().trim_matches('"');
            if trimmed.starts_with("0x") || trimmed.starts_with("0X") {
                return Some(trimmed.to_ascii_lowercase());
            }
        }
    }
    if let Some(TransportErrorKind::HttpError(http)) = e.as_transport_err() {
        if let Ok(value) = serde_json::from_str::<Value>(&http.body) {
            if let Some(bytes) = spelunk_revert_bytes(&value) {
                if !bytes.is_empty() {
                    return Some(format!("0x{}", hex::encode(bytes)));
                }
            }
        }
    }
    None
}

fn spelunk_revert_bytes(value: &Value) -> Option<Bytes> {
    match value {
        Value::String(s) => s.parse().ok(),
        Value::Object(map) => {
            for key in ["data", "revertData", "revert_data", "originalError"] {
                if let Some(v) = map.get(key) {
                    if let Some(b) = spelunk_revert_bytes(v) {
                        return Some(b);
                    }
                }
            }
            map.values().find_map(spelunk_revert_bytes)
        }
        Value::Array(items) => items.iter().find_map(spelunk_revert_bytes),
        _ => None,
    }
}

/// Encode a view call, run `eth_call`, and decode the return data with the generated `SolCall` decoder.
pub async fn eth_call_decode<P, C>(provider: &P, to: Address, call: &C) -> Result<C::Return, String>
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
    use alloy::transports::TransportErrorKind;
    use serde_json::json;

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

    #[test]
    fn decode_abi_u256_takes_last_32_bytes() {
        let mut data = vec![0u8; 40];
        data[39] = 5;
        assert_eq!(decode_abi_u256_return(&data), U256::from(5));
    }

    #[test]
    fn decode_abi_u256_left_pads_short_data() {
        let data = vec![0u8, 0u8, 0u8, 1u8];
        assert_eq!(decode_abi_u256_return(&data), U256::from(1));
    }

    #[test]
    fn decode_abi_u256_zero_bytes() {
        assert_eq!(decode_abi_u256_return(&[0u8; 0]), U256::ZERO);
    }

    #[test]
    fn decode_abi_u256_large_value() {
        let mut word = [0u8; 32];
        word[0] = 0xff;
        word[31] = 0xff;
        assert_eq!(decode_abi_u256_return(&word), U256::from_be_slice(&word));
    }

    #[test]
    fn retryable_gov_rpc_matches_publicnode_429() {
        assert!(is_retryable_gov_rpc_error(
            r#"HTTP error 429 with body: {"error":{"code":-32005,"message":"Rate limit exceeded"}}"#
        ));
        assert!(is_retryable_gov_rpc_error("jsonrpc error code -32005"));
        assert!(!is_retryable_gov_rpc_error(
            "execution reverted: Unauthorized"
        ));
    }

    #[test]
    fn spelunk_nested_original_error_data() {
        let value = json!({
            "originalError": { "code": 3, "data": "0xbb8d46ae" }
        });
        let bytes = spelunk_revert_bytes(&value).expect("bytes");
        assert_eq!(hex::encode(bytes), "bb8d46ae");
    }

    #[test]
    fn format_eth_call_error_reads_http_error_body() {
        let body = r#"{"jsonrpc":"2.0","id":1,"error":{"code":3,"message":"execution reverted","data":"0xb2613b41"}}"#;
        let err = TransportErrorKind::http_error(200, body.into());
        let formatted = format_eth_call_error(&err);
        assert!(
            formatted.to_ascii_lowercase().contains("0xb2613b41"),
            "formatted={formatted}"
        );
    }

    #[test]
    fn format_eth_call_error_appends_when_display_lacks_hex() {
        // Transport Custom with no structured payload — spelunk returns None; Display unchanged.
        let err = TransportErrorKind::custom_str("execution reverted");
        let formatted = format_eth_call_error(&err);
        assert!(formatted.contains("execution reverted"));
        assert!(!formatted.contains("data: '0x"));
    }
}
