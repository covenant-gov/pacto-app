//! Chunked `eth_getLogs` for governance module event discovery.

use alloy::primitives::{Address, B256};
use alloy::providers::Provider;
use alloy::rpc::types::{Filter, Log};

use super::config::{BLOCK_NUMBER_TIMEOUT, GET_LOGS_CHUNK_TIMEOUT, GET_LOGS_INTER_CHUNK_DELAY};
use super::errors::wallet_err_json;
use crate::evm::wallet_security;

/// Default chunk size for RPC providers that cap `eth_getLogs` ranges.
pub const DEFAULT_LOG_CHUNK_BLOCKS: u64 = 2_000;

/// Look back this many blocks when no deploy/from block is known.
pub const DEFAULT_LOG_LOOKBACK_BLOCKS: u64 = 200_000;

pub async fn get_logs_chunked<P: Provider>(
    provider: &P,
    address: Address,
    from_block: u64,
    to_block: u64,
    chunk_blocks: u64,
    topic0: Option<&[B256]>,
) -> Result<Vec<Log>, String> {
    if from_block > to_block {
        return Ok(Vec::new());
    }
    let chunk = chunk_blocks.max(1);
    let mut out = Vec::new();
    let mut start = from_block;
    while start <= to_block {
        let end = start.saturating_add(chunk - 1).min(to_block);
        let mut filter = Filter::new()
            .address(address)
            .from_block(start)
            .to_block(end);
        if let Some(topics) = topic0 {
            if !topics.is_empty() {
                filter = filter.event_signature(topics.to_vec());
            }
        }
        let batch =
            match tokio::time::timeout(GET_LOGS_CHUNK_TIMEOUT, provider.get_logs(&filter)).await {
                Ok(Ok(logs)) => logs,
                Ok(Err(e)) => {
                    return Err(wallet_err_json(
                        "GET_LOGS",
                        wallet_security::redact_urls_in_text(&e.to_string()),
                        None,
                    ));
                }
                Err(_) => {
                    return Err(wallet_err_json(
                        "GET_LOGS",
                        format!("eth_getLogs timed out for blocks {start}-{end}"),
                        None,
                    ));
                }
            };
        out.extend(batch);
        if end == to_block {
            break;
        }
        start = end.saturating_add(1);
        tokio::time::sleep(GET_LOGS_INTER_CHUNK_DELAY).await;
    }
    Ok(out)
}

/// Resolve inclusive `[from, to]` for a lookback ending at the current tip.
pub async fn resolve_lookback_range<P: Provider>(
    provider: &P,
    from_block: Option<u64>,
    lookback_blocks: u64,
) -> Result<(u64, u64), String> {
    let tip = match tokio::time::timeout(BLOCK_NUMBER_TIMEOUT, provider.get_block_number()).await {
        Ok(Ok(n)) => n,
        Ok(Err(e)) => {
            return Err(wallet_err_json(
                "BLOCK_NUMBER",
                wallet_security::redact_urls_in_text(&e.to_string()),
                None,
            ));
        }
        Err(_) => {
            return Err(wallet_err_json(
                "BLOCK_NUMBER",
                "get_block_number timed out",
                None,
            ));
        }
    };
    let from = match from_block {
        Some(b) => b.min(tip),
        None => tip.saturating_sub(lookback_blocks),
    };
    Ok((from, tip))
}
