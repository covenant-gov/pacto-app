//! Deploy a full Nave Pirata stack via `INavePirataFactory.deployNavePirata` using the embedded EVM key.
//!
//! Deployment infra addresses: `pacto_chain_config` (`PACTO_*` env vars; see `.env.example`).

use alloy::primitives::{keccak256, Address, B256, U256};
use alloy::providers::Provider;
use alloy::rpc::types::TransactionReceipt;
use alloy::sol_types::SolCall;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Runtime};

use crate::db;

use super::contracts::pacto_gov::read_bindings::INavePirataRegistry::NavePirataRegistered;
use super::contracts::pacto_gov::INavePirataFactory::{
    deployNavePirataCall, CrewVoteMode, DeployParams, SquadParams, StackKind,
};
use super::gov_read::rpc_urls_or_default;
use super::pacto_chain_config;
use super::rpc::signer::{
    load_active_squad_embedded_signer, load_squad_roster_embedded_signer,
    require_roster_treasury_signing_allowed, require_treasury_signing_allowed,
};
use super::rpc::{
    connect_signing_provider, contract_call_request, parse_address, parse_salt_nonce,
    send_and_confirm, wallet_err_json, wallet_err_json_with_tx_hash,
};
use super::squad_sponsor_common::{parse_signer_wallet, require_parent_member};
use super::wallet_chain_config;
use alloy::sol_types::SolEvent;

/// Matches `script/Constants.sol` production-style defaults (`CREW_CHANGE_DELAY`, `PROPOSAL_EXPIRY`, etc.).
const DEFAULT_CREW_CHANGE_DELAY_SEC: u64 = 7 * 24 * 3600;
const DEFAULT_PROPOSAL_EXPIRY_SEC: u64 = 7 * 24 * 3600;
pub(crate) const WAR_GAME_DEFAULT_DELAY_SEC: u64 = 5 * 60;
const DEFAULT_QUORUM_BPS: u64 = 3000;
const MIN_GOV_DELAY_SEC: u64 = 60;
const MAX_GOV_DELAY_SEC: u64 = 60 * 24 * 3600;
const MIN_QUORUM_BPS: u64 = 500;
const MAX_QUORUM_BPS: u64 = 10_000;

/// Optional deploy-time SquadParams. Omitted fields use production defaults.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadParamsDto {
    pub crew_change_delay_secs: Option<u64>,
    pub proposal_expiry_secs: Option<u64>,
    pub crew_vote_mode: Option<String>,
    pub quorum_bps: Option<u64>,
}

fn parse_crew_vote_mode(raw: Option<&str>) -> Result<CrewVoteMode, String> {
    match raw.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(CrewVoteMode::MAJORITY_SNAPSHOT),
        Some(s)
            if s.eq_ignore_ascii_case("majority")
                || s.eq_ignore_ascii_case("MAJORITY_SNAPSHOT") =>
        {
            Ok(CrewVoteMode::MAJORITY_SNAPSHOT)
        }
        Some(s) if s.eq_ignore_ascii_case("quorum") || s.eq_ignore_ascii_case("QUORUM_OF_CAST") => {
            Ok(CrewVoteMode::QUORUM_OF_CAST)
        }
        Some(_) => Err(wallet_err_json(
            "INVALID_SQUAD_PARAMS",
            "crewVoteMode must be majority or quorum",
            None,
        )),
    }
}

fn require_gov_delay(field: &str, secs: u64) -> Result<u64, String> {
    if secs < MIN_GOV_DELAY_SEC || secs > MAX_GOV_DELAY_SEC {
        return Err(wallet_err_json(
            "INVALID_SQUAD_PARAMS",
            format!("{field} must be between 1 minute and 60 days"),
            None,
        ));
    }
    Ok(secs)
}

fn require_quorum_bps(bps: u64) -> Result<u64, String> {
    if bps < MIN_QUORUM_BPS || bps > MAX_QUORUM_BPS {
        return Err(wallet_err_json(
            "INVALID_SQUAD_PARAMS",
            "quorumBps must be between 500 and 10000",
            None,
        ));
    }
    Ok(bps)
}

fn resolve_squad_params_with_defaults(
    input: Option<&SquadParamsDto>,
    default_delay: u64,
    default_expiry: u64,
) -> Result<SquadParams, String> {
    let dto = input.cloned().unwrap_or_default();
    let delay = require_gov_delay(
        "crewChangeDelay",
        dto.crew_change_delay_secs.unwrap_or(default_delay),
    )?;
    let expiry = require_gov_delay(
        "proposalExpiry",
        dto.proposal_expiry_secs.unwrap_or(default_expiry),
    )?;
    let quorum = require_quorum_bps(dto.quorum_bps.unwrap_or(DEFAULT_QUORUM_BPS))?;
    let mode = parse_crew_vote_mode(dto.crew_vote_mode.as_deref())?;
    Ok(SquadParams {
        crewChangeDelay: U256::from(delay),
        proposalExpiry: U256::from(expiry),
        crewVoteMode: mode,
        quorumBps: U256::from(quorum),
    })
}

pub(crate) fn resolve_squad_params(input: Option<&SquadParamsDto>) -> Result<SquadParams, String> {
    resolve_squad_params_with_defaults(
        input,
        DEFAULT_CREW_CHANGE_DELAY_SEC,
        DEFAULT_PROPOSAL_EXPIRY_SEC,
    )
}

pub(crate) fn resolve_war_game_squad_params(
    input: Option<&SquadParamsDto>,
) -> Result<SquadParams, String> {
    resolve_squad_params_with_defaults(
        input,
        WAR_GAME_DEFAULT_DELAY_SEC,
        WAR_GAME_DEFAULT_DELAY_SEC,
    )
}

pub(crate) fn nave_pirata_deploy_params(
    captain: Address,
    metadata_uri: String,
    squad_params: SquadParams,
    addrs: &super::pacto_chain_config::PactoGovDeployAddresses,
    salt: U256,
    stack_kind: StackKind,
    squad_id: B256,
) -> DeployParams {
    DeployParams {
        captain,
        metadataURI: metadata_uri,
        squadParams: squad_params,
        quartermasterMasterCopy: addrs.master_quartermaster,
        mutinyMasterCopy: addrs.master_mutiny,
        treasuryAuthorityMasterCopy: addrs.master_treasury_authority,
        squadAdminImplementation: addrs.master_squad_admin_impl,
        saltNonce: salt,
        stackKind: stack_kind,
        squadId: squad_id,
    }
}

fn nave_pirata_deployed_topic0() -> B256 {
    B256::from_slice(
        keccak256("NavePirataDeployed(uint256,address,address,address,address,address,address)")
            .as_slice(),
    )
}

fn address_from_word(data: &[u8], word_index: usize) -> Result<Address, String> {
    let start = word_index
        .checked_mul(32)
        .ok_or_else(|| "word index overflow".to_string())?;
    let end = start
        .checked_add(32)
        .ok_or_else(|| "word offset overflow".to_string())?;
    if data.len() < end {
        return Err("log data too short for address words".to_string());
    }
    Ok(Address::from_slice(&data[start + 12..start + 32]))
}

fn addresses_from_nave_pirata_deployed_log(
    log: &alloy::rpc::types::Log,
    factory: Address,
) -> Result<(U256, Address, Address, Address, Address, Address, Address), String> {
    if log.address() != factory {
        return Err("log address mismatch".to_string());
    }
    let topics = log.topics();
    if topics.first() != Some(&nave_pirata_deployed_topic0()) {
        return Err("unexpected event topic".to_string());
    }
    if topics.len() < 3 {
        return Err("NavePirataDeployed: expected at least 3 topics".to_string());
    }
    let top_hat = U256::from_be_slice(topics[1].as_slice());
    let captain = Address::from_slice(&topics[2].as_slice()[12..32]);
    let data = log.data().data.as_ref();
    let safe = address_from_word(data, 0)?;
    let quartermaster = address_from_word(data, 1)?;
    let mutiny = address_from_word(data, 2)?;
    let treasury = address_from_word(data, 3)?;
    let squad_admin = address_from_word(data, 4)?;
    Ok((
        top_hat,
        captain,
        safe,
        quartermaster,
        mutiny,
        treasury,
        squad_admin,
    ))
}

fn addresses_from_nave_pirata_registered_log(
    log: &alloy::rpc::types::Log,
    registry: Address,
) -> Result<(U256, Address, Address, Address, Address, Address, Address), String> {
    if log.address() != registry {
        return Err("log address mismatch".to_string());
    }
    let decoded = NavePirataRegistered::decode_raw_log(log.topics(), log.data().data.as_ref())
        .map_err(|e| format!("NavePirataRegistered decode: {e}"))?;
    let d = decoded._deployment;
    Ok((
        decoded._topHatId,
        d.deployer,
        d.safe,
        d.quartermaster,
        d.mutinyModule,
        d.treasuryAuthority,
        d.squadAdminProxy,
    ))
}

pub(crate) fn nave_pirata_addresses_from_receipt(
    receipt: &TransactionReceipt,
    factory: Address,
    registry: Option<Address>,
) -> Result<(U256, Address, Address, Address, Address, Address, Address), String> {
    for log in receipt.logs() {
        if let Ok(all) = addresses_from_nave_pirata_deployed_log(log, factory) {
            return Ok(all);
        }
    }
    if let Some(registry) = registry {
        for log in receipt.logs() {
            if let Ok(all) = addresses_from_nave_pirata_registered_log(log, registry) {
                return Ok(all);
            }
        }
    }
    Err("no NavePirataDeployed or NavePirataRegistered log in receipt".into())
}

pub(crate) fn validate_metadata_uri(metadata_uri: &str) -> Result<String, String> {
    let meta = metadata_uri.trim();
    if meta.is_empty() {
        return Err(wallet_err_json(
            "INVALID_METADATA_URI",
            "metadata_uri must be non-empty",
            None,
        ));
    }
    Ok(meta.to_string())
}

fn ensure_captain_on_roster<'a>(
    captain: Address,
    roster_evm_addresses: impl IntoIterator<Item = &'a str>,
) -> Result<(), String> {
    let on_roster = roster_evm_addresses
        .into_iter()
        .any(|addr| parse_address(addr).map(|a| a == captain).unwrap_or(false));
    if !on_roster {
        return Err(wallet_err_json(
            "INVALID_CAPTAIN",
            "captain must be a squad-assigned roster EVM for a member of this parent",
            None,
        ));
    }
    Ok(())
}

fn bound_squad_address_for_parent<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
) -> Result<Option<Address>, String> {
    let Some(account_id) = db::get_squad_member_evm_account_id(app, parent_id, None)? else {
        return Ok(None);
    };
    let conn = crate::account_manager::get_db_connection(app)?;
    let addr: Option<String> = conn
        .query_row(
            "SELECT address FROM evm_accounts WHERE id = ?1",
            rusqlite::params![account_id.as_str()],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read evm_accounts: {}", e))?;
    crate::account_manager::return_db_connection(conn);
    Ok(addr
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .and_then(|s| parse_address(s).ok()))
}

/// Captain must appear on the shared roster (primary + optional alt parent id).
/// If it only exists as this user's local squad binding, heal `squad_member_evm` and allow.
pub(crate) fn ensure_captain_for_parent_deploy<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
    alt_parent_id: Option<&str>,
    captain: Address,
) -> Result<(), String> {
    let roster = db::list_squad_member_evm(
        app.clone(),
        parent_id.to_string(),
        alt_parent_id.map(|s| s.to_string()),
    )?;
    if ensure_captain_on_roster(captain, roster.iter().map(|row| row.evm_address.as_str())).is_ok()
    {
        return Ok(());
    }

    let mut candidates = vec![parent_id];
    if let Some(alt) = alt_parent_id
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != parent_id)
    {
        candidates.push(alt);
    }
    for pid in &candidates {
        if bound_squad_address_for_parent(app, pid)?.as_ref() == Some(&captain) {
            let hex = format!("{captain:#x}");
            for heal_pid in &candidates {
                db::upsert_squad_member_evm(app.clone(), (*heal_pid).to_string(), hex.clone())?;
            }
            return Ok(());
        }
    }

    Err(wallet_err_json(
        "INVALID_CAPTAIN",
        "captain must be a squad-assigned roster EVM for a member of this parent",
        None,
    ))
}

/// Prefer the parent id that has a local squad binding when primary and alt differ.
pub(crate) fn roster_signing_parent_id<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
    alt_parent_id: Option<&str>,
) -> Result<String, String> {
    if db::get_squad_member_evm_account_id(app, parent_id, None)?.is_some() {
        return Ok(parent_id.to_string());
    }
    if let Some(alt) = alt_parent_id
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != parent_id)
    {
        if db::get_squad_member_evm_account_id(app, alt, None)?.is_some() {
            return Ok(alt.to_string());
        }
    }
    Ok(parent_id.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavePirataDeployResult {
    pub tx_hash: String,
    pub chain: String,
    pub chain_id: u64,
    pub top_hat_id: String,
    pub safe_address: String,
    pub quartermaster: String,
    pub mutiny_module: String,
    pub treasury_authority: String,
    pub squad_admin_proxy: String,
    /// JSON string for `squad_infra.provider_payload` / announces (`v`, addresses, parent id).
    pub provider_payload: String,
    pub infra_row_id: String,
}

#[tauri::command]
pub async fn deploy_nave_pirata_for_parent<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    captain: String,
    metadata_uri: String,
    salt_nonce: Option<String>,
    signer_wallet: Option<String>,
    alt_parent_id: Option<String>,
    squad_params: Option<SquadParamsDto>,
    rpc_urls: Option<Vec<String>>,
) -> Result<NavePirataDeployResult, String> {
    crate::migration::require_key_derivation_version_2_on_handle(&app)?;
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Err(wallet_err_json(
            "INVALID_PARENT",
            "parent_id must be non-empty",
            None,
        ));
    }
    require_parent_member(&app, pid).await?;

    if db::parent_has_pacto_gov_infra_row(&app, pid).unwrap_or(false) {
        return Err(wallet_err_json(
            "ALREADY_DEPLOYED",
            "Pacto Gov is already deployed for this squad",
            None,
        ));
    }

    let net_key = network.to_lowercase();
    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {}", network),
            None,
        ));
    };

    let addrs = pacto_chain_config::pacto_gov_deploy_addresses(&net.key)
        .map_err(|e| wallet_err_json("NAVE_PIRATA_CONFIG", e, None))?;

    pacto_chain_config::guard_local_chain_live(&net.key)
        .await
        .map_err(|e| wallet_err_json("NAVE_PIRATA_CONFIG", e, None))?;

    let captain_addr =
        parse_address(captain.trim()).map_err(|e| wallet_err_json("INVALID_CAPTAIN", e, None))?;
    let alt = alt_parent_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != pid);
    ensure_captain_for_parent_deploy(&app, pid, alt, captain_addr)?;

    let meta = validate_metadata_uri(&metadata_uri)?;

    let salt =
        parse_salt_nonce(salt_nonce).map_err(|e| wallet_err_json("INVALID_SALT_NONCE", e, None))?;

    let squad_params = resolve_squad_params(squad_params.as_ref())?;

    let params = nave_pirata_deploy_params(
        captain_addr,
        meta.clone(),
        squad_params,
        &addrs,
        salt,
        StackKind::Production,
        B256::ZERO,
    );

    let calldata = deployNavePirataCall { _params: params }.abi_encode();
    let factory = addrs.nave_pirata_factory;

    let urls = rpc_urls_or_default(net, rpc_urls.clone());
    if urls.is_empty() {
        return Err(wallet_err_json("RPC_CONFIG", "no RPC URL configured", None));
    }

    let signing_parent = roster_signing_parent_id(&app, pid, alt)?;
    let signer_mode = parse_signer_wallet(signer_wallet.as_deref(), "squad")?;
    let (_signer, wallet) = if signer_mode == "default" {
        require_treasury_signing_allowed(app.clone()).await?;
        load_active_squad_embedded_signer(app.clone()).await?
    } else {
        require_roster_treasury_signing_allowed(app.clone(), signing_parent.as_str()).await?;
        load_squad_roster_embedded_signer(app.clone(), signing_parent.as_str()).await?
    };
    let provider = connect_signing_provider(&urls, wallet).await?;

    let rpc_chain_id = provider.get_chain_id().await.map_err(|e| {
        wallet_err_json(
            "RPC_CHAIN_ID",
            crate::evm::wallet_security::redact_urls_in_text(&e.to_string()),
            None,
        )
    })?;
    if rpc_chain_id != net.chain_id {
        return Err(wallet_err_json(
            "CHAIN_MISMATCH",
            format!(
                "RPC chain id {} does not match expected {} for {}",
                rpc_chain_id, net.chain_id, net.key
            ),
            None,
        ));
    }

    let tx = contract_call_request(factory, calldata);
    let receipt = send_and_confirm(&provider, tx, "Timed out waiting for confirmation.").await?;

    let (top_hat, _captain_out, safe_a, qm_a, mm_a, ta_a, admin_a) =
        nave_pirata_addresses_from_receipt(&receipt, factory, addrs.nave_pirata_registry).map_err(
            |e| {
                wallet_err_json_with_tx_hash(
                    "PARSE_RECEIPT",
                    e,
                    None,
                    format!("0x{:x}", receipt.transaction_hash),
                )
            },
        )?;

    let tx_hash = format!("0x{:x}", receipt.transaction_hash);
    let top_hat_str = top_hat.to_string();
    let safe_hex = format!("{:#x}", safe_a);
    let payload = json!({
        "v": 1,
        "parentId": pid,
        "txHash": tx_hash,
        "safe": safe_hex,
        "quartermaster": format!("{:#x}", qm_a),
        "mutinyModule": format!("{:#x}", mm_a),
        "treasuryAuthority": format!("{:#x}", ta_a),
        "squadAdminProxy": format!("{:#x}", admin_a),
    })
    .to_string();

    let infra_row_id = db::pacto_gov_infra_row_id(pid);
    db::persist_pacto_gov_infra(
        &app,
        pid,
        net.key.as_str(),
        top_hat_str.as_str(),
        payload.as_str(),
    )
    .map_err(|e| wallet_err_json("PERSIST_PACTO_GOV", e, None))?;

    let _ = db::persist_pacto_gov_treasury_safe(&app, pid, net.key.as_str(), safe_hex.as_str());

    Ok(NavePirataDeployResult {
        tx_hash,
        chain: net.key.clone(),
        chain_id: net.chain_id,
        top_hat_id: top_hat_str,
        safe_address: safe_hex,
        quartermaster: format!("{:#x}", qm_a),
        mutiny_module: format!("{:#x}", mm_a),
        treasury_authority: format!("{:#x}", ta_a),
        squad_admin_proxy: format!("{:#x}", admin_a),
        provider_payload: payload,
        infra_row_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::{Address, B256};
    use alloy::sol_types::SolCall;

    fn wallet_err_code(err: String) -> String {
        serde_json::from_str::<serde_json::Value>(&err)
            .expect("wallet error must be JSON")
            .get("code")
            .and_then(|c| c.as_str())
            .expect("wallet error must carry a code")
            .to_string()
    }

    #[test]
    fn validate_metadata_uri_rejects_empty_and_whitespace() {
        for input in ["", "   ", "\n\t "] {
            let err = validate_metadata_uri(input).expect_err("blank metadata must fail");
            assert_eq!(wallet_err_code(err), "INVALID_METADATA_URI");
        }
    }

    #[test]
    fn validate_metadata_uri_trims_and_keeps_value() {
        assert_eq!(
            validate_metadata_uri("  ipfs://bafy/metadata.json  ").unwrap(),
            "ipfs://bafy/metadata.json"
        );
    }

    #[test]
    fn captain_on_roster_accepts_matching_member_address() {
        let captain = parse_address("0x1111111111111111111111111111111111111111").unwrap();
        let roster = [
            "0x2222222222222222222222222222222222222222",
            "0x1111111111111111111111111111111111111111",
        ];
        assert!(ensure_captain_on_roster(captain, roster).is_ok());
    }

    #[test]
    fn captain_on_roster_matches_regardless_of_hex_case() {
        let captain = parse_address("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").unwrap();
        assert!(
            ensure_captain_on_roster(captain, ["0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"])
                .is_ok()
        );
    }

    #[test]
    fn captain_on_roster_rejects_absent_and_unparseable_addresses() {
        let captain = parse_address("0x1111111111111111111111111111111111111111").unwrap();
        let off_roster = [
            "0x2222222222222222222222222222222222222222",
            "not-an-address",
        ];
        let err = ensure_captain_on_roster(captain, off_roster)
            .expect_err("off-roster captain must fail");
        assert_eq!(wallet_err_code(err), "INVALID_CAPTAIN");

        let err = ensure_captain_on_roster(captain, std::iter::empty())
            .expect_err("empty roster must fail");
        assert_eq!(wallet_err_code(err), "INVALID_CAPTAIN");
    }

    #[test]
    fn signer_wallet_parsing_accepts_deploy_modes_and_defaults_to_squad() {
        assert_eq!(parse_signer_wallet(None, "squad").unwrap(), "squad");
        assert_eq!(parse_signer_wallet(Some("  "), "squad").unwrap(), "squad");
        assert_eq!(
            parse_signer_wallet(Some("default"), "squad").unwrap(),
            "default"
        );
        assert_eq!(
            parse_signer_wallet(Some("SQUAD"), "squad").unwrap(),
            "squad"
        );
    }

    #[test]
    fn signer_wallet_parsing_rejects_unknown_modes() {
        for bad in ["hardware", "defaultt", "0xabc"] {
            assert!(parse_signer_wallet(Some(bad), "squad").is_err());
        }
    }

    #[test]
    fn resolve_squad_params_defaults_when_omitted() {
        let p = resolve_squad_params(None).expect("defaults");
        assert_eq!(p.crewChangeDelay, U256::from(DEFAULT_CREW_CHANGE_DELAY_SEC));
        assert_eq!(p.proposalExpiry, U256::from(DEFAULT_PROPOSAL_EXPIRY_SEC));
        assert_eq!(p.quorumBps, U256::from(DEFAULT_QUORUM_BPS));
        assert!(matches!(p.crewVoteMode, CrewVoteMode::MAJORITY_SNAPSHOT));
    }

    #[test]
    fn resolve_squad_params_accepts_custom_within_bounds() {
        let dto = SquadParamsDto {
            crew_change_delay_secs: Some(300),
            proposal_expiry_secs: Some(300),
            crew_vote_mode: Some("quorum".into()),
            quorum_bps: Some(2500),
        };
        let p = resolve_squad_params(Some(&dto)).expect("custom");
        assert_eq!(p.crewChangeDelay, U256::from(300u64));
        assert_eq!(p.proposalExpiry, U256::from(300u64));
        assert_eq!(p.quorumBps, U256::from(2500u64));
        assert!(matches!(p.crewVoteMode, CrewVoteMode::QUORUM_OF_CAST));
    }

    #[test]
    fn resolve_war_game_squad_params_defaults_to_five_minutes() {
        let p = resolve_war_game_squad_params(None).expect("defaults");
        assert_eq!(p.crewChangeDelay, U256::from(WAR_GAME_DEFAULT_DELAY_SEC));
        assert_eq!(p.proposalExpiry, U256::from(WAR_GAME_DEFAULT_DELAY_SEC));
        assert_eq!(p.quorumBps, U256::from(DEFAULT_QUORUM_BPS));
        assert!(matches!(p.crewVoteMode, CrewVoteMode::MAJORITY_SNAPSHOT));
    }

    #[test]
    fn production_deploy_params_use_production_kind_and_zero_squad_id() {
        let p = nave_pirata_deploy_params(
            Address::repeat_byte(0x11),
            "pacto://squad/test".into(),
            resolve_squad_params(None).unwrap(),
            &super::super::pacto_chain_config::PactoGovDeployAddresses {
                nave_pirata_factory: Address::repeat_byte(0x01),
                master_quartermaster: Address::repeat_byte(0x02),
                master_mutiny: Address::repeat_byte(0x03),
                master_treasury_authority: Address::repeat_byte(0x04),
                master_squad_admin_impl: Address::repeat_byte(0x05),
                master_squad_admin_ext_impl: Address::repeat_byte(0x06),
                nave_pirata_registry: None,
                war_game_registry: None,
                hats: None,
            },
            U256::from(7u64),
            StackKind::Production,
            B256::ZERO,
        );
        assert!(matches!(p.stackKind, StackKind::Production));
        assert_eq!(p.squadId, B256::ZERO);
        let encoded = deployNavePirataCall { _params: p }.abi_encode();
        let decoded = deployNavePirataCall::abi_decode(&encoded).expect("decode");
        assert!(matches!(decoded._params.stackKind, StackKind::Production));
        assert_eq!(decoded._params.squadId, B256::ZERO);
    }

    #[test]
    fn resolve_squad_params_rejects_out_of_range() {
        let too_short = SquadParamsDto {
            crew_change_delay_secs: Some(59),
            ..Default::default()
        };
        match resolve_squad_params(Some(&too_short)) {
            Err(err) => assert_eq!(wallet_err_code(err), "INVALID_SQUAD_PARAMS"),
            Ok(_) => panic!("too short"),
        }

        let too_wide = SquadParamsDto {
            quorum_bps: Some(10_001),
            ..Default::default()
        };
        match resolve_squad_params(Some(&too_wide)) {
            Err(err) => assert_eq!(wallet_err_code(err), "INVALID_SQUAD_PARAMS"),
            Ok(_) => panic!("quorum"),
        }
    }
}
