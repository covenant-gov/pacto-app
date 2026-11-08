use std::time::{Duration, Instant};

use alloy::consensus::SignableTransaction;
use alloy::eips::eip2718::Encodable2718;
use alloy::network::{EthereumWallet, TransactionBuilder, TxSigner};
use alloy::primitives::{Address, Bytes, TxHash};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::rpc::types::{TransactionReceipt, TransactionRequest};
use alloy::signers::local::PrivateKeySigner;

use super::call::{fold_gov_rpc_urls, gov_rpc_error_has_tx_hash, is_retryable_gov_rpc_error};
use super::config::RECEIPT_WAIT_TIMEOUT;
use super::errors::{wallet_err_from_send_failure, wallet_err_json, wallet_err_json_with_tx_hash};
use crate::evm::wallet_security;

/// Builds the client backing every alloy JSON-RPC provider this module
/// constructs, gated through the shared Tor transport switch. Alloy pins a
/// different major `reqwest` version (0.13) than the rest of this crate
/// (0.12, see `Cargo.toml`'s `reqwest013` comment), so this can't reuse
/// `net_transport::http_client_builder` -- it configures the same local
/// SOCKS address directly on alloy's own `reqwest` instance instead.
/// Without this, alloy's `.connect(url)` builds an unproxied client
/// internally, and wallet RPC calls (balance/gas reads, tx broadcasts,
/// receipt polling) would leak the caller's real IP alongside their EVM
/// address even with Tor routing enabled.
pub(crate) fn tor_aware_http_client() -> Result<reqwest013::Client, String> {
    let builder = reqwest013::Client::builder();
    match crate::net_transport::active_socks_addr() {
        Some(addr) => reqwest013::Proxy::all(format!("socks5h://{addr}"))
            .map(|proxy| builder.proxy(proxy))
            .map_err(|e| {
                format!(
                    "Tor routing is enabled but the local proxy could not be configured for the wallet RPC client: {e}"
                )
            }),
        None => Ok(builder),
    }
    .and_then(|b| b.build().map_err(|e| e.to_string()))
}

pub async fn connect_read_provider(urls: &[String]) -> Result<impl Provider + Clone, String> {
    let mut last_err = String::new();
    for url_s in urls {
        let parsed_url = match url_s.parse::<url::Url>() {
            Ok(u) => u,
            Err(_) => {
                last_err = "invalid RPC URL".to_string();
                continue;
            }
        };
        match tor_aware_http_client() {
            Ok(client) => return Ok(ProviderBuilder::new().connect_reqwest(client, parsed_url)),
            Err(e) => {
                last_err = wallet_security::redact_urls_in_text(&e);
                continue;
            }
        }
    }
    Err(wallet_err_json(
        "RPC_CONNECT",
        format!("tried {} URL(s), last error: {}", urls.len(), last_err),
        None,
    ))
}

/// Signing provider: gas + blob-gas + **pending** nonce (not cached) + chain id.
pub async fn connect_signing_provider(
    urls: &[String],
    wallet: EthereumWallet,
) -> Result<impl Provider + Clone, String> {
    let mut last_err = String::new();
    for url_s in urls {
        let parsed_url = match url_s.parse::<url::Url>() {
            Ok(u) => u,
            Err(_) => {
                last_err = "invalid RPC URL".to_string();
                continue;
            }
        };
        match tor_aware_http_client() {
            Ok(client) => {
                return Ok(ProviderBuilder::new()
                    .disable_recommended_fillers()
                    .with_gas_estimation()
                    .with_blob_gas_estimation()
                    .with_simple_nonce_management()
                    .fetch_chain_id()
                    .wallet(wallet.clone())
                    .connect_reqwest(client, parsed_url));
            }
            Err(e) => {
                last_err = wallet_security::redact_urls_in_text(&e);
                continue;
            }
        }
    }
    Err(wallet_err_json(
        "RPC_CONNECT",
        format!("tried {} URL(s), last error: {}", urls.len(), last_err),
        None,
    ))
}

fn is_nonce_too_low(err: &str) -> bool {
    err.to_ascii_lowercase().contains("nonce too low")
}

pub async fn send_transaction_only<P: Provider>(
    provider: &P,
    tx: TransactionRequest,
) -> Result<String, String> {
    let pending = provider.send_transaction(tx).await.map_err(|e| {
        wallet_err_from_send_failure(&wallet_security::redact_urls_in_text(&e.to_string()))
    })?;
    Ok(format!("0x{:x}", *pending.tx_hash()))
}

async fn send_and_confirm_once<P: Provider>(
    provider: &P,
    tx: TransactionRequest,
    receipt_timeout_message: &str,
) -> Result<TransactionReceipt, String> {
    let pending = provider.send_transaction(tx).await.map_err(|e| {
        wallet_err_from_send_failure(&wallet_security::redact_urls_in_text(&e.to_string()))
    })?;

    let submitted_tx_hash = format!("0x{:x}", *pending.tx_hash());
    let receipt = pending
        .with_timeout(Some(RECEIPT_WAIT_TIMEOUT))
        .get_receipt()
        .await
        .map_err(|_| {
            wallet_err_json_with_tx_hash(
                "RECEIPT_TIMEOUT",
                format!(
                    "{receipt_timeout_message} Do not resubmit the same calldata; look up tx {submitted_tx_hash} on the explorer."
                ),
                None,
                submitted_tx_hash,
            )
        })?;

    if !receipt.status() {
        return Err(wallet_err_json_with_tx_hash(
            "TX_REVERTED",
            "Transaction was mined but reverted",
            None,
            format!("0x{:x}", receipt.transaction_hash),
        ));
    }

    Ok(receipt)
}

pub async fn send_and_confirm<P: Provider>(
    provider: &P,
    tx: TransactionRequest,
    receipt_timeout_message: &str,
) -> Result<TransactionReceipt, String> {
    match send_and_confirm_once(provider, tx.clone(), receipt_timeout_message).await {
        Ok(receipt) => Ok(receipt),
        Err(e) if is_nonce_too_low(&e) => {
            send_and_confirm_once(provider, tx, receipt_timeout_message).await
        }
        Err(e) => Err(e),
    }
}

pub async fn wait_for_transaction_receipt<P: Provider>(
    provider: &P,
    tx_hash: TxHash,
    receipt_timeout_message: &str,
) -> Result<TransactionReceipt, String> {
    wait_for_transaction_receipt_with_timeout(
        provider,
        tx_hash,
        receipt_timeout_message,
        RECEIPT_WAIT_TIMEOUT,
    )
    .await
}

async fn wait_for_transaction_receipt_with_timeout<P: Provider>(
    provider: &P,
    tx_hash: TxHash,
    receipt_timeout_message: &str,
    timeout: Duration,
) -> Result<TransactionReceipt, String> {
    let submitted = format!("0x{:x}", tx_hash);
    let deadline = Instant::now() + timeout;
    loop {
        let receipt = provider
            .get_transaction_receipt(tx_hash)
            .await
            .map_err(|e| {
                wallet_err_json(
                    "RECEIPT_POLL_FAILED",
                    wallet_security::redact_urls_in_text(&e.to_string()),
                    None,
                )
            })?;
        if let Some(receipt) = receipt {
            if !receipt.status() {
                return Err(wallet_err_json_with_tx_hash(
                    "TX_REVERTED",
                    "Transaction was mined but reverted",
                    None,
                    submitted,
                ));
            }
            return Ok(receipt);
        }
        if Instant::now() >= deadline {
            return Err(wallet_err_json_with_tx_hash(
                "RECEIPT_TIMEOUT",
                receipt_timeout_message,
                None,
                submitted,
            ));
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

pub fn contract_call_request(to: Address, calldata: Vec<u8>) -> TransactionRequest {
    TransactionRequest::default()
        .with_to(to)
        .with_input(Bytes::from(calldata))
}

struct FilledGovEoaTx {
    gas: u64,
    nonce: u64,
    max_fee: u128,
    max_priority: u128,
}

/// Signed EOA governance payload. Broadcast reuses `raw`; do not refill the nonce.
#[derive(Debug)]
pub(crate) struct SignedGovEoaTx {
    pub raw: Bytes,
    pub hash: TxHash,
}

const GOV_EOA_RECEIPT_TIMEOUT: &str = "Timed out waiting for governance confirmation. The transaction may still confirm — do not resubmit the same calldata; check the explorer with the returned tx hash.";

/// Estimate gas, fees, and the pending nonce, rotating on retryable chain errors. Nothing is signed here.
pub(crate) async fn fill_sign_gov_eoa_tx(
    urls: &[String],
    start_idx: usize,
    signer: &PrivateKeySigner,
    to: Address,
    calldata: Vec<u8>,
    chain_id: u64,
) -> Result<(SignedGovEoaTx, usize), String> {
    let from = signer.address();
    let (filled, filled_idx) =
        fold_gov_rpc_urls!(urls, start_idx, "gov_write_eoa_fill", url_idx, {
            let provider = connect_read_provider(&urls[url_idx..]).await?;
            let filled = fill_gov_eoa_tx(&provider, from, to, &calldata).await?;
            Ok((filled, url_idx))
        })?;
    let signed = sign_gov_eoa_tx(signer, to, calldata, chain_id, filled).await?;
    Ok((signed, filled_idx))
}

/// `eth_sendRawTransaction` of `signed.raw`. A retryable miss tries the next URL with the same bytes.
/// Any later error includes the local hash and does not sign again.
pub(crate) async fn broadcast_signed_gov_eoa_tx(
    urls: &[String],
    start_idx: usize,
    signed: &SignedGovEoaTx,
    receipt_timeout: Duration,
) -> Result<TransactionReceipt, String> {
    let raw = signed.raw.clone();
    let hash = signed.hash;
    fold_gov_rpc_urls!(urls, start_idx, "gov_write_eoa_raw", url_idx, {
        let provider = connect_read_provider(&urls[url_idx..]).await?;
        match provider.send_raw_transaction(raw.as_ref()).await {
            Ok(_) => wait_for_transaction_receipt_with_timeout(
                &provider,
                hash,
                GOV_EOA_RECEIPT_TIMEOUT,
                receipt_timeout,
            )
            .await
            .map_err(|e| attach_local_tx_hash(e, hash)),
            Err(e) => {
                let err = wallet_err_from_send_failure(&wallet_security::redact_urls_in_text(
                    &e.to_string(),
                ));
                if is_retryable_gov_rpc_error(&err) && !gov_rpc_error_has_tx_hash(&err) {
                    Err(err)
                } else {
                    Err(attach_local_tx_hash(err, hash))
                }
            }
        }
    })
    .map_err(|e| attach_local_tx_hash(e, hash))
}

async fn fill_gov_eoa_tx<P: Provider>(
    provider: &P,
    from: Address,
    to: Address,
    calldata: &[u8],
) -> Result<FilledGovEoaTx, String> {
    let request = contract_call_request(to, calldata.to_vec()).with_from(from);
    let gas = provider
        .estimate_gas(request)
        .await
        .map_err(redacted_rpc_err)?;
    let fees = provider
        .estimate_eip1559_fees()
        .await
        .map_err(redacted_rpc_err)?;
    let nonce = provider
        .get_transaction_count(from)
        .pending()
        .await
        .map_err(redacted_rpc_err)?;
    Ok(FilledGovEoaTx {
        gas,
        nonce,
        max_fee: fees.max_fee_per_gas,
        max_priority: fees.max_priority_fee_per_gas,
    })
}

async fn sign_gov_eoa_tx(
    signer: &PrivateKeySigner,
    to: Address,
    calldata: Vec<u8>,
    chain_id: u64,
    filled: FilledGovEoaTx,
) -> Result<SignedGovEoaTx, String> {
    let tx = contract_call_request(to, calldata)
        .with_from(signer.address())
        .with_chain_id(chain_id)
        .with_nonce(filled.nonce)
        .with_gas_limit(filled.gas)
        .with_max_fee_per_gas(filled.max_fee)
        .with_max_priority_fee_per_gas(filled.max_priority);
    let mut unsigned = tx.build_unsigned().map_err(|e| {
        wallet_err_json(
            "GOV_TX_BUILD",
            wallet_security::redact_urls_in_text(&e.to_string()),
            None,
        )
    })?;
    let signature = signer.sign_transaction(&mut unsigned).await.map_err(|e| {
        wallet_err_json(
            "GOV_TX_SIGN",
            wallet_security::redact_urls_in_text(&e.to_string()),
            None,
        )
    })?;
    let signed = unsigned.into_signed(signature);
    let hash = *signed.hash();
    let raw = Bytes::from(signed.encoded_2718());
    Ok(SignedGovEoaTx { raw, hash })
}

fn redacted_rpc_err(err: impl ToString) -> String {
    wallet_security::redact_urls_in_text(&err.to_string())
}

fn attach_local_tx_hash(err: String, hash: TxHash) -> String {
    if gov_rpc_error_has_tx_hash(&err) {
        return err;
    }
    wallet_err_json_with_tx_hash("GOV_BROADCAST", err, None, format!("{hash:#x}"))
}

#[cfg(test)]
mod tests {
    use super::is_nonce_too_low;

    #[test]
    fn nonce_too_low_matches_geth_and_wrapped_json() {
        assert!(is_nonce_too_low(
            "server returned an error response: error code -32000: nonce too low: next nonce 117, tx nonce 114"
        ));
        assert!(is_nonce_too_low(
            r#"{"code":"SEND_FAILED","message":"Nonce too low"}"#
        ));
        assert!(!is_nonce_too_low("insufficient funds"));
        assert!(!is_nonce_too_low("replacement transaction underpriced"));
    }
}

#[cfg(test)]
mod gov_eoa_broadcast_tests {
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use alloy::consensus::{Transaction, TxEnvelope};
    use alloy::eips::eip2718::Decodable2718;
    use alloy::primitives::{address, Address};
    use alloy::signers::local::PrivateKeySigner;
    use serde_json::{json, Value};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};

    use super::{broadcast_signed_gov_eoa_tx, fill_sign_gov_eoa_tx};

    const TO: Address = address!("0x00000000000000000000000000000000000000bb");
    const CALLDATA: &[u8] = &[0xab, 0xcd, 0xef, 0x01];
    const FEE_HISTORY: &str = r#"{"baseFeePerGas":["0x342770c0","0x2da282a8"],"gasUsedRatio":[0.0],"baseFeePerBlobGas":["0x0","0x0"],"blobGasUsedRatio":[0.0],"oldestBlock":"0x1"}"#;
    const SENT_HASH: &str = "0x1111111111111111111111111111111111111111111111111111111111111111";

    struct RpcHit {
        method: String,
        raw_tx: Option<String>,
    }

    enum RpcReply {
        Status(u16),
        Result(Value),
        Error { code: i64, message: &'static str },
    }

    fn signer() -> PrivateKeySigner {
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
            .parse()
            .expect("signer")
    }

    fn spawn_rpc(
        log: Arc<Mutex<Vec<RpcHit>>>,
        reply: impl Fn(&Value) -> RpcReply + Send + Sync + 'static,
    ) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        listener.set_nonblocking(true).expect("nonblocking");
        let addr = listener.local_addr().expect("addr");
        let listener = TcpListener::from_std(listener).expect("tokio listener");
        let reply: Arc<dyn Fn(&Value) -> RpcReply + Send + Sync> = Arc::new(reply);
        tokio::spawn(async move {
            loop {
                let Ok((sock, _)) = listener.accept().await else {
                    break;
                };
                let log = log.clone();
                let reply = reply.clone();
                tokio::spawn(async move {
                    serve_one(sock, log, reply).await;
                });
            }
        });
        format!("http://{addr}")
    }

    async fn serve_one(
        mut sock: TcpStream,
        log: Arc<Mutex<Vec<RpcHit>>>,
        reply: Arc<dyn Fn(&Value) -> RpcReply + Send + Sync>,
    ) {
        let Some(body) = read_http_body(&mut sock).await else {
            return;
        };
        let Ok(req) = serde_json::from_slice::<Value>(&body) else {
            return;
        };
        let method = req["method"].as_str().unwrap_or("").to_string();
        let raw_tx = (method == "eth_sendRawTransaction")
            .then(|| req["params"][0].as_str().unwrap_or("").to_string());
        log.lock().expect("log").push(RpcHit { method, raw_tx });
        let bytes = http_bytes(&req["id"], reply(&req));
        let _ = sock.write_all(&bytes).await;
        let _ = sock.shutdown().await;
    }

    async fn read_http_body(sock: &mut TcpStream) -> Option<Vec<u8>> {
        let mut buf = Vec::new();
        let mut tmp = [0u8; 8192];
        loop {
            let n = sock.read(&mut tmp).await.ok()?;
            if n == 0 {
                return http_body(&buf);
            }
            buf.extend_from_slice(&tmp[..n]);
            if let Some(body) = http_body(&buf) {
                return Some(body);
            }
            if buf.len() > 1_000_000 {
                return None;
            }
        }
    }

    fn http_body(buf: &[u8]) -> Option<Vec<u8>> {
        let sep = buf.windows(4).position(|w| w == b"\r\n\r\n")?;
        let header = std::str::from_utf8(&buf[..sep]).ok()?;
        let len = header.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })?;
        let start = sep + 4;
        if buf.len() < start + len {
            return None;
        }
        Some(buf[start..start + len].to_vec())
    }

    fn http_bytes(id: &Value, reply: RpcReply) -> Vec<u8> {
        let (status, body) = match reply {
            RpcReply::Status(429) => ("429 Too Many Requests", String::new()),
            RpcReply::Status(502) => ("502 Bad Gateway", String::new()),
            RpcReply::Status(_) => ("500 Internal Server Error", String::new()),
            RpcReply::Result(result) => (
                "200 OK",
                json!({"jsonrpc":"2.0","id": id, "result": result}).to_string(),
            ),
            RpcReply::Error { code, message } => (
                "200 OK",
                json!({"jsonrpc":"2.0","id": id, "error": {"code": code, "message": message}})
                    .to_string(),
            ),
        };
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .into_bytes()
    }

    fn fill_reply(req: &Value) -> RpcReply {
        match req["method"].as_str().unwrap_or("") {
            "eth_estimateGas" => RpcReply::Result(json!("0x5208")),
            "eth_feeHistory" => RpcReply::Result(serde_json::from_str(FEE_HISTORY).expect("fee")),
            "eth_getTransactionCount" => RpcReply::Result(json!("0x7")),
            "eth_sendRawTransaction" => RpcReply::Result(json!(SENT_HASH)),
            "eth_getTransactionReceipt" => RpcReply::Result(Value::Null),
            _ => RpcReply::Error {
                code: -32601,
                message: "unexpected method",
            },
        }
    }

    fn raw_txs(log: &Mutex<Vec<RpcHit>>) -> Vec<String> {
        log.lock()
            .expect("log")
            .iter()
            .filter_map(|hit| hit.raw_tx.clone())
            .collect()
    }

    fn methods(log: &Mutex<Vec<RpcHit>>) -> Vec<String> {
        log.lock()
            .expect("log")
            .iter()
            .map(|hit| hit.method.clone())
            .collect()
    }

    fn assert_nonce(raw_hex: &str, nonce: u64) {
        let bytes = hex::decode(raw_hex.trim_start_matches("0x")).expect("hex");
        let tx = TxEnvelope::decode_2718_exact(&bytes).expect("envelope");
        assert_eq!(tx.nonce(), nonce);
    }

    #[tokio::test]
    async fn estimate_429_fills_on_the_second_url_and_only_that_url_sees_send_raw() {
        let first = Arc::new(Mutex::new(Vec::new()));
        let second = Arc::new(Mutex::new(Vec::new()));
        let first_log = first.clone();
        let url_a = spawn_rpc(first, |req| {
            if req["method"] == "eth_estimateGas" {
                RpcReply::Status(429)
            } else {
                RpcReply::Error {
                    code: -32000,
                    message: "first url should only see estimate",
                }
            }
        });
        let url_b = spawn_rpc(second.clone(), fill_reply);
        let urls = vec![url_a, url_b];
        let (signed, idx) = fill_sign_gov_eoa_tx(&urls, 0, &signer(), TO, CALLDATA.to_vec(), 1)
            .await
            .expect("fill");
        assert_eq!(idx, 1);
        let err = broadcast_signed_gov_eoa_tx(&urls, idx, &signed, Duration::ZERO)
            .await
            .expect_err("receipt timeout");
        assert!(err.contains("\"txHash\""), "{err}");
        assert!(
            methods(&first_log)
                .iter()
                .all(|method| method != "eth_sendRawTransaction"),
            "{:?}",
            methods(&first_log)
        );
        let sent = raw_txs(&second);
        assert_eq!(sent.len(), 1, "{:?}", methods(&second));
        assert_nonce(&sent[0], 7);
    }

    #[tokio::test]
    async fn terminal_estimate_error_does_not_touch_the_second_url() {
        let first = Arc::new(Mutex::new(Vec::new()));
        let second = Arc::new(Mutex::new(Vec::new()));
        let url_a = spawn_rpc(first, |_| RpcReply::Error {
            code: 3,
            message: "execution reverted",
        });
        let url_b = spawn_rpc(second.clone(), fill_reply);
        let urls = vec![url_a, url_b];
        let err = fill_sign_gov_eoa_tx(&urls, 0, &signer(), TO, CALLDATA.to_vec(), 1)
            .await
            .expect_err("revert");
        assert!(
            err.to_ascii_lowercase().contains("execution reverted"),
            "{err}"
        );
        assert!(methods(&second).is_empty(), "{:?}", methods(&second));
    }

    #[tokio::test]
    async fn receipt_timeout_after_a_hash_includes_that_hash_and_does_not_send_again() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let url = spawn_rpc(log.clone(), fill_reply);
        let urls = vec![url];
        let (signed, idx) = fill_sign_gov_eoa_tx(&urls, 0, &signer(), TO, CALLDATA.to_vec(), 1)
            .await
            .expect("fill");
        let err = broadcast_signed_gov_eoa_tx(&urls, idx, &signed, Duration::ZERO)
            .await
            .expect_err("timeout");
        let parsed: Value = serde_json::from_str(&err).expect("json");
        assert_eq!(parsed["code"], "RECEIPT_TIMEOUT");
        assert_eq!(parsed["txHash"], format!("{:#x}", signed.hash));
        assert_eq!(raw_txs(&log).len(), 1);
    }

    #[tokio::test]
    async fn lost_send_raw_response_rebroadcasts_the_same_bytes_and_nonce() {
        let first = Arc::new(Mutex::new(Vec::new()));
        let second = Arc::new(Mutex::new(Vec::new()));
        let url_a = spawn_rpc(first.clone(), |req| {
            if req["method"] == "eth_sendRawTransaction" {
                RpcReply::Status(502)
            } else {
                fill_reply(req)
            }
        });
        let url_b = spawn_rpc(second.clone(), fill_reply);
        let urls = vec![url_a, url_b];
        let (signed, idx) = fill_sign_gov_eoa_tx(&urls, 0, &signer(), TO, CALLDATA.to_vec(), 1)
            .await
            .expect("fill");
        assert_eq!(idx, 0);
        let err = broadcast_signed_gov_eoa_tx(&urls, idx, &signed, Duration::ZERO)
            .await
            .expect_err("receipt timeout after rebroadcast");
        assert!(err.contains("\"txHash\""), "{err}");
        let sent = [raw_txs(&first), raw_txs(&second)].concat();
        assert_eq!(sent.len(), 2, "{sent:?}");
        assert_eq!(sent[0], sent[1]);
        assert_nonce(&sent[0], 7);
        assert_nonce(&sent[1], 7);
    }
}
