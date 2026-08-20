//! Sepolia war-game stack: parent Ext if missing, round Ext, Nave Pirata `WarGame`, persist `pacto_gov_wargame`.

use alloy::network::TransactionBuilder;
use alloy::primitives::{Address, B256, U256};
use alloy::providers::Provider;
use alloy::rpc::types::TransactionReceipt;
use alloy::sol_types::{SolCall, SolEvent};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Runtime};

use crate::db;

use super::contracts::pacto_gov::read_bindings::IWarGameRegistry::WarGameRegistered;
use super::contracts::pacto_gov::INavePirataFactory::{deployNavePirataCall, StackKind};
use super::contracts::pacto_sponsor::ISquadSponsorExt::{
    hatsWiredCall, permittedAddressCall, postInitializeCall, setPermittedAddressCall,
};
use super::contracts::pacto_sponsor::ISquadSponsorFactory::{
    createSquadSponsorExtCall, createWarGameSponsorExtCall, warGameRoundCountCall,
    warGameSquadIdCall,
};
use super::gov_read::rpc_urls_or_default;
use super::nave_pirata_deploy::{
    ensure_captain_for_parent_deploy, nave_pirata_addresses_from_receipt,
    nave_pirata_deploy_params, resolve_war_game_squad_params, roster_signing_parent_id,
    validate_metadata_uri, SquadParamsDto,
};
use super::pacto_chain_config;
use super::rpc::call::eth_call_decode;
use super::rpc::signer::{
    load_active_squad_embedded_signer, load_squad_roster_embedded_signer,
    require_roster_treasury_signing_allowed, require_treasury_signing_allowed,
};
use super::rpc::{
    connect_read_provider, connect_signing_provider, contract_call_request, parse_address,
    parse_salt_nonce, send_and_confirm, wallet_err_json, wallet_err_json_with_tx_hash,
};
use super::squad_sponsor_common::{
    parse_deposit_wei, parse_signer_wallet, read_squad_record_opt, require_parent_member,
    squad_id_from_parent_id, squad_variant_label,
};
use super::wallet_chain_config;
use super::wallet_chain_config::WalletNetworkConfig;

const SEPOLIA_KEY: &str = "sepolia";
const MAX_PERMIT_MEMBERS: usize = 64;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarGameDeployResult {
    pub tx_hash: String,
    pub chain: String,
    pub chain_id: u64,
    pub top_hat_id: String,
    pub safe_address: String,
    pub quartermaster: String,
    pub mutiny_module: String,
    pub treasury_authority: String,
    pub squad_admin_proxy: String,
    pub round: String,
    pub game_squad_id: String,
    pub sponsor_address: String,
    pub retired_sponsor: Option<String>,
    pub provider_payload: String,
    pub infra_row_id: String,
}

fn require_sepolia_network(network: &str) -> Result<&'static WalletNetworkConfig, String> {
    let key = network.trim().to_ascii_lowercase();
    if key != SEPOLIA_KEY {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            "war-game deploy is Sepolia only",
            None,
        ));
    }
    wallet_chain_config::network_by_key(SEPOLIA_KEY)
        .ok_or_else(|| wallet_err_json("UNSUPPORTED_NETWORK", "Unknown network: sepolia", None))
}

fn parse_optional_deposit_wei(raw: Option<&str>) -> Result<U256, String> {
    match raw.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(U256::ZERO),
        Some(s) => {
            parse_deposit_wei(Some(s)).map_err(|e| wallet_err_json("INVALID_DEPOSIT", e, None))
        }
    }
}

fn retired_sponsor_from_prior_payload(payload: Option<&str>, new_sponsor: &str) -> Option<String> {
    let raw = payload.map(str::trim).filter(|s| !s.is_empty())?;
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    let prev = v.get("sponsor")?.as_str()?.trim();
    if prev.is_empty() {
        return None;
    }
    if prev.eq_ignore_ascii_case(new_sponsor) {
        return None;
    }
    Some(prev.to_string())
}

fn war_game_provider_payload(
    parent_id: &str,
    tx_hash: &str,
    safe: &str,
    quartermaster: &str,
    mutiny: &str,
    treasury: &str,
    squad_admin: &str,
    round: &U256,
    game_squad_id: B256,
    sponsor: &str,
    retired_sponsor: Option<&str>,
) -> String {
    let mut map = serde_json::Map::new();
    map.insert("v".to_string(), json!(1));
    map.insert("parentId".to_string(), json!(parent_id));
    map.insert("status".to_string(), json!("active"));
    map.insert("txHash".to_string(), json!(tx_hash));
    map.insert("safe".to_string(), json!(safe));
    map.insert("quartermaster".to_string(), json!(quartermaster));
    map.insert("mutinyModule".to_string(), json!(mutiny));
    map.insert("treasuryAuthority".to_string(), json!(treasury));
    map.insert("squadAdminProxy".to_string(), json!(squad_admin));
    map.insert("round".to_string(), json!(round.to_string()));
    map.insert(
        "gameSquadId".to_string(),
        json!(format!("{:#x}", game_squad_id)),
    );
    map.insert("sponsor".to_string(), json!(sponsor));
    if let Some(retired) = retired_sponsor.map(str::trim).filter(|s| !s.is_empty()) {
        map.insert("retiredSponsor".to_string(), json!(retired));
    } else {
        map.insert("retiredSponsor".to_string(), json!(null));
    }
    serde_json::Value::Object(map).to_string()
}

fn addresses_from_war_game_registered_log(
    log: &alloy::rpc::types::Log,
    registry: Address,
) -> Result<(U256, Address, Address, Address, Address, Address, Address), String> {
    if log.address() != registry {
        return Err("log address mismatch".to_string());
    }
    let decoded = WarGameRegistered::decode_raw_log(log.topics(), log.data().data.as_ref())
        .map_err(|e| format!("WarGameRegistered decode: {e}"))?;
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

fn war_game_addresses_from_receipt(
    receipt: &TransactionReceipt,
    factory: Address,
    war_game_registry: Address,
) -> Result<(U256, Address, Address, Address, Address, Address, Address), String> {
    if let Ok(all) = nave_pirata_addresses_from_receipt(receipt, factory, None) {
        return Ok(all);
    }
    for log in receipt.logs() {
        if let Ok(all) = addresses_from_war_game_registered_log(log, war_game_registry) {
            return Ok(all);
        }
    }
    Err("no NavePirataDeployed or WarGameRegistered log in receipt".into())
}

fn roster_permit_addresses<'a>(
    roster: impl Iterator<Item = &'a str>,
    extra: Address,
) -> Vec<Address> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    let push =
        |addr: Address, seen: &mut std::collections::HashSet<Address>, out: &mut Vec<Address>| {
            if addr.is_zero() || !seen.insert(addr) {
                return;
            }
            if out.len() < MAX_PERMIT_MEMBERS {
                out.push(addr);
            }
        };
    push(extra, &mut seen, &mut out);
    for raw in roster {
        if let Ok(addr) = parse_address(raw) {
            push(addr, &mut seen, &mut out);
        }
    }
    out
}

async fn send_value_call<P: Provider>(
    provider: &P,
    to: Address,
    calldata: Vec<u8>,
    value: U256,
    timeout_msg: &str,
) -> Result<TransactionReceipt, String> {
    let tx = contract_call_request(to, calldata).with_value(value);
    send_and_confirm(provider, tx, timeout_msg).await
}

async fn permit_members_on_ext<R: Runtime>(
    app: &AppHandle<R>,
    urls: &[String],
    signing_parent: &str,
    sponsor: Address,
    members: &[Address],
) -> Result<(), String> {
    let hats_wired: bool = {
        let read = connect_read_provider(urls).await?;
        eth_call_decode(&read, sponsor, &hatsWiredCall {})
            .await
            .map_err(|e| wallet_err_json("SPONSOR_READ", e, None))?
    };
    if hats_wired {
        return Ok(());
    }

    require_roster_treasury_signing_allowed(app.clone(), signing_parent).await?;
    let (_signer, wallet) = load_squad_roster_embedded_signer(app.clone(), signing_parent).await?;
    let provider = connect_signing_provider(urls, wallet).await?;

    for member in members {
        let already: bool = {
            let read = connect_read_provider(urls).await?;
            eth_call_decode(&read, sponsor, &permittedAddressCall { member: *member })
                .await
                .unwrap_or(false)
        };
        if already {
            continue;
        }
        let calldata = setPermittedAddressCall {
            member: *member,
            permitted: true,
        }
        .abi_encode();
        let tx = contract_call_request(sponsor, calldata);
        let _receipt = send_and_confirm(
            &provider,
            tx,
            "Timed out waiting for setPermittedAddress confirmation.",
        )
        .await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn deploy_war_game_for_parent<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    captain: String,
    metadata_uri: String,
    salt_nonce: Option<String>,
    signer_wallet: Option<String>,
    alt_parent_id: Option<String>,
    squad_params: Option<SquadParamsDto>,
    initial_deposit_wei: Option<String>,
    rpc_urls: Option<Vec<String>>,
) -> Result<WarGameDeployResult, String> {
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

    let net = require_sepolia_network(&network)?;
    let deposit = parse_optional_deposit_wei(initial_deposit_wei.as_deref())?;

    let gov_addrs = pacto_chain_config::pacto_gov_deploy_addresses(&net.key)
        .map_err(|e| wallet_err_json("NAVE_PIRATA_CONFIG", e, None))?;
    let Some(war_game_registry) = gov_addrs.war_game_registry else {
        return Err(wallet_err_json(
            "NAVE_PIRATA_CONFIG",
            "war-game registry is not configured for Sepolia",
            None,
        ));
    };
    let sponsor_addrs = pacto_chain_config::squad_sponsor_deploy_addresses(&net.key)
        .map_err(|e| wallet_err_json("SPONSOR_CONFIG", e, None))?;

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

    let meta = if metadata_uri.trim().is_empty() {
        format!("pacto://squad/{pid}/wargame")
    } else {
        validate_metadata_uri(&metadata_uri)?
    };
    let salt =
        parse_salt_nonce(salt_nonce).map_err(|e| wallet_err_json("INVALID_SALT_NONCE", e, None))?;
    let squad_params = resolve_war_game_squad_params(squad_params.as_ref())?;
    let parent_squad_id = squad_id_from_parent_id(pid);

    let urls = rpc_urls_or_default(net, rpc_urls.clone());
    if urls.is_empty() {
        return Err(wallet_err_json("RPC_CONFIG", "no RPC URL configured", None));
    }

    let signing_parent = roster_signing_parent_id(&app, pid, alt)?;
    let signer_mode = parse_signer_wallet(signer_wallet.as_deref(), "default")?;
    let (_pay_signer, pay_wallet) = if signer_mode == "default" {
        require_treasury_signing_allowed(app.clone()).await?;
        load_active_squad_embedded_signer(app.clone()).await?
    } else {
        require_roster_treasury_signing_allowed(app.clone(), signing_parent.as_str()).await?;
        load_squad_roster_embedded_signer(app.clone(), signing_parent.as_str()).await?
    };
    let pay_provider = connect_signing_provider(&urls, pay_wallet).await?;
    let rpc_chain_id = pay_provider.get_chain_id().await.map_err(|e| {
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

    let (roster_signer, _) =
        load_squad_roster_embedded_signer(app.clone(), signing_parent.as_str()).await?;
    let address_owner = roster_signer.address();
    let factory_sponsor = sponsor_addrs.squad_sponsor_factory;
    let factory_gov = gov_addrs.nave_pirata_factory;

    let read_provider = connect_read_provider(&urls).await?;
    let parent_record = read_squad_record_opt(&read_provider, factory_sponsor, parent_squad_id)
        .await
        .map_err(|e| wallet_err_json("SPONSOR_LOOKUP", e, None))?;

    if parent_record.is_none() {
        let calldata = createSquadSponsorExtCall {
            squadId: parent_squad_id,
            addressOwner: address_owner,
        }
        .abi_encode();
        let receipt = send_value_call(
            &pay_provider,
            factory_sponsor,
            calldata,
            deposit,
            "Timed out waiting for parent sponsor confirmation.",
        )
        .await?;
        let created = read_squad_record_opt(&read_provider, factory_sponsor, parent_squad_id)
            .await
            .map_err(|e| {
                wallet_err_json_with_tx_hash(
                    "SPONSOR_READ",
                    e,
                    None,
                    format!("0x{:x}", receipt.transaction_hash),
                )
            })?
            .ok_or_else(|| {
                wallet_err_json_with_tx_hash(
                    "SPONSOR_READ",
                    "parent Ext was not registered after createSquadSponsorExt",
                    None,
                    format!("0x{:x}", receipt.transaction_hash),
                )
            })?;
        let (parent_sponsor, variant, _) = created;
        let payload = json!({
            "v": 1,
            "parentId": pid,
            "squadId": format!("{:#x}", parent_squad_id),
            "sponsor": format!("{:#x}", parent_sponsor),
            "paymaster": format!("{:#x}", sponsor_addrs.pacto_sponsor_paymaster),
            "entryPoint": format!("{:#x}", sponsor_addrs.entry_point),
            "variant": squad_variant_label(variant),
            "addressOwner": format!("{:#x}", address_owner),
            "txHash": format!("0x{:x}", receipt.transaction_hash),
        })
        .to_string();
        db::persist_sponsor_infra(
            &app,
            pid,
            net.key.as_str(),
            format!("{:#x}", parent_sponsor).as_str(),
            payload.as_str(),
        )
        .map_err(|e| wallet_err_json("PERSIST_SPONSOR", e, None))?;
        let parent_members = {
            let roster = db::list_squad_member_evm(
                app.clone(),
                pid.to_string(),
                alt.map(|s| s.to_string()),
            )?;
            roster_permit_addresses(
                roster.iter().map(|row| row.evm_address.as_str()),
                address_owner,
            )
        };
        permit_members_on_ext(
            &app,
            &urls,
            signing_parent.as_str(),
            parent_sponsor,
            &parent_members,
        )
        .await?;
    }

    let round_deposit = if parent_record.is_none() {
        U256::ZERO
    } else {
        deposit
    };
    let round_calldata = createWarGameSponsorExtCall {
        parentSquadId: parent_squad_id,
        addressOwner: address_owner,
    }
    .abi_encode();
    let round_receipt = send_value_call(
        &pay_provider,
        factory_sponsor,
        round_calldata,
        round_deposit,
        "Timed out waiting for war-game sponsor confirmation.",
    )
    .await?;
    let round_tx = format!("0x{:x}", round_receipt.transaction_hash);

    let round: U256 = eth_call_decode(
        &read_provider,
        factory_sponsor,
        &warGameRoundCountCall {
            parentSquadId: parent_squad_id,
        },
    )
    .await
    .map_err(|e| wallet_err_json_with_tx_hash("SPONSOR_READ", e, None, round_tx.clone()))?;
    if round.is_zero() {
        return Err(wallet_err_json_with_tx_hash(
            "SPONSOR_READ",
            "war-game round count is still zero after createWarGameSponsorExt",
            None,
            round_tx,
        ));
    }
    let game_squad_id: B256 = eth_call_decode(
        &read_provider,
        factory_sponsor,
        &warGameSquadIdCall {
            parentSquadId: parent_squad_id,
            round,
        },
    )
    .await
    .map_err(|e| wallet_err_json_with_tx_hash("SPONSOR_READ", e, None, round_tx.clone()))?;
    let round_record = read_squad_record_opt(&read_provider, factory_sponsor, game_squad_id)
        .await
        .map_err(|e| wallet_err_json_with_tx_hash("SPONSOR_READ", e, None, round_tx.clone()))?
        .ok_or_else(|| {
            wallet_err_json_with_tx_hash(
                "SPONSOR_READ",
                "round Ext was not registered after createWarGameSponsorExt",
                None,
                round_tx.clone(),
            )
        })?;
    let round_sponsor = round_record.0;
    let round_sponsor_hex = format!("{:#x}", round_sponsor);

    let prior_payload = db::pacto_gov_wargame_payload_for_parent(&app, pid)
        .ok()
        .flatten();
    let retired_sponsor =
        retired_sponsor_from_prior_payload(prior_payload.as_deref(), round_sponsor_hex.as_str());

    let roster =
        db::list_squad_member_evm(app.clone(), pid.to_string(), alt.map(|s| s.to_string()))?;
    let round_members = roster_permit_addresses(
        roster.iter().map(|row| row.evm_address.as_str()),
        address_owner,
    );
    permit_members_on_ext(
        &app,
        &urls,
        signing_parent.as_str(),
        round_sponsor,
        &round_members,
    )
    .await?;

    let params = nave_pirata_deploy_params(
        captain_addr,
        meta,
        squad_params,
        &gov_addrs,
        salt,
        StackKind::WarGame,
        parent_squad_id,
    );
    let deploy_calldata = deployNavePirataCall { _params: params }.abi_encode();
    let deploy_receipt = send_and_confirm(
        &pay_provider,
        contract_call_request(factory_gov, deploy_calldata),
        "Timed out waiting for war-game stack confirmation.",
    )
    .await?;
    let deploy_tx = format!("0x{:x}", deploy_receipt.transaction_hash);
    let (top_hat, _captain_out, safe_a, qm_a, mm_a, ta_a, admin_a) =
        war_game_addresses_from_receipt(&deploy_receipt, factory_gov, war_game_registry).map_err(
            |e| wallet_err_json_with_tx_hash("PARSE_RECEIPT", e, None, deploy_tx.clone()),
        )?;

    require_roster_treasury_signing_allowed(app.clone(), signing_parent.as_str()).await?;
    let (_post_signer, post_wallet) =
        load_squad_roster_embedded_signer(app.clone(), signing_parent.as_str()).await?;
    let post_provider = connect_signing_provider(&urls, post_wallet).await?;
    let post_calldata = postInitializeCall {
        topHatId: top_hat,
        registry: war_game_registry,
        customEligibleHats: vec![],
    }
    .abi_encode();
    let post_receipt = send_and_confirm(
        &post_provider,
        contract_call_request(round_sponsor, post_calldata),
        "Timed out waiting for war-game sponsor postInitialize confirmation.",
    )
    .await?;
    let tx_hash = format!("0x{:x}", post_receipt.transaction_hash);

    let top_hat_str = top_hat.to_string();
    let safe_hex = format!("{:#x}", safe_a);
    let qm_hex = format!("{:#x}", qm_a);
    let mm_hex = format!("{:#x}", mm_a);
    let ta_hex = format!("{:#x}", ta_a);
    let admin_hex = format!("{:#x}", admin_a);
    let payload = war_game_provider_payload(
        pid,
        tx_hash.as_str(),
        safe_hex.as_str(),
        qm_hex.as_str(),
        mm_hex.as_str(),
        ta_hex.as_str(),
        admin_hex.as_str(),
        &round,
        game_squad_id,
        round_sponsor_hex.as_str(),
        retired_sponsor.as_deref(),
    );

    let infra_row_id = db::pacto_gov_wargame_infra_row_id(pid);
    db::persist_pacto_gov_wargame_infra(
        &app,
        pid,
        net.key.as_str(),
        top_hat_str.as_str(),
        payload.as_str(),
    )
    .map_err(|e| wallet_err_json("PERSIST_PACTO_GOV_WARGAME", e, None))?;

    Ok(WarGameDeployResult {
        tx_hash,
        chain: net.key.clone(),
        chain_id: net.chain_id,
        top_hat_id: top_hat_str,
        safe_address: safe_hex,
        quartermaster: qm_hex,
        mutiny_module: mm_hex,
        treasury_authority: ta_hex,
        squad_admin_proxy: admin_hex,
        round: round.to_string(),
        game_squad_id: format!("{:#x}", game_squad_id),
        sponsor_address: round_sponsor_hex,
        retired_sponsor,
        provider_payload: payload,
        infra_row_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::{keccak256, Address};

    fn wallet_err_code(err: &str) -> String {
        serde_json::from_str::<serde_json::Value>(err)
            .ok()
            .and_then(|v| v.get("code").and_then(|c| c.as_str()).map(String::from))
            .unwrap_or_default()
    }

    fn selector(signature: &str) -> [u8; 4] {
        let hash = keccak256(signature.as_bytes());
        [hash[0], hash[1], hash[2], hash[3]]
    }

    #[test]
    fn require_sepolia_rejects_other_networks() {
        for bad in ["mainnet", "arbitrum", "local", ""] {
            let err = require_sepolia_network(bad).unwrap_err();
            assert_eq!(wallet_err_code(&err), "UNSUPPORTED_NETWORK");
        }
        assert_eq!(require_sepolia_network("Sepolia").unwrap().key, "sepolia");
    }

    #[test]
    fn optional_deposit_allows_zero_and_parses_decimal() {
        assert_eq!(parse_optional_deposit_wei(None).unwrap(), U256::ZERO);
        assert_eq!(parse_optional_deposit_wei(Some("")).unwrap(), U256::ZERO);
        assert_eq!(
            parse_optional_deposit_wei(Some("1000")).unwrap(),
            U256::from(1000u64)
        );
    }

    #[test]
    fn retired_sponsor_skips_same_address_and_blank() {
        assert!(retired_sponsor_from_prior_payload(None, "0x11").is_none());
        assert!(retired_sponsor_from_prior_payload(Some("{}"), "0x11").is_none());
        assert_eq!(
            retired_sponsor_from_prior_payload(
                Some(r#"{"sponsor":"0x1111111111111111111111111111111111111111"}"#),
                "0x2222222222222222222222222222222222222222",
            ),
            Some("0x1111111111111111111111111111111111111111".into())
        );
        assert!(retired_sponsor_from_prior_payload(
            Some(r#"{"sponsor":"0x1111111111111111111111111111111111111111"}"#),
            "0x1111111111111111111111111111111111111111",
        )
        .is_none());
    }

    #[test]
    fn payload_marks_active_and_keeps_round_fields() {
        let payload = war_game_provider_payload(
            "parent-1",
            "0xabc",
            "0xsafe",
            "0xqm",
            "0xmm",
            "0xta",
            "0xadmin",
            &U256::from(2u64),
            B256::repeat_byte(0xab),
            "0xsponsor",
            Some("0xold"),
        );
        let v: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(v["v"], 1);
        assert_eq!(v["status"], "active");
        assert_eq!(v["parentId"], "parent-1");
        assert_eq!(v["round"], "2");
        assert_eq!(v["sponsor"], "0xsponsor");
        assert_eq!(v["retiredSponsor"], "0xold");
        assert!(v["gameSquadId"].as_str().unwrap().starts_with("0x"));
    }

    #[test]
    fn encode_create_war_game_sponsor_ext_matches_selector() {
        let parent = squad_id_from_parent_id("squad-alpha");
        let owner = Address::repeat_byte(0x11);
        let encoded = createWarGameSponsorExtCall {
            parentSquadId: parent,
            addressOwner: owner,
        }
        .abi_encode();
        let mut expected = selector("createWarGameSponsorExt(bytes32,address)").to_vec();
        expected.extend_from_slice(parent.as_slice());
        expected.extend_from_slice(&[0u8; 12]);
        expected.extend_from_slice(owner.as_slice());
        assert_eq!(encoded, expected);
    }

    #[test]
    fn encode_post_initialize_uses_empty_custom_hats() {
        let encoded = postInitializeCall {
            topHatId: U256::from(9u64),
            registry: Address::repeat_byte(0x22),
            customEligibleHats: vec![],
        }
        .abi_encode();
        assert_eq!(
            &encoded[..4],
            &selector("postInitialize(uint256,address,uint256[])")
        );
        let decoded = postInitializeCall::abi_decode(&encoded).expect("decode");
        assert_eq!(decoded.topHatId, U256::from(9u64));
        assert!(decoded.customEligibleHats.is_empty());
    }

    #[test]
    fn war_game_deploy_params_use_wargame_kind_and_parent_squad_id() {
        let squad_id = squad_id_from_parent_id("parent-1");
        let addrs = pacto_chain_config::PactoGovDeployAddresses {
            nave_pirata_factory: Address::repeat_byte(0x01),
            master_quartermaster: Address::repeat_byte(0x02),
            master_mutiny: Address::repeat_byte(0x03),
            master_treasury_authority: Address::repeat_byte(0x04),
            master_squad_admin_impl: Address::repeat_byte(0x05),
            master_squad_admin_ext_impl: Address::repeat_byte(0x06),
            nave_pirata_registry: None,
            war_game_registry: None,
            hats: None,
        };
        let p = nave_pirata_deploy_params(
            Address::repeat_byte(0x11),
            "pacto://squad/parent-1/wargame".into(),
            resolve_war_game_squad_params(None).unwrap(),
            &addrs,
            U256::from(1u64),
            StackKind::WarGame,
            squad_id,
        );
        assert!(matches!(p.stackKind, StackKind::WarGame));
        assert_eq!(p.squadId, squad_id);
        assert_ne!(p.squadId, B256::ZERO);
        let encoded = deployNavePirataCall { _params: p }.abi_encode();
        let decoded = deployNavePirataCall::abi_decode(&encoded).expect("decode");
        assert!(matches!(decoded._params.stackKind, StackKind::WarGame));
        assert_eq!(decoded._params.squadId, squad_id);
    }
}
