//! Bootstrap username claim preflight: L1 bare `claim()` + L1.5 `execute` under EIP-7702 stub.
//! Shared by `global_sponsor_userop` and `username_claim_harness`.

use alloy::primitives::Address;
use alloy::providers::Provider;
use alloy::rpc::types::state::{AccountOverride, StateOverride, StateOverridesBuilder};

use super::rpc::call::{eth_call_from, eth_call_from_with_overrides};
use super::rpc::errors::extract_revert_selector;
use super::rpc::wallet_err_json;
use super::wallet_security;

/// BIP-340 verify + `_safeMint` headroom; avoid OOG mistaken for empty revert.
pub const CLAIM_ETH_CALL_GAS: u64 = 8_000_000;

/// Bootstrap lane preflight for the real UserOp path (`execute` under EIP-7702).
pub async fn preflight_bootstrap_claim_userop_path<P: Provider>(
    provider: &P,
    member: Address,
    nft: Address,
    entry_point: Address,
    account_impl: Address,
    claim_calldata: &[u8],
    execute_calldata: &[u8],
    code: &[u8],
) -> Result<(), String> {
    if code.is_empty() {
        preflight_claim_eth_call(provider, member, nft, claim_calldata).await?;
    }
    let state_overrides = state_override_7702_stub(member, account_impl);
    run_l15_execute_eth_call(
        provider,
        member,
        entry_point,
        execute_calldata,
        state_overrides,
    )
    .await?;
    Ok(())
}

/// State override: roster EOA delegates to pinned `PactoSimple7702Account`.
pub fn state_override_7702_stub(member: Address, account_impl: Address) -> StateOverride {
    StateOverridesBuilder::default()
        .append(
            member,
            AccountOverride::default().with_7702_delegation_designator(account_impl),
        )
        .build()
}

/// Direct NFT `claim` as roster EOA (no `execute` wrapper). Skipped when roster already has code.
async fn preflight_claim_eth_call<P: Provider>(
    provider: &P,
    member: Address,
    nft: Address,
    claim_calldata: &[u8],
) -> Result<(), String> {
    match eth_call_from(
        provider,
        nft,
        Some(member),
        Some(CLAIM_ETH_CALL_GAS),
        claim_calldata.to_vec(),
    )
    .await
    {
        Ok(_) => Ok(()),
        Err(e) => Err(wallet_err_from_claim_eth_call_failure(&e)),
    }
}

/// `eth_call` of `execute(dest, 0, claim)` on member with EIP-7702 stub override.
/// Prefers `from=EntryPoint`; falls back to `from=member`.
pub async fn run_l15_execute_eth_call<P: Provider>(
    provider: &P,
    member: Address,
    entry_point: Address,
    execute_calldata: &[u8],
    state_overrides: StateOverride,
) -> Result<&'static str, String> {
    let attempts = [(entry_point, "entry_point"), (member, "member")];
    let mut last_detail = String::new();
    let mut last_sel = String::from("none");
    for (from, label) in attempts {
        eprintln!("[pacto_wallet] username L1.5 trying from={label} ({from:#x})");
        match eth_call_from_with_overrides(
            provider,
            member,
            Some(from),
            Some(CLAIM_ETH_CALL_GAS),
            execute_calldata.to_vec(),
            Some(state_overrides.clone()),
        )
        .await
        {
            Ok(_) => {
                eprintln!("[pacto_wallet] username L1.5 OK from={label}");
                return Ok(label);
            }
            Err(e) => {
                let sel = extract_revert_selector(&e).unwrap_or_else(|| "none".into());
                let detail = wallet_security::redact_urls_in_text(&e);
                eprintln!(
                    "[pacto_wallet] username L1.5 FAIL from={label} selector={sel} detail={detail}"
                );
                last_sel = sel;
                last_detail = detail;
            }
        }
    }
    Err(wallet_err_from_l15_failure(&last_sel, &last_detail))
}

fn wallet_err_from_l15_failure(sel: &str, detail: &str) -> String {
    if sel != "none" {
        let mapped =
            wallet_err_from_claim_eth_call_failure(&format!("execution reverted, data: \"0x{sel}\""));
        if mapped.contains("USERNAME_INVALID_")
            || mapped.contains("USERNAME_TAKEN")
            || mapped.contains("USERNAME_NPUB")
            || mapped.contains("ALREADY_CLAIMED")
            || mapped.contains("USERNAME_BINDING")
            || mapped.contains("USERNAME_NONCE")
        {
            return mapped;
        }
    }
    wallet_err_json(
        "USERNAME_CLAIM_REVERTED",
        format!(
            "execute(claim) eth_call under EIP-7702 stub reverted (selector {sel}). Detail: {detail}"
        ),
        None,
    )
}

/// Map a failed claim `eth_call` into a wallet error that keeps the revert selector when present.
pub fn wallet_err_from_claim_eth_call_failure(raw_err: &str) -> String {
    let redacted = wallet_security::redact_urls_in_text(raw_err);
    let selector = extract_revert_selector(&redacted);
    eprintln!(
        "[pacto_wallet] claim eth_call preflight failed selector={} detail={}",
        selector
            .as_deref()
            .map(|s| format!("0x{s}"))
            .unwrap_or_else(|| "none".into()),
        redacted
    );
    if let Some(sel) = selector.as_deref() {
        if let Some((code, msg)) = classify_username_claim_revert(sel) {
            return wallet_err_json(
                code,
                format!("{msg} (selector 0x{sel}). Detail: {redacted}"),
                None,
            );
        }
        return wallet_err_json(
            "USERNAME_CLAIM_REVERTED",
            format!(
                "claim() eth_call reverted with selector 0x{sel} (NFT-side; not EIP-7702/UserOp). Detail: {redacted}"
            ),
            None,
        );
    }
    wallet_err_json(
        "USERNAME_CLAIM_REVERTED",
        format!(
            "claim() eth_call reverted with empty or unknown data (unexpected for typed NFT errors). Detail: {redacted}"
        ),
        None,
    )
}

/// NFT custom-error selectors → structured wallet codes (Layer 1).
fn classify_username_claim_revert(sel: &str) -> Option<(&'static str, &'static str)> {
    match sel {
        "356848bf" => Some(("USERNAME_INVALID_NAME", "claim rejected: invalid name / empty pubkey")),
        "a08dc9f6" => Some(("USERNAME_TAKEN", "claim rejected: name unavailable")),
        "87e0b147" => Some(("USERNAME_NPUB_CLAIMED", "claim rejected: npub already claimed")),
        "057e4afc" => Some(("ALREADY_CLAIMED", "claim rejected: address already claimed")),
        "b2613b41" => Some((
            "USERNAME_INVALID_EVM_SIG",
            "claim rejected: invalid EIP-712 ClaimBinding signature",
        )),
        "8bb09e51" => Some(("USERNAME_INVALID_NPUB_HASH", "claim rejected: npubHash ≠ sha256(0x02||pubkey)")),
        "bb8d46ae" => Some((
            "USERNAME_INVALID_NOSTR_SIG",
            "claim rejected: invalid BIP-340 Nostr claim signature",
        )),
        "97276890" => Some((
            "USERNAME_BINDING_EXPIRED",
            "claim rejected: issuedAt outside chain clock window (±5m / 7d)",
        )),
        "8dd24e09" => Some(("USERNAME_NONCE_USED", "claim rejected: nonce already used")),
        _ => None,
    }
}
