//! ERC-4337 sponsored governance writes via PactoSponsorPaymaster.
//! See pacto-squad-sponsor `docs/DESKTOP_CLIENT_INTEGRATION.md`.

use alloy::primitives::{Address, Bytes, Uint, B256, U256};
use alloy::providers::Provider;
use alloy::sol_types::SolCall;
use serde::Serialize;
use std::str::FromStr;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_sponsor::ISquadSponsorBase::{
    isEligibleCall, paymasterCall, spendablePoolWeiCall,
};
use super::gov_read::rpc_urls_or_default;
use super::pacto_chain_config;
use super::rpc::call::eth_call_decode;
use super::rpc::signer::load_squad_roster_embedded_signer;
use super::rpc::{connect_read_provider, parse_address, wallet_err_json};
use super::sponsor_paymaster::{encode_paymaster_and_data, required_pool_balance};
use super::squad_sponsor_common::{read_squad_record, squad_id_from_parent_id};
use super::userop::{
    estimate_sponsored_userop, finalize_for_style, paymaster_entry_point_deposit_preflight,
    resolve_eip7702_auth_for_sender, resolve_userop_eip1559_fees, sign_and_send_sponsored_userop,
    userop_gas_ceilings, userop_max_cost_wei, IAccountExecute, IEntryPointV07,
    SponsoredUserOpBuild, UseropPlaceholderLane,
};
use super::wallet_chain_config;
use crate::db;

pub use super::userop::wait_for_user_operation_receipt;
#[allow(unused_imports)]
pub(crate) use super::userop::{
    apply_userop_gas_margin, apply_verification_gas_margin, bundler_cap_fallback_estimate,
    bundler_estimate_user_operation_gas, bundler_send_user_operation, bundler_userop_gas_cap,
    call_gas_ceiling_for_calldata, call_gas_with_margin, clamp_estimated_gas_to_bundler_cap,
    clamp_userop_gas_limits_to_cap, dummy_userop_signature, estimate_call_gas,
    factory_userop_too_large_error, fallback_call_gas_limit, fallback_max_fee,
    fallback_max_priority_fee, finalize_factory_userop_gas_limits, finalize_userop_gas_limits,
    heavy_call_gas_limit, is_bundler_gas_limit_error, pack_u128s,
    parse_user_operation_gas_price_response, pass2_or_clamped_pass1, paymaster_data,
    should_skip_estimate_calibrate, sign_eip7702_authorization, user_op_json, userop_gas_limit_sum,
    wallet_error_code, EstimatedUserOpGas, FinalGasLimits, UserOpParams,
};

pub fn erc4337_account_implementation(network_key: &str) -> Option<Address> {
    pacto_chain_config::erc4337_account_implementation(network_key)
}

/// Account SQLite settings key for an in-app Pimlico API key (never MLS / `.env`).
const PIMLICO_API_KEY_SETTING: &str = "pimlico_api_key";

/// EntryPoint v0.7 bundler URL: optional `BUNDLER_RPC_URL` override, else stored key, else `PIMLICO_API_KEY`.
/// Non-`https://` overrides error with `BUNDLER_CONFIG` (no URL echo).
#[cfg(test)]
pub fn bundler_rpc_url(network_key: &str) -> Result<Option<String>, String> {
    bundler_rpc_url_with_stored(network_key, None)
}

pub(crate) fn bundler_rpc_url_with_stored(
    network_key: &str,
    stored_key: Option<&str>,
) -> Result<Option<String>, String> {
    if let Some(url) = explicit_bundler_rpc_url()? {
        return Ok(Some(url));
    }
    Ok(pimlico_bundler_rpc_url_with_key(network_key, stored_key))
}

fn bundler_override_raw() -> Option<String> {
    std::env::var("BUNDLER_RPC_URL")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn host_is_alchemy(url: &str) -> bool {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase()))
        .map(|h| h == "alchemy.com" || h.ends_with(".alchemy.com"))
        .unwrap_or(false)
}

fn explicit_bundler_rpc_url() -> Result<Option<String>, String> {
    let Some(url) = bundler_override_raw() else {
        return Ok(None);
    };
    if !url.starts_with("https://") {
        return Err(wallet_err_json(
            "BUNDLER_CONFIG",
            "BUNDLER_RPC_URL must be an https:// EntryPoint v0.7 bundler URL.",
            None,
        ));
    }
    if host_is_alchemy(&url) {
        return Err(wallet_err_json(
            "BUNDLER_CONFIG",
            "BUNDLER_RPC_URL must not be an Alchemy endpoint. Use PIMLICO_API_KEY (or a non-Alchemy EntryPoint v0.7 bundler).",
            None,
        ));
    }
    Ok(Some(url))
}

/// UI status only: no URLs or keys.
#[cfg(test)]
pub fn bundler_status_source(network_key: &str) -> &'static str {
    bundler_status_source_with_stored(network_key, None)
}

fn bundler_status_source_with_stored(network_key: &str, stored_key: Option<&str>) -> &'static str {
    if let Some(url) = bundler_override_raw() {
        if host_is_alchemy(&url) {
            return "blocked_alchemy_override";
        }
        if url.starts_with("https://") {
            return "pimlico";
        }
        return "none";
    }
    if pimlico_bundler_rpc_url_with_key(network_key, stored_key).is_some() {
        "pimlico"
    } else {
        "none"
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundlerStatusDto {
    pub source: String,
    pub has_stored_key: bool,
}

#[tauri::command]
pub fn get_bundler_status<R: Runtime>(app: AppHandle<R>, network: String) -> BundlerStatusDto {
    let stored_raw = stored_pimlico_key_raw(&app);
    BundlerStatusDto {
        source: bundler_status_source_with_stored(&network, stored_raw.as_deref()).to_string(),
        has_stored_key: stored_raw.is_some(),
    }
}

fn validate_pimlico_api_key(raw: &str) -> Result<String, String> {
    let key = raw.trim();
    if key.is_empty() || key.chars().any(char::is_whitespace) {
        return Err(wallet_err_json(
            "BUNDLER_CONFIG",
            "Pimlico API key is empty.",
            None,
        ));
    }
    let lower = key.to_ascii_lowercase();
    if lower.contains("://") || lower.starts_with("http") || lower.contains("alchemy.com") {
        return Err(wallet_err_json(
            "BUNDLER_CONFIG",
            "Pimlico API key must not be a URL.",
            None,
        ));
    }
    Ok(key.to_string())
}

fn stored_pimlico_key_raw<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    db::get_sql_setting(app.clone(), PIMLICO_API_KEY_SETTING.to_string())
        .ok()
        .flatten()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub(crate) fn load_stored_pimlico_key<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    stored_pimlico_key_raw(app).and_then(|k| validate_pimlico_api_key(&k).ok())
}

fn pimlico_env_key() -> Option<String> {
    std::env::var("PIMLICO_API_KEY")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn resolved_pimlico_key(stored_key: Option<&str>) -> Option<String> {
    stored_key
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(pimlico_env_key)
}

fn pimlico_bundler_rpc_url_with_key(network_key: &str, stored_key: Option<&str>) -> Option<String> {
    let key = resolved_pimlico_key(stored_key)?;
    let chain_id = pimlico_chain_id_for_network(network_key)?;
    Some(format!(
        "https://api.pimlico.io/v2/{chain_id}/rpc?apikey={key}"
    ))
}

/// Pimlico EP v0.7 bundler URL. Stored account key wins over `PIMLICO_API_KEY`.
#[cfg(test)]
fn pimlico_bundler_rpc_url(network_key: &str) -> Option<String> {
    pimlico_bundler_rpc_url_with_key(network_key, None)
}

#[tauri::command]
pub fn set_pimlico_api_key<R: Runtime>(app: AppHandle<R>, key: String) -> Result<(), String> {
    let key = validate_pimlico_api_key(&key)?;
    crate::account_manager::get_current_account().map_err(|_| {
        wallet_err_json("BUNDLER_CONFIG", "Sign in to save a Pimlico API key.", None)
    })?;
    db::set_sql_setting(app, PIMLICO_API_KEY_SETTING.to_string(), key)
}

#[tauri::command]
pub fn clear_pimlico_api_key<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    db::remove_setting(app, PIMLICO_API_KEY_SETTING.to_string()).map(|_| ())
}

fn pimlico_chain_id_for_network(network_key: &str) -> Option<u64> {
    match network_key.trim().to_lowercase().as_str() {
        "sepolia" | "local" | "anvil" | "hardhat" => Some(11155111),
        _ => None,
    }
}

pub async fn roster_native_balance_wei<P: Provider>(
    provider: &P,
    roster: Address,
) -> Result<U256, String> {
    provider.get_balance(roster).await.map_err(|e| {
        wallet_err_json(
            "RPC_BALANCE",
            crate::evm::wallet_security::redact_urls_in_text(&e.to_string()),
            None,
        )
    })
}

const WAR_GAME_MODULE_KEYS: [&str; 5] = [
    "safe",
    "quartermaster",
    "mutinyModule",
    "treasuryAuthority",
    "squadAdminProxy",
];

/// Active war-game stack: UserOps must encode `gameSquadId`, not parent keccak.
#[derive(Clone, Debug)]
pub struct WarGameUserOpContext {
    pub game_squad_id: B256,
    modules: Vec<Address>,
}

impl WarGameUserOpContext {
    pub fn targets(&self, to: Address) -> bool {
        self.modules.iter().any(|a| *a == to)
    }
}

pub fn parse_war_game_userop_context(payload: &str) -> Option<WarGameUserOpContext> {
    let v: serde_json::Value = serde_json::from_str(payload).ok()?;
    let status = v
        .get("status")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim();
    if !status.eq_ignore_ascii_case("active") {
        return None;
    }
    let id_raw = v.get("gameSquadId").and_then(|x| x.as_str())?;
    let game_squad_id = B256::from_str(id_raw.trim()).ok()?;
    let mut modules = Vec::with_capacity(WAR_GAME_MODULE_KEYS.len());
    for key in WAR_GAME_MODULE_KEYS {
        let raw = v.get(key).and_then(|x| x.as_str())?;
        let addr = parse_address(raw).ok()?;
        if addr.is_zero() {
            return None;
        }
        modules.push(addr);
    }
    Some(WarGameUserOpContext {
        game_squad_id,
        modules,
    })
}

/// Paymaster `squadId`: war-game module writes use the round id; production stays parent keccak.
pub fn resolve_sponsored_squad_id(
    parent_id: &str,
    to: Address,
    wargame_payload: Option<&str>,
) -> B256 {
    if let Some(ctx) = wargame_payload.and_then(parse_war_game_userop_context) {
        if ctx.targets(to) {
            return ctx.game_squad_id;
        }
    }
    squad_id_from_parent_id(parent_id)
}

pub async fn sponsor_eligibility_preflight<P: Provider>(
    provider: &P,
    factory: Address,
    expected_paymaster: Address,
    squad_id: B256,
    member: Address,
    estimated_max_cost_wei: U256,
) -> Result<(Address, B256), String> {
    let (sponsor, _variant, _hat) = read_squad_record(provider, factory, squad_id)
        .await
        .map_err(|e| wallet_err_json("SPONSOR_LOOKUP", e, None))?;
    let clone_paymaster: Address = eth_call_decode(provider, sponsor, &paymasterCall {})
        .await
        .map_err(|e| wallet_err_json("SPONSOR_READ", e, None))?;
    if clone_paymaster != expected_paymaster {
        return Err(wallet_err_json(
            "SPONSOR_PAYMASTER_MISMATCH",
            format!(
                "squad sponsor clone paymaster ({clone_paymaster:#x}) does not match the address book ({expected_paymaster:#x}). After a factory redeploy, recreate the squad sponsor (old clones are not migratable)."
            ),
            None,
        ));
    }
    let eligible: bool = eth_call_decode(provider, sponsor, &isEligibleCall { member })
        .await
        .map_err(|e| wallet_err_json("SPONSOR_READ", e, None))?;
    if !eligible {
        return Err(wallet_err_json(
            "SPONSOR_INELIGIBLE",
            "roster address is not eligible for gas sponsorship (hat or Ext permit)",
            None,
        ));
    }
    let pool: U256 = eth_call_decode(provider, sponsor, &spendablePoolWeiCall {})
        .await
        .map_err(|e| wallet_err_json("SPONSOR_READ", e, None))?;
    let need = required_pool_balance(estimated_max_cost_wei);
    if pool < need {
        return Err(wallet_err_json(
            "SPONSOR_POOL_LOW",
            format!("sponsor spendablePoolWei {pool} below required headroom {need}"),
            None,
        ));
    }
    Ok((sponsor, squad_id))
}

/// Result of a successful sponsored UserOp submit (before receipt poll).
pub struct SponsoredUserOpSend {
    pub user_op_hash: String,
    /// Bundler that accepted the UserOp — use this for `eth_getUserOperationReceipt`.
    pub bundler_url: String,
}

/// Pimlico `standard` fee for UserOp maxCost. Last-resort policy fee when no bundler URL is configured.
pub(crate) async fn sponsored_userop_max_fee<R: Runtime>(
    app: &AppHandle<R>,
    network_key: &str,
) -> u128 {
    let stored = load_stored_pimlico_key(app);
    if let Ok(Some(url)) = bundler_rpc_url_with_stored(network_key, stored.as_deref()) {
        return resolve_userop_eip1559_fees(&url).await.1;
    }
    fallback_max_fee()
}

/// Attempt a sponsored UserOp; returns EntryPoint userOp hash + accepting bundler on success.
pub async fn send_sponsored_gov_userop<R: Runtime>(
    app: AppHandle<R>,
    network: &str,
    parent_id: &str,
    to: Address,
    calldata: Vec<u8>,
    rpc_urls: Option<Vec<String>>,
) -> Result<SponsoredUserOpSend, String> {
    let net_key = network.to_lowercase();
    let stored_key = load_stored_pimlico_key(&app);
    let bundler = bundler_rpc_url_with_stored(&net_key, stored_key.as_deref())?.ok_or_else(|| {
        wallet_err_json(
            "BUNDLER_CONFIG",
            "Save a Pimlico API key on Status, or set PIMLICO_API_KEY (or BUNDLER_RPC_URL), for an EntryPoint v0.7 bundler when the roster key has no ETH.",
            None,
        )
    })?;
    let account_impl = erc4337_account_implementation(network).ok_or_else(|| {
        wallet_err_json(
            "ERC4337_ACCOUNT_CONFIG",
            "Missing EIP-7702 account implementation for this network (address book erc4337.accountImplementation, or PACTO_ERC4337_ACCOUNT_IMPL).",
            None,
        )
    })?;

    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {network}"),
            None,
        ));
    };
    let wargame_payload = db::pacto_gov_wargame_payload_for_parent(&app, parent_id)
        .ok()
        .flatten();
    let stack = crate::evm::access_control::GovStack::for_wargame_target_corroborated(
        &app,
        parent_id,
        to,
        rpc_urls.clone(),
    )
    .await?;
    let is_wargame_op = stack == crate::evm::access_control::GovStack::WarGame;
    if !db::parent_has_sponsor_infra(&app, parent_id).unwrap_or(false) && !is_wargame_op {
        return Err(wallet_err_json(
            "SPONSOR_REQUIRED",
            "Deploy squad sponsor before sponsored governance writes.",
            None,
        ));
    }
    let squad_id = if is_wargame_op {
        resolve_sponsored_squad_id(parent_id, to, wargame_payload.as_deref())
    } else {
        squad_id_from_parent_id(parent_id)
    };

    let addrs = pacto_chain_config::squad_sponsor_deploy_addresses(&net.key)
        .map_err(|e| wallet_err_json("SPONSOR_CONFIG", e, None))?;
    let urls = rpc_urls_or_default(net, rpc_urls);
    if urls.is_empty() {
        return Err(wallet_err_json("RPC_CONFIG", "no RPC URL configured", None));
    }

    let (signer, _wallet) = load_squad_roster_embedded_signer(app.clone(), parent_id).await?;
    let member = signer.address();
    let read_provider = connect_read_provider(&urls).await?;

    let (max_priority, max_fee) = resolve_userop_eip1559_fees(&bundler).await;

    let ceilings = userop_gas_ceilings(&calldata, UseropPlaceholderLane::Squad);
    let placeholder_max_cost = userop_max_cost_wei(
        ceilings.call,
        ceilings.verification,
        ceilings.pre_verification,
        max_fee,
        ceilings.pm_verification,
        ceilings.pm_post,
    );
    paymaster_entry_point_deposit_preflight(
        &read_provider,
        addrs.entry_point,
        addrs.pacto_sponsor_paymaster,
        placeholder_max_cost,
    )
    .await?;
    let (sponsor, squad_id) = sponsor_eligibility_preflight(
        &read_provider,
        addrs.squad_sponsor_factory,
        addrs.pacto_sponsor_paymaster,
        squad_id,
        member,
        placeholder_max_cost,
    )
    .await?;

    let execute_calldata = IAccountExecute::executeCall {
        dest: to,
        value: U256::ZERO,
        data: Bytes::from(calldata),
    }
    .abi_encode();

    let nonce: U256 = eth_call_decode(
        &read_provider,
        addrs.entry_point,
        &IEntryPointV07::getNonceCall {
            sender: member,
            key: Uint::<192, 3>::from(0u64),
        },
    )
    .await
    .map_err(|e| wallet_err_json("ENTRY_POINT_NONCE", e, None))?;

    let code = read_provider.get_code_at(member).await.map_err(|e| {
        wallet_err_json(
            "RPC_CODE",
            crate::evm::wallet_security::redact_urls_in_text(&e.to_string()),
            None,
        )
    })?;
    let eip7702_auth = resolve_eip7702_auth_for_sender(
        &read_provider,
        &signer,
        member,
        code.as_ref(),
        net.chain_id,
        account_impl,
    )
    .await?;

    let paymaster = addrs.pacto_sponsor_paymaster;
    let entry_point = addrs.entry_point;
    let factory = addrs.squad_sponsor_factory;
    let build = SponsoredUserOpBuild {
        sender: member,
        nonce,
        call_data: &execute_calldata,
        entry_point,
        paymaster,
        max_fee,
        max_priority,
        eip7702_auth,
    };
    let encode = |pm_v: u128, pm_post: u128| {
        encode_paymaster_and_data(paymaster, squad_id, sponsor, member, pm_v, pm_post).to_vec()
    };
    let estimated =
        estimate_sponsored_userop(&bundler, &build, ceilings, false, "sponsored", &encode).await?;
    let limits = finalize_for_style(false, &estimated)?;
    let user_op_hash = sign_and_send_sponsored_userop(
        &read_provider,
        &signer,
        &bundler,
        &build,
        limits,
        &encode,
        |max_cost| {
            let provider = &read_provider;
            async move {
                sponsor_eligibility_preflight(
                    provider, factory, paymaster, squad_id, member, max_cost,
                )
                .await
                .map(|_| ())
            }
        },
    )
    .await?;
    Ok(SponsoredUserOpSend {
        user_op_hash,
        bundler_url: bundler,
    })
}

pub(crate) fn is_soft_sponsor_config_error(err: &str) -> bool {
    matches!(
        wallet_error_code(err).as_deref(),
        Some("BUNDLER_CONFIG" | "ERC4337_ACCOUNT_CONFIG")
    )
}

/// Preflight failures that EOA fallback cannot fix; surface to the user instead of continuing.
pub(crate) fn is_hard_sponsor_preflight_error(err: &str) -> bool {
    matches!(
        wallet_error_code(err).as_deref(),
        Some(
            "USERNAME_POOL_LOW"
                | "SPONSOR_POOL_LOW"
                | "PAYMASTER_DEPOSIT_LOW"
                | "PAYMASTER_STAKE_LOW"
                | "SPONSOR_POLICY_READ"
                | "BUNDLER_FEE"
        )
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::evm::sponsor_paymaster::paymaster_data_offset;
    use crate::evm::squad_sponsor_common::squad_id_from_parent_id;
    use alloy::primitives::{address, b256, B256};
    use serde_json::json;

    #[test]
    fn hard_sponsor_preflight_classification() {
        let err = |code: &str| format!(r#"{{"code":"{code}","message":"x"}}"#);
        assert!(is_hard_sponsor_preflight_error(&err("USERNAME_POOL_LOW")));
        assert!(is_hard_sponsor_preflight_error(&err(
            "PAYMASTER_DEPOSIT_LOW"
        )));
        assert!(is_hard_sponsor_preflight_error(&err("BUNDLER_FEE")));
        assert!(!is_hard_sponsor_preflight_error(&err("BUNDLER_CONFIG")));
        assert!(is_soft_sponsor_config_error(&err("BUNDLER_CONFIG")));
    }

    fn war_game_payload(ta: &str, game_squad_id: B256, status: &str) -> String {
        json!({
            "v": 1,
            "status": status,
            "gameSquadId": format!("{game_squad_id:#x}"),
            "safe": "0x1111111111111111111111111111111111111111",
            "quartermaster": "0x2222222222222222222222222222222222222222",
            "mutinyModule": "0x3333333333333333333333333333333333333333",
            "treasuryAuthority": ta,
            "squadAdminProxy": "0x4444444444444444444444444444444444444444",
            "sponsor": "0x5555555555555555555555555555555555555555",
            "round": "1",
        })
        .to_string()
    }

    #[test]
    fn war_game_userop_encodes_game_squad_id_not_parent_keccak() {
        let parent = "parent-1";
        let game_squad_id =
            b256!("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        let ta = address!("0x5412b91D05101D3BD802E4E8D4c576f0e525AeDa");
        let payload = war_game_payload(&format!("{ta:#x}"), game_squad_id, "active");
        let resolved = resolve_sponsored_squad_id(parent, ta, Some(&payload));
        assert_eq!(resolved, game_squad_id);
        assert_ne!(resolved, squad_id_from_parent_id(parent));
        let encoded = encode_paymaster_and_data(
            address!("0x78197483Ac3180361cDb1F59Dd702Ea8ca34AC3A"),
            resolved,
            address!("0x2222222222222222222222222222222222222222"),
            address!("0x3333333333333333333333333333333333333333"),
            500_000,
            50_000,
        );
        let parent_encoded = encode_paymaster_and_data(
            address!("0x78197483Ac3180361cDb1F59Dd702Ea8ca34AC3A"),
            squad_id_from_parent_id(parent),
            address!("0x2222222222222222222222222222222222222222"),
            address!("0x3333333333333333333333333333333333333333"),
            500_000,
            50_000,
        );
        assert_ne!(encoded, parent_encoded);
        assert_eq!(
            &encoded[paymaster_data_offset() + 32..paymaster_data_offset() + 64],
            game_squad_id.as_slice()
        );
    }

    #[test]
    fn production_module_write_keeps_parent_keccak_when_war_game_exists() {
        let parent = "parent-1";
        let game_squad_id =
            b256!("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        let production_ta = address!("0x9999999999999999999999999999999999999999");
        let payload = war_game_payload(
            "0x5412b91D05101D3BD802E4E8D4c576f0e525AeDa",
            game_squad_id,
            "active",
        );
        let resolved = resolve_sponsored_squad_id(parent, production_ta, Some(&payload));
        assert_eq!(resolved, squad_id_from_parent_id(parent));
    }

    #[test]
    fn retired_war_game_payload_does_not_route_userops() {
        let parent = "parent-1";
        let game_squad_id =
            b256!("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        let ta = address!("0x5412b91D05101D3BD802E4E8D4c576f0e525AeDa");
        let payload = war_game_payload(&format!("{ta:#x}"), game_squad_id, "retired");
        assert!(parse_war_game_userop_context(&payload).is_none());
        let resolved = resolve_sponsored_squad_id(parent, ta, Some(&payload));
        assert_eq!(resolved, squad_id_from_parent_id(parent));
    }

    struct EnvVarGuard(&'static str, Option<std::ffi::OsString>);
    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.1 {
                Some(v) => std::env::set_var(self.0, v),
                None => std::env::remove_var(self.0),
            }
        }
    }

    static ENV_TEST_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn bundler_rpc_url_override_wins_over_pimlico() {
        let _lock = ENV_TEST_MUTEX.lock();
        let prev_b = std::env::var_os("BUNDLER_RPC_URL");
        let prev_p = std::env::var_os("PIMLICO_API_KEY");
        let _gb = EnvVarGuard("BUNDLER_RPC_URL", prev_b);
        let _gp = EnvVarGuard("PIMLICO_API_KEY", prev_p);
        std::env::set_var("BUNDLER_RPC_URL", "https://bundler.example/v2/explicit");
        std::env::set_var("PIMLICO_API_KEY", "test-pimlico-key");
        assert_eq!(
            bundler_rpc_url("sepolia").unwrap().as_deref(),
            Some("https://bundler.example/v2/explicit")
        );
        assert_eq!(
            explicit_bundler_rpc_url().unwrap().as_deref(),
            Some("https://bundler.example/v2/explicit")
        );
    }

    #[test]
    fn bundler_rpc_url_rejects_non_https_override() {
        let _lock = ENV_TEST_MUTEX.lock();
        let prev_b = std::env::var_os("BUNDLER_RPC_URL");
        let prev_p = std::env::var_os("PIMLICO_API_KEY");
        let _gb = EnvVarGuard("BUNDLER_RPC_URL", prev_b);
        let _gp = EnvVarGuard("PIMLICO_API_KEY", prev_p);
        std::env::set_var("BUNDLER_RPC_URL", "http://bundler.example/rpc");
        std::env::set_var("PIMLICO_API_KEY", "test-pimlico-key");
        let err = bundler_rpc_url("sepolia").unwrap_err();
        assert!(err.contains("BUNDLER_CONFIG"));
        assert!(!err.contains("http://bundler.example"));
        assert!(explicit_bundler_rpc_url().is_err());
    }

    #[test]
    fn bundler_rpc_url_rejects_alchemy_override() {
        let _lock = ENV_TEST_MUTEX.lock();
        let prev_b = std::env::var_os("BUNDLER_RPC_URL");
        let prev_p = std::env::var_os("PIMLICO_API_KEY");
        let _gb = EnvVarGuard("BUNDLER_RPC_URL", prev_b);
        let _gp = EnvVarGuard("PIMLICO_API_KEY", prev_p);
        std::env::set_var(
            "BUNDLER_RPC_URL",
            "https://eth-sepolia.g.alchemy.com/v2/test-key",
        );
        std::env::set_var("PIMLICO_API_KEY", "test-pimlico-key");
        let err = bundler_rpc_url("sepolia").unwrap_err();
        assert!(err.contains("BUNDLER_CONFIG"));
        assert!(!err.contains("eth-sepolia"));
        assert!(!err.contains("test-key"));
        assert!(explicit_bundler_rpc_url().is_err());
        assert_eq!(bundler_status_source("sepolia"), "blocked_alchemy_override");
        assert!(host_is_alchemy(
            "https://eth-sepolia.g.alchemy.com/v2/test-key"
        ));
        assert!(!host_is_alchemy(
            "https://api.pimlico.io/v2/11155111/rpc?apikey=x"
        ));
    }

    #[test]
    fn bundler_status_pimlico_when_key_set() {
        let _lock = ENV_TEST_MUTEX.lock();
        let prev_b = std::env::var_os("BUNDLER_RPC_URL");
        let prev_p = std::env::var_os("PIMLICO_API_KEY");
        let _gb = EnvVarGuard("BUNDLER_RPC_URL", prev_b);
        let _gp = EnvVarGuard("PIMLICO_API_KEY", prev_p);
        std::env::remove_var("BUNDLER_RPC_URL");
        std::env::set_var("PIMLICO_API_KEY", "test-pimlico-key");
        assert_eq!(bundler_status_source("sepolia"), "pimlico");
    }

    #[test]
    fn bundler_rpc_url_uses_pimlico_when_override_unset() {
        let _lock = ENV_TEST_MUTEX.lock();
        let prev_b = std::env::var_os("BUNDLER_RPC_URL");
        let prev_p = std::env::var_os("PIMLICO_API_KEY");
        let prev_a = std::env::var_os("ALCHEMY_RPC_KEY");
        let _gb = EnvVarGuard("BUNDLER_RPC_URL", prev_b);
        let _gp = EnvVarGuard("PIMLICO_API_KEY", prev_p);
        let _ga = EnvVarGuard("ALCHEMY_RPC_KEY", prev_a);
        std::env::remove_var("BUNDLER_RPC_URL");
        std::env::set_var("PIMLICO_API_KEY", "test-pimlico-key");
        std::env::set_var("ALCHEMY_RPC_KEY", "alchemy-key");
        assert_eq!(
            bundler_rpc_url("sepolia").unwrap().as_deref(),
            Some("https://api.pimlico.io/v2/11155111/rpc?apikey=test-pimlico-key")
        );
    }

    #[test]
    fn bundler_rpc_url_none_without_pimlico_or_override() {
        let _lock = ENV_TEST_MUTEX.lock();
        let prev_b = std::env::var_os("BUNDLER_RPC_URL");
        let prev_p = std::env::var_os("PIMLICO_API_KEY");
        let prev_a = std::env::var_os("ALCHEMY_RPC_KEY");
        let _gb = EnvVarGuard("BUNDLER_RPC_URL", prev_b);
        let _gp = EnvVarGuard("PIMLICO_API_KEY", prev_p);
        let _ga = EnvVarGuard("ALCHEMY_RPC_KEY", prev_a);
        std::env::remove_var("BUNDLER_RPC_URL");
        std::env::remove_var("PIMLICO_API_KEY");
        std::env::set_var("ALCHEMY_RPC_KEY", "alchemy-key");
        assert!(bundler_rpc_url("sepolia").unwrap().is_none());
    }

    #[test]
    fn pimlico_url_uses_sepolia_chain_id() {
        let _lock = ENV_TEST_MUTEX.lock();
        let prev = std::env::var_os("PIMLICO_API_KEY");
        let _g = EnvVarGuard("PIMLICO_API_KEY", prev);
        std::env::set_var("PIMLICO_API_KEY", "test-pimlico-key");
        assert_eq!(pimlico_chain_id_for_network("sepolia"), Some(11155111));
        assert_eq!(pimlico_chain_id_for_network("local"), Some(11155111));
        assert_eq!(pimlico_chain_id_for_network("mainnet"), None);
        assert_eq!(
            pimlico_bundler_rpc_url("sepolia").as_deref(),
            Some("https://api.pimlico.io/v2/11155111/rpc?apikey=test-pimlico-key")
        );
        assert!(pimlico_bundler_rpc_url("mainnet").is_none());
    }

    #[test]
    fn pimlico_url_none_without_key() {
        let _lock = ENV_TEST_MUTEX.lock();
        let prev = std::env::var_os("PIMLICO_API_KEY");
        let _g = EnvVarGuard("PIMLICO_API_KEY", prev);
        std::env::remove_var("PIMLICO_API_KEY");
        assert!(pimlico_bundler_rpc_url("sepolia").is_none());
    }

    #[test]
    fn stored_pimlico_key_wins_over_env() {
        let _lock = ENV_TEST_MUTEX.lock();
        let prev_b = std::env::var_os("BUNDLER_RPC_URL");
        let prev_p = std::env::var_os("PIMLICO_API_KEY");
        let _gb = EnvVarGuard("BUNDLER_RPC_URL", prev_b);
        let _gp = EnvVarGuard("PIMLICO_API_KEY", prev_p);
        std::env::remove_var("BUNDLER_RPC_URL");
        std::env::set_var("PIMLICO_API_KEY", "env-pimlico-key");
        assert_eq!(
            bundler_rpc_url_with_stored("sepolia", Some("stored-pimlico-key"))
                .unwrap()
                .as_deref(),
            Some("https://api.pimlico.io/v2/11155111/rpc?apikey=stored-pimlico-key")
        );
        assert_eq!(
            bundler_status_source_with_stored("sepolia", Some("stored-pimlico-key")),
            "pimlico"
        );
    }

    #[test]
    fn clear_stored_pimlico_key_falls_back_to_env() {
        let _lock = ENV_TEST_MUTEX.lock();
        let prev_b = std::env::var_os("BUNDLER_RPC_URL");
        let prev_p = std::env::var_os("PIMLICO_API_KEY");
        let _gb = EnvVarGuard("BUNDLER_RPC_URL", prev_b);
        let _gp = EnvVarGuard("PIMLICO_API_KEY", prev_p);
        std::env::remove_var("BUNDLER_RPC_URL");
        std::env::set_var("PIMLICO_API_KEY", "env-pimlico-key");
        assert_eq!(
            bundler_rpc_url_with_stored("sepolia", None)
                .unwrap()
                .as_deref(),
            Some("https://api.pimlico.io/v2/11155111/rpc?apikey=env-pimlico-key")
        );
    }

    #[test]
    fn validate_pimlico_api_key_rejects_url() {
        let err = validate_pimlico_api_key("https://api.pimlico.io/v2/11155111/rpc?apikey=x")
            .unwrap_err();
        assert!(err.contains("BUNDLER_CONFIG"));
        assert!(!err.contains("apikey=x"));
        assert!(validate_pimlico_api_key("https://eth-sepolia.g.alchemy.com/v2/test-key").is_err());
        assert!(validate_pimlico_api_key("").is_err());
        assert!(validate_pimlico_api_key("   ").is_err());
        assert_eq!(
            validate_pimlico_api_key("  pim_test_key  ").unwrap(),
            "pim_test_key"
        );
    }

    #[test]
    fn alchemy_bundler_override_still_blocked_with_stored_key() {
        let _lock = ENV_TEST_MUTEX.lock();
        let prev_b = std::env::var_os("BUNDLER_RPC_URL");
        let prev_p = std::env::var_os("PIMLICO_API_KEY");
        let _gb = EnvVarGuard("BUNDLER_RPC_URL", prev_b);
        let _gp = EnvVarGuard("PIMLICO_API_KEY", prev_p);
        std::env::set_var(
            "BUNDLER_RPC_URL",
            "https://eth-sepolia.g.alchemy.com/v2/test-key",
        );
        std::env::remove_var("PIMLICO_API_KEY");
        let err = bundler_rpc_url_with_stored("sepolia", Some("stored-pimlico-key")).unwrap_err();
        assert!(err.contains("BUNDLER_CONFIG"));
        assert!(!err.contains("eth-sepolia"));
        assert_eq!(
            bundler_status_source_with_stored("sepolia", Some("stored-pimlico-key")),
            "blocked_alchemy_override"
        );
    }
}
