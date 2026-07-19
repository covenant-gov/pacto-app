//! Deploy a per-squad sponsor clone via `ISquadSponsorFactory` (`createSquadSponsorExt` / `createSquadSponsor`).
//!
//! `squadId` on-chain is `keccak256(parent_id UTF-8 bytes)` where `parent_id` is the squad/network root id.
//! Deployment infra addresses: `pacto_chain_config` (`PACTO_*` env vars; see `.env.example`).

use alloy::network::TransactionBuilder;
use alloy::primitives::{Address, B256, U256};
use alloy::sol_types::SolCall;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Runtime};

use super::access_control::{require_capability, GovCapability};
use super::contracts::pacto_sponsor::ISquadSponsorExt::addressOwnerCall;
use super::contracts::pacto_sponsor::ISquadSponsorFactory::{
    createSquadSponsorCall, createSquadSponsorExtCall, squadsCall,
};
use super::contracts::pacto_sponsor::SquadVariant;
use super::gov_read::parse_top_hat_id;
use super::pacto_chain_config;
use super::rpc::call::eth_call_decode;
use super::rpc::signer::{
    load_active_squad_embedded_signer, load_squad_roster_embedded_signer,
    require_roster_treasury_signing_allowed, require_treasury_signing_allowed,
};
use super::rpc::{
    connect_read_provider, connect_signing_provider, contract_call_request, send_and_confirm,
    wallet_err_json, wallet_err_json_with_tx_hash,
};
use super::squad_sponsor_common::{
    parse_deposit_wei, parse_signer_wallet, read_squad_record, require_parent_member,
    squad_id_from_parent_id, squad_variant_label,
};
use super::wallet_chain_config;
use crate::db;

/// Both variants are captain-gated: an Ext sponsor blocks the hats-first path.
const DEPLOY_REQUIRED_CAPABILITY: GovCapability = GovCapability::CaptainResign;

pub(crate) fn parse_required_deposit_wei(raw: Option<&str>) -> Result<U256, String> {
    let deposit = parse_deposit_wei(raw).map_err(|e| wallet_err_json("INVALID_DEPOSIT", e, None))?;
    if deposit.is_zero() {
        return Err(wallet_err_json(
            "INVALID_DEPOSIT",
            "initial deposit must be greater than zero",
            None,
        ));
    }
    Ok(deposit)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadSponsorDeployResult {
    pub tx_hash: String,
    pub chain: String,
    pub chain_id: u64,
    /// `0x`-prefixed bytes32 derived from the parent id.
    pub squad_id: String,
    pub sponsor_address: String,
    pub paymaster_address: String,
    /// Deploy variant: `ext` or `hats`.
    pub variant: String,
    /// JSON for `squad_infra.provider_payload` / announces.
    pub provider_payload: String,
    pub infra_row_id: String,
}

/// Variant-specific deploy inputs; `deploy_squad_sponsor_impl` owns the shared flow.
enum SponsorDeployVariant {
    /// Address-list sponsor owned by the squad roster EVM.
    Ext,
    /// Hat-first sponsor linked to the parent's Nave Pirata top hat.
    Hats { top_hat_id: String },
}

impl SponsorDeployVariant {
    /// Top-level `variant` of the deploy result (TS DTO contract).
    fn result_label(&self) -> &'static str {
        match self {
            Self::Ext => "ext",
            Self::Hats { .. } => "hats",
        }
    }

    /// Default fee payer when the caller does not pass `signer_wallet`.
    fn default_signer_mode(&self) -> &'static str {
        match self {
            Self::Ext => "default",
            Self::Hats { .. } => "squad",
        }
    }

    fn confirm_timeout_message(&self) -> &'static str {
        match self {
            Self::Ext => "Timed out waiting for sponsor deploy confirmation.",
            Self::Hats { .. } => "Timed out waiting for hats sponsor deploy confirmation.",
        }
    }
}

/// Validated variant inputs ready for calldata and payload construction.
enum VariantInputs {
    Ext,
    Hats { top_hat: U256, registry: Address },
}

/// Requested top hat must be non-zero and match the parent's persisted Pacto Gov infra.
fn checked_top_hat_id(raw: &str, stored: Option<&str>) -> Result<U256, String> {
    let top_hat =
        parse_top_hat_id(raw).map_err(|e| wallet_err_json("INVALID_TOP_HAT", e, None))?;
    if top_hat.is_zero() {
        return Err(wallet_err_json(
            "INVALID_TOP_HAT",
            "top_hat_id must be non-zero",
            None,
        ));
    }
    if let Some(stored) = stored {
        let expected =
            parse_top_hat_id(stored).map_err(|e| wallet_err_json("INVALID_TOP_HAT", e, None))?;
        if expected != top_hat {
            return Err(wallet_err_json(
                "TOP_HAT_MISMATCH",
                "top_hat_id does not match this parent's Pacto Gov infra",
                None,
            ));
        }
    }
    Ok(top_hat)
}

/// Hats registry: the gov deploy config wins over the sponsor book entry.
fn resolve_hats_registry(
    gov_registry: Option<Address>,
    sponsor_registry: Option<Address>,
) -> Result<Address, String> {
    gov_registry.or(sponsor_registry).ok_or_else(|| {
        wallet_err_json(
            "SPONSOR_CONFIG",
            "navePirataRegistry missing for hats sponsor deploy",
            None,
        )
    })
}

/// Duplicate-deploy preflight outcome from the local row and factory registry signals.
#[derive(Debug, PartialEq, Eq)]
enum SponsorPreflight {
    Clear,
    AlreadyDeployedLocal,
    AlreadyDeployedOnChain,
}

fn sponsor_preflight_decision(has_local_row: bool, registry_sponsor: Address) -> SponsorPreflight {
    if has_local_row {
        SponsorPreflight::AlreadyDeployedLocal
    } else if !registry_sponsor.is_zero() {
        SponsorPreflight::AlreadyDeployedOnChain
    } else {
        SponsorPreflight::Clear
    }
}

/// `variant` vocabulary of the deploy result DTO, derived from the on-chain registry variant.
fn onchain_variant_result_label(v: SquadVariant) -> &'static str {
    match v {
        SquadVariant::EXT => "ext",
        SquadVariant::SPONSOR => "hats",
        _ => "unknown",
    }
}

/// Payload extras recoverable from the factory registry record alone (no deploy tx, no clone reads).
fn reconcile_payload_extras(variant: SquadVariant, top_hat: U256) -> Vec<(&'static str, serde_json::Value)> {
    match variant {
        SquadVariant::SPONSOR => vec![("topHatId", json!(top_hat.to_string()))],
        _ => vec![],
    }
}

/// ALREADY_DEPLOYED error carrying the on-chain sponsor so the UI can route to management.
fn already_deployed_onchain_err(sponsor_hex: &str, variant: &str) -> String {
    json!({
        "code": "ALREADY_DEPLOYED",
        "message": "A sponsor is already deployed on-chain for this squad; the local record was reconciled.",
        "sponsorAddress": sponsor_hex,
        "variant": variant,
        "reconciled": true,
    })
    .to_string()
}

/// `squad_infra.provider_payload` JSON for a deployed sponsor clone.
fn sponsor_provider_payload(
    pid: &str,
    squad_id: B256,
    sponsor: Address,
    paymaster: Address,
    entry_point: Address,
    onchain_variant: &str,
    tx_hash: Option<String>,
    extras: &[(&str, serde_json::Value)],
) -> String {
    let mut map = serde_json::Map::new();
    map.insert("v".to_string(), json!(1));
    map.insert("parentId".to_string(), json!(pid));
    map.insert("squadId".to_string(), json!(format!("{:#x}", squad_id)));
    map.insert("sponsor".to_string(), json!(format!("{:#x}", sponsor)));
    map.insert("paymaster".to_string(), json!(format!("{:#x}", paymaster)));
    map.insert(
        "entryPoint".to_string(),
        json!(format!("{:#x}", entry_point)),
    );
    map.insert("variant".to_string(), json!(onchain_variant));
    for (key, value) in extras {
        map.insert(key.to_string(), value.clone());
    }
    if let Some(tx) = tx_hash {
        map.insert("txHash".to_string(), json!(tx));
    }
    serde_json::Value::Object(map).to_string()
}

async fn deploy_squad_sponsor_impl<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    initial_deposit_wei: Option<String>,
    signer_wallet: Option<String>,
    variant: SponsorDeployVariant,
) -> Result<SquadSponsorDeployResult, String> {
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
    require_capability(&app, pid, DEPLOY_REQUIRED_CAPABILITY).await?;

    // Hats inputs validate against the persisted gov infra before any network work.
    let hats_top_hat = match &variant {
        SponsorDeployVariant::Ext => None,
        SponsorDeployVariant::Hats { top_hat_id } => {
            let stored = db::pacto_gov_top_hat_id_for_parent(&app, pid)?;
            Some(checked_top_hat_id(top_hat_id, stored.as_deref())?)
        }
    };

    let net_key = network.to_lowercase();
    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {}", network),
            None,
        ));
    };

    let addrs = pacto_chain_config::squad_sponsor_deploy_addresses(&net.key)
        .map_err(|e| wallet_err_json("SPONSOR_CONFIG", e, None))?;

    let inputs = match hats_top_hat {
        None => VariantInputs::Ext,
        Some(top_hat) => {
            let gov_addrs = pacto_chain_config::pacto_gov_deploy_addresses(&net.key)
                .map_err(|e| wallet_err_json("NAVE_PIRATA_CONFIG", e, None))?;
            let registry =
                resolve_hats_registry(gov_addrs.nave_pirata_registry, addrs.nave_pirata_registry)?;
            VariantInputs::Hats { top_hat, registry }
        }
    };

    let deposit = parse_required_deposit_wei(initial_deposit_wei.as_deref())?;
    let squad_id = squad_id_from_parent_id(pid);
    let factory = addrs.squad_sponsor_factory;

    let urls = wallet_chain_config::rpc_urls_for(net);
    if urls.is_empty() {
        return Err(wallet_err_json(
            "RPC_CONFIG",
            "no RPC URL configured",
            None,
        ));
    }

    let read_provider = connect_read_provider(&urls).await?;

    // Transient RPC failure must not fall through to a doomed deploy tx.
    let record = eth_call_decode(&read_provider, factory, &squadsCall { squadId: squad_id })
        .await
        .map_err(|e| wallet_err_json("SPONSOR_LOOKUP", e, None))?;
    match sponsor_preflight_decision(
        db::parent_has_sponsor_infra(&app, pid).unwrap_or(false),
        record.sponsor,
    ) {
        SponsorPreflight::Clear => {}
        SponsorPreflight::AlreadyDeployedLocal => {
            return Err(wallet_err_json(
                "ALREADY_DEPLOYED",
                "This parent already has squad sponsor infrastructure.",
                None,
            ));
        }
        SponsorPreflight::AlreadyDeployedOnChain => {
            // Clone on-chain but no local row: reconcile so the UI routes to management.
            let sponsor_hex = format!("{:#x}", record.sponsor);
            let payload = sponsor_provider_payload(
                pid,
                squad_id,
                record.sponsor,
                addrs.pacto_sponsor_paymaster,
                addrs.entry_point,
                squad_variant_label(record.variant),
                None,
                &reconcile_payload_extras(record.variant, record.topHatId),
            );
            db::persist_sponsor_infra(
                &app,
                pid,
                net.key.as_str(),
                sponsor_hex.as_str(),
                payload.as_str(),
            )
            .map_err(|e| wallet_err_json("PERSIST_SPONSOR", e, None))?;
            return Err(already_deployed_onchain_err(
                &sponsor_hex,
                onchain_variant_result_label(record.variant),
            ));
        }
    }

    // Ext addressOwner is always the squad roster EVM; the tx may still be funded by Default.
    let (calldata, roster) = match &inputs {
        VariantInputs::Ext => {
            let (roster_signer, roster_wallet) =
                load_squad_roster_embedded_signer(app.clone(), pid).await?;
            let calldata = createSquadSponsorExtCall {
                squadId: squad_id,
                addressOwner: roster_signer.address(),
            }
            .abi_encode();
            (calldata, Some((roster_signer, roster_wallet)))
        }
        VariantInputs::Hats { top_hat, registry } => {
            let calldata = createSquadSponsorCall {
                squadId: squad_id,
                topHatId: *top_hat,
                registry: *registry,
                customEligibleHats: vec![],
            }
            .abi_encode();
            (calldata, None)
        }
    };

    let signer_mode = parse_signer_wallet(signer_wallet.as_deref(), variant.default_signer_mode())?;
    let (_signer, wallet) = if signer_mode == "default" {
        require_treasury_signing_allowed(app.clone()).await?;
        load_active_squad_embedded_signer(app.clone()).await?
    } else {
        require_roster_treasury_signing_allowed(app.clone(), pid).await?;
        match roster {
            Some(pair) => pair,
            None => load_squad_roster_embedded_signer(app.clone(), pid).await?,
        }
    };
    let provider = connect_signing_provider(&urls, wallet).await?;

    let tx = contract_call_request(factory, calldata).with_value(deposit);
    let receipt = send_and_confirm(&provider, tx, variant.confirm_timeout_message()).await?;

    let (sponsor, onchain_variant, linked_hat) = read_squad_record(&read_provider, factory, squad_id)
        .await
        .map_err(|e| {
            wallet_err_json_with_tx_hash(
                "PARSE_DEPLOY",
                e,
                None,
                format!("0x{:x}", receipt.transaction_hash),
            )
        })?;

    let paymaster = addrs.pacto_sponsor_paymaster;
    let sponsor_hex = format!("{:#x}", sponsor);
    let tx_hash = format!("0x{:x}", receipt.transaction_hash);

    let extras = match &inputs {
        VariantInputs::Ext => {
            let address_owner: Address =
                eth_call_decode(&read_provider, sponsor, &addressOwnerCall {})
                    .await
                    .map_err(|e| {
                        wallet_err_json_with_tx_hash("SPONSOR_READ", e, None, tx_hash.clone())
                    })?;
            vec![("addressOwner", json!(format!("{:#x}", address_owner)))]
        }
        VariantInputs::Hats { registry, .. } => vec![
            ("topHatId", json!(linked_hat.to_string())),
            ("registry", json!(format!("{:#x}", registry))),
        ],
    };

    let payload = sponsor_provider_payload(
        pid,
        squad_id,
        sponsor,
        paymaster,
        addrs.entry_point,
        squad_variant_label(onchain_variant),
        Some(tx_hash.clone()),
        &extras,
    );

    let infra_row_id = db::squad_sponsor_infra_row_id(pid);
    db::persist_sponsor_infra(
        &app,
        pid,
        net.key.as_str(),
        sponsor_hex.as_str(),
        payload.as_str(),
    )
    .map_err(|e| wallet_err_json("PERSIST_SPONSOR", e, None))?;

    Ok(SquadSponsorDeployResult {
        tx_hash,
        chain: net.key.clone(),
        chain_id: net.chain_id,
        squad_id: format!("{:#x}", squad_id),
        sponsor_address: sponsor_hex,
        paymaster_address: format!("{:#x}", paymaster),
        variant: variant.result_label().to_string(),
        provider_payload: payload,
        infra_row_id,
    })
}

#[tauri::command]
pub async fn deploy_squad_sponsor_for_parent<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    initial_deposit_wei: Option<String>,
    signer_wallet: Option<String>,
) -> Result<SquadSponsorDeployResult, String> {
    deploy_squad_sponsor_impl(
        app,
        network,
        parent_id,
        initial_deposit_wei,
        signer_wallet,
        SponsorDeployVariant::Ext,
    )
    .await
}

/// Deploy a hat-first SquadSponsor clone linked to an existing Nave Pirata top hat.
#[tauri::command]
pub async fn deploy_squad_sponsor_hats_for_parent<R: Runtime>(
    app: AppHandle<R>,
    network: String,
    parent_id: String,
    top_hat_id: String,
    initial_deposit_wei: Option<String>,
    signer_wallet: Option<String>,
) -> Result<SquadSponsorDeployResult, String> {
    deploy_squad_sponsor_impl(
        app,
        network,
        parent_id,
        initial_deposit_wei,
        signer_wallet,
        SponsorDeployVariant::Hats { top_hat_id },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::{
        already_deployed_onchain_err, checked_top_hat_id, onchain_variant_result_label,
        parse_required_deposit_wei, reconcile_payload_extras, resolve_hats_registry,
        sponsor_preflight_decision, sponsor_provider_payload, squad_id_from_parent_id,
        SponsorDeployVariant, SponsorPreflight, DEPLOY_REQUIRED_CAPABILITY,
    };
    use alloy::primitives::{Address, U256};
    use alloy::sol_types::SolCall;
    use crate::evm::access_control::GovCapability;
    use crate::evm::contracts::pacto_sponsor::ISquadSponsorFactory::{
        createSquadSponsorCall, createSquadSponsorExtCall,
    };
    use crate::evm::contracts::pacto_sponsor::SquadVariant;
    use crate::evm::squad_sponsor_common::parse_signer_wallet;

    fn err_code(err: &str) -> String {
        serde_json::from_str::<serde_json::Value>(err)
            .ok()
            .and_then(|v| v.get("code").and_then(|c| c.as_str()).map(String::from))
            .unwrap_or_default()
    }

    #[test]
    fn deploy_gate_is_captain_capability() {
        // Both variants gate on the captain hat; a member-only Ext deploy would
        // permanently block the hats-first path.
        assert_eq!(DEPLOY_REQUIRED_CAPABILITY, GovCapability::CaptainResign);
        assert_eq!(DEPLOY_REQUIRED_CAPABILITY.as_str(), "captainResign");
    }

    #[test]
    fn variant_spec_pins_result_label_and_signer_default() {
        let ext = SponsorDeployVariant::Ext;
        assert_eq!(ext.result_label(), "ext");
        assert_eq!(ext.default_signer_mode(), "default");
        assert!(!ext.confirm_timeout_message().is_empty());

        let hats = SponsorDeployVariant::Hats {
            top_hat_id: "42".to_string(),
        };
        assert_eq!(hats.result_label(), "hats");
        assert_eq!(hats.default_signer_mode(), "squad");
        assert!(!hats.confirm_timeout_message().is_empty());
    }

    #[test]
    fn checked_top_hat_id_accepts_valid_and_matching_stored() {
        assert_eq!(checked_top_hat_id("42", None).unwrap(), U256::from(42u64));
        assert_eq!(
            checked_top_hat_id(" 42 ", Some("42")).unwrap(),
            U256::from(42u64)
        );
        assert_eq!(
            checked_top_hat_id("0x2a", Some("42")).unwrap(),
            U256::from(42u64)
        );
    }

    #[test]
    fn checked_top_hat_id_rejects_zero_invalid_and_mismatch() {
        assert_eq!(
            err_code(&checked_top_hat_id("0", None).unwrap_err()),
            "INVALID_TOP_HAT"
        );
        assert_eq!(
            err_code(&checked_top_hat_id("not-a-number", None).unwrap_err()),
            "INVALID_TOP_HAT"
        );
        assert_eq!(
            err_code(&checked_top_hat_id("42", Some("43")).unwrap_err()),
            "TOP_HAT_MISMATCH"
        );
        assert_eq!(
            err_code(&checked_top_hat_id("42", Some("garbage")).unwrap_err()),
            "INVALID_TOP_HAT"
        );
    }

    #[test]
    fn resolve_hats_registry_prefers_gov_config_then_sponsor_book() {
        let gov = Address::repeat_byte(0x33);
        let sponsor = Address::repeat_byte(0x44);
        assert_eq!(resolve_hats_registry(Some(gov), Some(sponsor)).unwrap(), gov);
        assert_eq!(resolve_hats_registry(None, Some(sponsor)).unwrap(), sponsor);
        assert_eq!(
            err_code(&resolve_hats_registry(None, None).unwrap_err()),
            "SPONSOR_CONFIG"
        );
    }

    #[test]
    fn preflight_decision_prefers_local_row_then_registry_record() {
        assert_eq!(
            sponsor_preflight_decision(false, Address::ZERO),
            SponsorPreflight::Clear
        );
        assert_eq!(
            sponsor_preflight_decision(true, Address::ZERO),
            SponsorPreflight::AlreadyDeployedLocal
        );
        // The local row wins even when the registry also lists a clone.
        assert_eq!(
            sponsor_preflight_decision(true, Address::repeat_byte(0x55)),
            SponsorPreflight::AlreadyDeployedLocal
        );
        assert_eq!(
            sponsor_preflight_decision(false, Address::repeat_byte(0x55)),
            SponsorPreflight::AlreadyDeployedOnChain
        );
    }

    #[test]
    fn onchain_variant_maps_to_result_vocabulary() {
        assert_eq!(onchain_variant_result_label(SquadVariant::EXT), "ext");
        assert_eq!(onchain_variant_result_label(SquadVariant::SPONSOR), "hats");
        assert_eq!(onchain_variant_result_label(SquadVariant::NONE), "unknown");
    }

    #[test]
    fn reconcile_extras_recover_top_hat_only_for_hats_variant() {
        let extras = reconcile_payload_extras(SquadVariant::SPONSOR, U256::from(42u64));
        assert_eq!(extras, vec![("topHatId", serde_json::json!("42"))]);
        assert!(reconcile_payload_extras(SquadVariant::EXT, U256::ZERO).is_empty());
        assert!(reconcile_payload_extras(SquadVariant::NONE, U256::ZERO).is_empty());
    }

    #[test]
    fn already_deployed_onchain_err_carries_variant_and_sponsor() {
        let err = already_deployed_onchain_err("0x1111111111111111111111111111111111111111", "ext");
        let v: serde_json::Value = serde_json::from_str(&err).expect("json");
        assert_eq!(v.get("code").and_then(|c| c.as_str()), Some("ALREADY_DEPLOYED"));
        assert_eq!(v.get("variant").and_then(|c| c.as_str()), Some("ext"));
        assert_eq!(
            v.get("sponsorAddress").and_then(|c| c.as_str()),
            Some("0x1111111111111111111111111111111111111111")
        );
        assert_eq!(v.get("reconciled").and_then(|c| c.as_bool()), Some(true));
    }

    #[test]
    fn deploy_payload_ext_carries_owner_and_tx_hash() {
        let squad_id = squad_id_from_parent_id("squad-alpha");
        let sponsor = Address::repeat_byte(0x11);
        let paymaster = Address::repeat_byte(0x22);
        let entry_point = Address::repeat_byte(0x33);
        let owner = Address::repeat_byte(0x44);
        let payload = sponsor_provider_payload(
            "squad-alpha",
            squad_id,
            sponsor,
            paymaster,
            entry_point,
            "ext",
            Some("0xtx".to_string()),
            &[("addressOwner", serde_json::json!(format!("{:#x}", owner)))],
        );
        let v: serde_json::Value = serde_json::from_str(&payload).expect("json");
        assert_eq!(
            v,
            serde_json::json!({
                "v": 1,
                "parentId": "squad-alpha",
                "squadId": format!("{:#x}", squad_id),
                "sponsor": format!("{:#x}", sponsor),
                "paymaster": format!("{:#x}", paymaster),
                "entryPoint": format!("{:#x}", entry_point),
                "variant": "ext",
                "addressOwner": format!("{:#x}", owner),
                "txHash": "0xtx",
            })
        );
    }

    #[test]
    fn deploy_payload_hats_carries_top_hat_and_registry() {
        let squad_id = squad_id_from_parent_id("squad-alpha");
        let sponsor = Address::repeat_byte(0x11);
        let paymaster = Address::repeat_byte(0x22);
        let entry_point = Address::repeat_byte(0x33);
        let registry = Address::repeat_byte(0x55);
        let payload = sponsor_provider_payload(
            "squad-alpha",
            squad_id,
            sponsor,
            paymaster,
            entry_point,
            "sponsor",
            Some("0xtx".to_string()),
            &[
                ("topHatId", serde_json::json!("42")),
                ("registry", serde_json::json!(format!("{:#x}", registry))),
            ],
        );
        let v: serde_json::Value = serde_json::from_str(&payload).expect("json");
        assert_eq!(
            v,
            serde_json::json!({
                "v": 1,
                "parentId": "squad-alpha",
                "squadId": format!("{:#x}", squad_id),
                "sponsor": format!("{:#x}", sponsor),
                "paymaster": format!("{:#x}", paymaster),
                "entryPoint": format!("{:#x}", entry_point),
                "variant": "sponsor",
                "topHatId": "42",
                "registry": format!("{:#x}", registry),
                "txHash": "0xtx",
            })
        );
    }

    #[test]
    fn reconcile_payload_omits_tx_hash() {
        let payload = sponsor_provider_payload(
            "squad-alpha",
            squad_id_from_parent_id("squad-alpha"),
            Address::repeat_byte(0x11),
            Address::repeat_byte(0x22),
            Address::repeat_byte(0x33),
            "sponsor",
            None,
            &[("topHatId", serde_json::json!("42"))],
        );
        let v: serde_json::Value = serde_json::from_str(&payload).expect("json");
        assert!(v.get("txHash").is_none());
        assert_eq!(v.get("topHatId").and_then(|t| t.as_str()), Some("42"));
    }

    fn squad_infra_schema(conn: &rusqlite::Connection) {
        conn.execute_batch(
            "CREATE TABLE squad_infra (
                id TEXT PRIMARY KEY NOT NULL,
                parent_id TEXT NOT NULL,
                infra_type TEXT NOT NULL,
                chain TEXT NOT NULL,
                canonical_ref TEXT NOT NULL,
                pacto_gov_revision TEXT,
                provider_payload TEXT,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );",
        )
        .expect("schema");
    }

    /// Same upsert shape as `db::persist_sponsor_infra` (AppHandle-bound, so exercised at this seam).
    fn persist_sponsor_row(
        conn: &rusqlite::Connection,
        parent_id: &str,
        chain: &str,
        sponsor_address: &str,
        provider_payload: &str,
        now_ms: i64,
    ) {
        let id = crate::db::squad_sponsor_infra_row_id(parent_id);
        let norm = crate::evm::normalize_hex_address(sponsor_address.trim()).expect("address");
        conn.execute(
            "INSERT INTO squad_infra (id, parent_id, infra_type, chain, canonical_ref, pacto_gov_revision, provider_payload, created_at_ms, updated_at_ms) \
             VALUES (?1, ?2, 'sponsor', ?3, ?4, NULL, ?5, ?6, ?7) \
             ON CONFLICT(id) DO UPDATE SET \
               chain = excluded.chain, \
               canonical_ref = excluded.canonical_ref, \
               provider_payload = excluded.provider_payload, \
               updated_at_ms = excluded.updated_at_ms",
            rusqlite::params![id, parent_id, chain, norm, provider_payload, now_ms, now_ms],
        )
        .expect("upsert");
    }

    /// Same guard query as the duplicate-deploy preflight.
    fn sponsor_row_count(conn: &rusqlite::Connection, parent_id: &str) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM squad_infra WHERE parent_id = ?1 AND infra_type = 'sponsor'",
            rusqlite::params![parent_id],
            |row| row.get(0),
        )
        .expect("count")
    }

    #[test]
    fn sponsor_infra_persist_round_trips_and_trips_duplicate_guard() {
        let conn = rusqlite::Connection::open_in_memory().expect("db");
        squad_infra_schema(&conn);
        let pid = "squad-alpha";
        let sponsor = "0x1111111111111111111111111111111111111111";
        let payload_v1 = sponsor_provider_payload(
            pid,
            squad_id_from_parent_id(pid),
            Address::repeat_byte(0x11),
            Address::repeat_byte(0x22),
            Address::repeat_byte(0x33),
            "ext",
            Some("0xtx".to_string()),
            &[],
        );
        assert_eq!(sponsor_row_count(&conn, pid), 0);

        persist_sponsor_row(&conn, pid, "sepolia", sponsor, &payload_v1, 1);
        assert_eq!(sponsor_row_count(&conn, pid), 1);
        // A non-sponsor infra row for another parent must not trip the guard.
        assert_eq!(sponsor_row_count(&conn, "other-parent"), 0);

        let (chain, canonical, payload_back): (String, String, String) = conn
            .query_row(
                "SELECT chain, canonical_ref, provider_payload FROM squad_infra WHERE id = ?1",
                rusqlite::params![crate::db::squad_sponsor_infra_row_id(pid)],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("row");
        assert_eq!(chain, "sepolia");
        assert_eq!(canonical, crate::evm::normalize_hex_address(sponsor).unwrap());
        assert_eq!(payload_back, payload_v1);

        // Re-persisting (reconcile or re-announce) updates in place instead of duplicating.
        let payload_v2 = sponsor_provider_payload(
            pid,
            squad_id_from_parent_id(pid),
            Address::repeat_byte(0x11),
            Address::repeat_byte(0x22),
            Address::repeat_byte(0x33),
            "sponsor",
            None,
            &[("topHatId", serde_json::json!("42"))],
        );
        persist_sponsor_row(&conn, pid, "sepolia", sponsor, &payload_v2, 2);
        assert_eq!(sponsor_row_count(&conn, pid), 1);
        let payload_back: String = conn
            .query_row(
                "SELECT provider_payload FROM squad_infra WHERE id = ?1",
                rusqlite::params![crate::db::squad_sponsor_infra_row_id(pid)],
                |row| row.get(0),
            )
            .expect("row");
        assert_eq!(payload_back, payload_v2);
    }

    #[test]
    fn squad_id_matches_solidity_keccak256_string_bytes() {
        let id = squad_id_from_parent_id("squad-alpha");
        let expected = alloy::primitives::keccak256("squad-alpha".as_bytes());
        assert_eq!(id, expected);
    }

    #[test]
    fn parse_required_deposit_wei_rejects_empty_and_zero() {
        assert!(parse_required_deposit_wei(None).is_err());
        assert!(parse_required_deposit_wei(Some("")).is_err());
        assert!(parse_required_deposit_wei(Some("0")).is_err());
        assert!(parse_required_deposit_wei(Some("0x0")).is_err());
        assert_eq!(
            parse_required_deposit_wei(Some("1000")).unwrap(),
            U256::from(1000u64)
        );
    }

    #[test]
    fn parse_signer_wallet_rejects_unknown_for_deploy() {
        assert_eq!(parse_signer_wallet(None, "default").unwrap(), "default");
        assert_eq!(parse_signer_wallet(Some("squad"), "default").unwrap(), "squad");
        assert!(parse_signer_wallet(Some("imported"), "default").is_err());
    }

    fn selector(signature: &str) -> [u8; 4] {
        let hash = alloy::primitives::keccak256(signature.as_bytes());
        [hash[0], hash[1], hash[2], hash[3]]
    }

    #[test]
    fn encode_create_squad_sponsor_ext_matches_golden_vector() {
        let squad_id = squad_id_from_parent_id("squad-alpha");
        let owner = Address::repeat_byte(0x11);
        let encoded = createSquadSponsorExtCall {
            squadId: squad_id,
            addressOwner: owner,
        }
        .abi_encode();

        let mut expected = selector("createSquadSponsorExt(bytes32,address)").to_vec();
        expected.extend_from_slice(squad_id.as_slice());
        expected.extend_from_slice(&[0u8; 12]);
        expected.extend_from_slice(owner.as_slice());
        assert_eq!(encoded, expected);

        let decoded = createSquadSponsorExtCall::abi_decode(&encoded).expect("decode");
        assert_eq!(decoded.squadId, squad_id);
        assert_eq!(decoded.addressOwner, owner);
    }

    #[test]
    fn encode_create_squad_sponsor_hats_matches_golden_vector() {
        let squad_id = squad_id_from_parent_id("squad-alpha");
        let top_hat = U256::from(42u64);
        let registry = Address::repeat_byte(0x22);
        let encoded = createSquadSponsorCall {
            squadId: squad_id,
            topHatId: top_hat,
            registry,
            customEligibleHats: vec![],
        }
        .abi_encode();

        let mut expected = selector("createSquadSponsor(bytes32,uint256,address,uint256[])").to_vec();
        expected.extend_from_slice(squad_id.as_slice());
        expected.extend_from_slice(&top_hat.to_be_bytes::<32>());
        expected.extend_from_slice(&[0u8; 12]);
        expected.extend_from_slice(registry.as_slice());
        // Offset to the (empty) customEligibleHats tail, then its element count.
        expected.extend_from_slice(&U256::from(128u64).to_be_bytes::<32>());
        expected.extend_from_slice(&U256::ZERO.to_be_bytes::<32>());
        assert_eq!(encoded, expected);

        let decoded = createSquadSponsorCall::abi_decode(&encoded).expect("decode");
        assert_eq!(decoded.squadId, squad_id);
        assert_eq!(decoded.topHatId, top_hat);
        assert_eq!(decoded.registry, registry);
        assert!(decoded.customEligibleHats.is_empty());
    }
}
