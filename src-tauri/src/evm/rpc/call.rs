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

const RETRYABLE_HTTP_STATUSES: &[&str] = &["429", "502", "503", "504", "522", "523", "524"];

/// Transient HTTP / JSON-RPC transport failures — try the next URL.
/// Status codes match Alloy's `HTTP error <status>` phrase, not digits inside a wei amount.
pub fn is_retryable_gov_rpc_error(msg: &str) -> bool {
    let m = msg.to_lowercase();
    RETRYABLE_HTTP_STATUSES
        .iter()
        .any(|status| contains_http_error_status(&m, status))
        || m.contains("rate limit")
        || m.contains("-32005")
        || m.contains("timeout")
        || m.contains("timed out")
}

fn contains_http_error_status(lower: &str, status: &str) -> bool {
    let needle = format!("http error {status}");
    let Some(at) = lower.find(&needle) else {
        return false;
    };
    match lower[at + needle.len()..].chars().next() {
        Some(c) if c.is_ascii_digit() => false,
        _ => true,
    }
}

fn structured_wallet_code(err: &str) -> Option<String> {
    let parsed: Value = serde_json::from_str(err).ok()?;
    parsed.get("code")?.as_str().map(str::to_string)
}

/// Chain-URL rotation. A bundler JSON-RPC failure or a known tx hash stays on the current URL.
pub fn gov_chain_rpc_should_failover(err: &str) -> bool {
    if gov_rpc_error_has_tx_hash(err) {
        return false;
    }
    if matches!(
        structured_wallet_code(err).as_deref(),
        Some("BUNDLER_RPC" | "BUNDLER_FEE")
    ) {
        return false;
    }
    is_retryable_gov_rpc_error(err)
}

/// True when a structured wallet error already carries a submitted tx hash.
/// Do not rotate RPC URLs after broadcast (risk of double-submit).
pub fn gov_rpc_error_has_tx_hash(err: &str) -> bool {
    err.contains("\"txHash\"")
}

/// After a retryable gov chain-RPC error on `urls[url_idx]`, return the next index.
/// Logs stage + redacted failing URL. `None` when failover is exhausted, the error is not
/// retryable, a bundler code is set, or a tx hash is already known.
pub fn next_gov_rpc_url_idx(
    urls: &[String],
    url_idx: usize,
    err: &str,
    stage: &str,
) -> Option<usize> {
    if !gov_chain_rpc_should_failover(err) {
        return None;
    }
    let next = url_idx.saturating_add(1);
    if next >= urls.len() {
        return None;
    }
    let failed = urls
        .get(url_idx)
        .map(|u| wallet_security::redact_rpc_url_for_log(u))
        .unwrap_or_else(|| "(unknown)".to_string());
    let detail = wallet_security::redact_urls_in_text(err);
    log::warn!(
        target: "pacto_wallet",
        "gov rpc failover stage={stage} url={failed}: {detail}; trying next"
    );
    Some(next)
}

/// Run `body` at `urls[start]`, then the next URL while the error is a retryable chain-RPC failure.
/// Bundler errors and a known tx hash stop the loop (`next_gov_rpc_url_idx` returns `None`).
/// `?` inside `body` returns from the attempt, not the caller.
macro_rules! fold_gov_rpc_urls {
    ($urls:expr, $start:expr, $stage:expr, $idx:ident, $body:block) => {{
        let mut $idx = $start;
        loop {
            let attempt: Result<_, String> = async { $body }.await;
            match attempt {
                Ok(value) => break Ok(value),
                Err(e) => {
                    if let Some(next) =
                        $crate::evm::rpc::next_gov_rpc_url_idx($urls, $idx, &e, $stage)
                    {
                        $idx = next;
                        continue;
                    }
                    break Err(e);
                }
            }
        }
    }};
}
pub(crate) use fold_gov_rpc_urls;

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
    fn retryable_gov_rpc_matches_alloy_empty_body_429() {
        assert!(is_retryable_gov_rpc_error("HTTP error 429 with empty body"));
    }

    #[test]
    fn retryable_gov_rpc_ignores_wei_digit_runs() {
        assert!(!is_retryable_gov_rpc_error(
            "max fee per gas less than block base fee: 15023456789"
        ));
        assert!(!is_retryable_gov_rpc_error(
            "insufficient funds: have 1429000000000000000"
        ));
    }

    #[test]
    fn gov_chain_rpc_should_failover_skips_bundler_and_tx_hash() {
        assert!(gov_chain_rpc_should_failover(
            "HTTP error 429 with empty body"
        ));
        assert!(!gov_chain_rpc_should_failover(
            r#"{"code":"BUNDLER_RPC","message":"rate limit exceeded"}"#
        ));
        assert!(!gov_chain_rpc_should_failover(
            r#"{"code":"BUNDLER_FEE","message":"HTTP error 429 with empty body"}"#
        ));
        assert!(!gov_chain_rpc_should_failover(
            r#"{"code":"RECEIPT_TIMEOUT","message":"timed out","txHash":"0xabc"}"#
        ));
    }

    #[test]
    fn next_gov_rpc_url_idx_advances_on_retryable() {
        let urls = vec![
            "https://a.example/rpc".into(),
            "https://b.example/rpc".into(),
        ];
        assert_eq!(
            next_gov_rpc_url_idx(&urls, 0, "HTTP error 429 with empty body", "preflight"),
            Some(1)
        );
        assert_eq!(
            next_gov_rpc_url_idx(&urls, 1, "HTTP error 429 with empty body", "preflight"),
            None
        );
        assert_eq!(
            next_gov_rpc_url_idx(&urls, 0, "execution reverted: Unauthorized", "preflight"),
            None
        );
        assert_eq!(
            next_gov_rpc_url_idx(
                &urls,
                0,
                r#"{"code":"BUNDLER_RPC","message":"rate limit"}"#,
                "estimate",
            ),
            None
        );
        assert_eq!(
            next_gov_rpc_url_idx(
                &urls,
                0,
                r#"{"code":"RECEIPT_TIMEOUT","message":"timed out","txHash":"0xabc"}"#,
                "send",
            ),
            None
        );
    }

    #[test]
    fn gov_rpc_error_has_tx_hash_detects_structured_field() {
        assert!(gov_rpc_error_has_tx_hash(
            r#"{"code":"RECEIPT_TIMEOUT","message":"timed out","txHash":"0xabc"}"#
        ));
        assert!(!gov_rpc_error_has_tx_hash(
            r#"{"code":"RPC_CONNECT","message":"HTTP error 429 with empty body"}"#
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

    #[tokio::test]
    async fn fold_gov_rpc_urls_advances_on_retryable_and_stops_on_bundler() {
        let urls = vec!["http://a".to_string(), "http://b".to_string()];
        let mut seen = Vec::new();
        let err = fold_gov_rpc_urls!(&urls, 0, "test", idx, {
            seen.push(idx);
            Err::<(), String>("HTTP error 429 with empty body".to_string())
        })
        .expect_err("exhausted");
        assert_eq!(seen, vec![0, 1]);
        assert!(err.contains("429"));

        for code in ["BUNDLER_RPC", "BUNDLER_FEE"] {
            let mut seen = Vec::new();
            let err = fold_gov_rpc_urls!(&urls, 0, "test", idx, {
                seen.push(idx);
                Err::<(), String>(wallet_err_json(code, "bundler down", None))
            })
            .expect_err("bundler");
            assert_eq!(seen, vec![0], "{code}");
            assert!(err.contains(code), "{err}");
        }
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
