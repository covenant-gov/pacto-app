//! On-chain deployment addresses for pacto-gov, pacto-squad-sponsor, and Safe bundles.
//!
//! Primary source: [`pacto-protocol-addresses.json`](../../../src/lib/evm/pacto-protocol-addresses.json)
//! (compile-time embed). Optional `PACTO_*` env vars override book entries for local experiments.
//! RPC URLs stay env-only — see `wallet_chain_config`.

use alloy::primitives::Address;
use once_cell::sync::Lazy;
use serde::Deserialize;
use std::collections::HashMap;

use super::contracts::safe::SafeFactoryAddresses;
use super::rpc::parse_address;

const EMBEDDED_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../src/lib/evm/pacto-protocol-addresses.json"
));

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Root {
    #[allow(dead_code)]
    version: u32,
    networks: HashMap<String, NetworkBook>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NetworkBook {
    #[allow(dead_code)]
    chain_id: u64,
    squad_sponsor: Option<SquadSponsorBook>,
    pacto_gov: Option<PactoGovBook>,
    safe: Option<SafeBook>,
    erc4337: Option<Erc4337Book>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Erc4337Book {
    /// EIP-7702 / ERC-4337 account implementation for roster EOAs (optional).
    account_implementation: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SquadSponsorBook {
    factory: String,
    paymaster: String,
    entry_point: String,
    nave_pirata_registry: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PactoGovBook {
    nave_pirata_factory: String,
    nave_pirata_registry: Option<String>,
    master_quartermaster: String,
    master_mutiny: String,
    master_treasury_authority: String,
    master_squad_admin_impl: String,
    master_squad_admin_ext_impl: String,
    hats: Option<String>,
    role_hat_clones_factory: Option<String>,
    role_hat_upgrader: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SafeBook {
    proxy_factory: String,
    singleton: String,
    fallback_handler: String,
}

static PROTOCOL_BOOK: Lazy<Root> = Lazy::new(|| {
    serde_json::from_str(EMBEDDED_JSON).expect("pacto-protocol-addresses.json must parse")
});

fn net_suffix(net_key: &str) -> String {
    net_key.to_ascii_uppercase().replace('-', "_")
}

fn book_for(net_key: &str) -> Option<&NetworkBook> {
    PROTOCOL_BOOK.networks.get(net_key)
}

fn parse_book_addr(raw: &str) -> Result<Address, String> {
    parse_address(raw.trim())
}

/// `PACTO_FOO` or `PACTO_FOO_SEPOLIA` (etc.) when set in the environment.
fn env_addr_primary_or_net(primary: &str, net_key: &str) -> Result<Address, String> {
    let net_upper = net_suffix(net_key);
    let suffixed = format!("{}_{}", primary, net_upper);
    std::env::var(&suffixed)
        .or_else(|_| std::env::var(primary))
        .map_err(|_| format!("Set {} or {} to a 0x address.", suffixed, primary))
        .and_then(|s| parse_address(s.trim()))
}

fn env_addr_optional(primary: &str, net_key: &str) -> Option<Address> {
    env_addr_primary_or_net(primary, net_key).ok()
}

fn resolve_required(
    env_primary: &str,
    net_key: &str,
    book_value: Option<&str>,
    label: &str,
) -> Result<Address, String> {
    if let Ok(addr) = env_addr_primary_or_net(env_primary, net_key) {
        return Ok(addr);
    }
    if let Some(raw) = book_value {
        return parse_book_addr(raw);
    }
    Err(format!(
        "Missing {label} for network `{net_key}`. Add it to src/lib/evm/pacto-protocol-addresses.json or set {env_primary}."
    ))
}

fn resolve_optional(env_primary: &str, net_key: &str, book_value: Option<&str>) -> Option<Address> {
    env_addr_optional(env_primary, net_key)
        .or_else(|| book_value.and_then(|raw| parse_book_addr(raw).ok()))
}

#[derive(Clone, Debug)]
pub struct PactoGovDeployAddresses {
    pub nave_pirata_factory: Address,
    pub master_quartermaster: Address,
    pub master_mutiny: Address,
    pub master_treasury_authority: Address,
    pub master_squad_admin_impl: Address,
    pub master_squad_admin_ext_impl: Address,
    pub nave_pirata_registry: Option<Address>,
    pub hats: Option<Address>,
    pub role_hat_clones_factory: Option<Address>,
    pub role_hat_upgrader: Option<Address>,
}

pub fn pacto_gov_deploy_addresses(net_key: &str) -> Result<PactoGovDeployAddresses, String> {
    let book = book_for(net_key).and_then(|n| n.pacto_gov.as_ref());
    Ok(PactoGovDeployAddresses {
        nave_pirata_factory: resolve_required(
            "PACTO_NAVE_PIRATA_FACTORY",
            net_key,
            book.map(|b| b.nave_pirata_factory.as_str()),
            "navePirataFactory",
        )?,
        master_quartermaster: resolve_required(
            "PACTO_NAV_MASTER_QUARTERMASTER",
            net_key,
            book.map(|b| b.master_quartermaster.as_str()),
            "masterQuartermaster",
        )?,
        master_mutiny: resolve_required(
            "PACTO_NAV_MASTER_MUTINY",
            net_key,
            book.map(|b| b.master_mutiny.as_str()),
            "masterMutiny",
        )?,
        master_treasury_authority: resolve_required(
            "PACTO_NAV_MASTER_TREASURY_AUTHORITY",
            net_key,
            book.map(|b| b.master_treasury_authority.as_str()),
            "masterTreasuryAuthority",
        )?,
        master_squad_admin_impl: resolve_required(
            "PACTO_NAV_MASTER_SQUAD_ADMIN",
            net_key,
            book.map(|b| b.master_squad_admin_impl.as_str()),
            "masterSquadAdminImpl",
        )?,
        master_squad_admin_ext_impl: resolve_required(
            "PACTO_NAV_MASTER_SQUAD_ADMIN_EXT",
            net_key,
            book.map(|b| b.master_squad_admin_ext_impl.as_str()),
            "masterSquadAdminExtImpl",
        )?,
        nave_pirata_registry: resolve_optional(
            "PACTO_NAVE_PIRATA_REGISTRY",
            net_key,
            book.and_then(|b| b.nave_pirata_registry.as_deref()),
        ),
        hats: resolve_optional("PACTO_HATS", net_key, book.and_then(|b| b.hats.as_deref())),
        role_hat_clones_factory: resolve_optional(
            "PACTO_ROLE_HAT_CLONES_FACTORY",
            net_key,
            book.and_then(|b| b.role_hat_clones_factory.as_deref()),
        ),
        role_hat_upgrader: resolve_optional(
            "PACTO_ROLE_HAT_UPGRADER",
            net_key,
            book.and_then(|b| b.role_hat_upgrader.as_deref()),
        ),
    })
}

/// Chain id pacto-app's `local` network is fixed to (matches `wallet_chain_config`'s
/// `local` entry and the chain `scripts/seed-anvil.sh` seeds).
const LOCAL_CHAIN_ID: u64 = 31_337;

/// Env var the sibling deployment script exports alongside the `_LOCAL` address
/// overrides, carrying the chain id backing the deployment artifact it read.
const LOCAL_CHAIN_ID_ENV: &str = "PACTO_LOCAL_CHAIN_ID";

fn local_artifact_path(chain_id: u64) -> String {
    format!("data/deployments/{chain_id}/full-system.json")
}

/// Refuses local-network address resolution when the deployment artifact no longer
/// describes the chain the build is pointed at, instead of handing back addresses
/// that resolve to nothing on-chain and failing later inside a contract call.
///
/// `factory_has_code` mirrors the `eth_getCode` liveness check
/// `ensure-external-contracts.sh` already uses for its own idempotence (see
/// `sponsor_userop.rs`'s `get_code_at` precedent): callers wire it to a live RPC probe
/// against the resolved `NavePirataFactory`; tests inject a fixed answer so the guard
/// stays offline and deterministic.
///
/// A no-op for every network but `local` — the artifact env vars only ever carry the
/// `_LOCAL` suffix, so this cannot fire for sepolia/arbitrum/mainnet even if called
/// unconditionally. A no-op (falls back to the compiled book, no error) when the
/// artifact env vars are entirely absent, preserving today's behavior.
pub fn guard_local_chain_artifact(
    net_key: &str,
    factory_has_code: impl FnOnce(Address) -> Result<bool, String>,
) -> Result<(), String> {
    if net_key != "local" {
        return Ok(());
    }

    let Ok(found_raw) = std::env::var(LOCAL_CHAIN_ID_ENV) else {
        return Ok(());
    };
    let found: u64 = found_raw.trim().parse().map_err(|_| {
        format!(
            "{env_var}=\"{raw}\" is not a valid chain id.",
            env_var = LOCAL_CHAIN_ID_ENV,
            raw = found_raw
        )
    })?;
    if found != LOCAL_CHAIN_ID {
        return Err(format!(
            "Local-chain artifact mismatch: {path} targets chain {found}, but pacto-app's `local` network expects chain {expected}. Re-seed the local chain (`make dev-world` or `scripts/seed-anvil.sh`) or point {env_var} at a chain-{expected} deployment.",
            path = local_artifact_path(found),
            found = found,
            expected = LOCAL_CHAIN_ID,
            env_var = LOCAL_CHAIN_ID_ENV,
        ));
    }

    let addrs = pacto_gov_deploy_addresses(net_key)?;
    let factory = addrs.nave_pirata_factory;
    match factory_has_code(factory) {
        Ok(true) => Ok(()),
        Ok(false) => Err(format!(
            "Local-chain artifact ({path}) names NavePirataFactory {factory:#x}, but it holds no code on chain {expected}. The chain was likely wiped without re-seeding; run `scripts/seed-anvil.sh` (or `make dev-world`) and retry.",
            path = local_artifact_path(LOCAL_CHAIN_ID),
            expected = LOCAL_CHAIN_ID,
        )),
        Err(e) => Err(format!(
            "Could not verify NavePirataFactory {factory:#x} on chain {expected}: {e}",
            expected = LOCAL_CHAIN_ID,
        )),
    }
}

/// Live wrapper over [`guard_local_chain_artifact`] that probes the running chain.
///
/// Returns immediately for non-local networks and when the artifact env vars are
/// absent, so no RPC connection is opened on the paths that do not need one.
pub async fn guard_local_chain_live(net_key: &str) -> Result<(), String> {
    if net_key != "local" || std::env::var(LOCAL_CHAIN_ID_ENV).is_err() {
        return Ok(());
    }

    let net = super::wallet_chain_config::network_by_key(net_key)
        .ok_or_else(|| format!("Unknown network `{net_key}`."))?;
    let urls = super::wallet_chain_config::rpc_urls_for(net);
    let provider = super::rpc::provider::connect_read_provider(&urls).await?;

    let factory = pacto_gov_deploy_addresses(net_key)?.nave_pirata_factory;
    let code = alloy::providers::Provider::get_code_at(&provider, factory)
        .await
        .map_err(|e| e.to_string());

    guard_local_chain_artifact(net_key, |_| code.map(|c| !c.is_empty()))
}

#[derive(Clone, Debug)]
pub struct SquadSponsorDeployAddresses {
    pub squad_sponsor_factory: Address,
    pub pacto_sponsor_paymaster: Address,
    pub entry_point: Address,
    pub nave_pirata_registry: Option<Address>,
}

/// Optional ERC-4337 account implementation for EIP-7702 roster EOAs.
pub fn erc4337_account_implementation(net_key: &str) -> Option<Address> {
    let book = book_for(net_key).and_then(|n| n.erc4337.as_ref());
    resolve_optional(
        "PACTO_ERC4337_ACCOUNT_IMPL",
        net_key,
        book.and_then(|b| b.account_implementation.as_deref()),
    )
}

pub fn squad_sponsor_deploy_addresses(
    net_key: &str,
) -> Result<SquadSponsorDeployAddresses, String> {
    let book = book_for(net_key).and_then(|n| n.squad_sponsor.as_ref());
    Ok(SquadSponsorDeployAddresses {
        squad_sponsor_factory: resolve_required(
            "PACTO_SQUAD_SPONSOR_FACTORY",
            net_key,
            book.map(|b| b.factory.as_str()),
            "squadSponsor.factory",
        )?,
        pacto_sponsor_paymaster: resolve_required(
            "PACTO_SPONSOR_PAYMASTER",
            net_key,
            book.map(|b| b.paymaster.as_str()),
            "squadSponsor.paymaster",
        )?,
        entry_point: resolve_required(
            "PACTO_ENTRY_POINT",
            net_key,
            book.map(|b| b.entry_point.as_str()),
            "squadSponsor.entryPoint",
        )?,
        nave_pirata_registry: resolve_optional(
            "PACTO_NAVE_PIRATA_REGISTRY",
            net_key,
            book.and_then(|b| b.nave_pirata_registry.as_deref()),
        ),
    })
}

/// Safe factory bundle: env override, then protocol book, then safe-global defaults for chain id.
pub fn safe_factory_addresses(net_key: &str, chain_id: u64) -> Option<SafeFactoryAddresses> {
    let env_factory = env_addr_optional("PACTO_SAFE_PROXY_FACTORY", net_key);
    let env_singleton = env_addr_optional("PACTO_SAFE_SINGLETON", net_key);
    if let (Some(proxy_factory), Some(singleton)) = (env_factory, env_singleton) {
        let fallback_handler = env_addr_optional("PACTO_SAFE_FALLBACK_HANDLER", net_key)
            .or_else(|| default_fallback_for_chain_id(chain_id))?;
        return Some(SafeFactoryAddresses {
            singleton,
            proxy_factory,
            fallback_handler,
        });
    }

    if let Some(safe) = book_for(net_key).and_then(|n| n.safe.as_ref()) {
        if let (Ok(proxy_factory), Ok(singleton), Ok(fallback_handler)) = (
            parse_book_addr(&safe.proxy_factory),
            parse_book_addr(&safe.singleton),
            parse_book_addr(&safe.fallback_handler),
        ) {
            return Some(SafeFactoryAddresses {
                singleton,
                proxy_factory,
                fallback_handler,
            });
        }
    }

    super::contracts::safe::default_safe_factory_addresses_for_chain_id(chain_id)
}

fn default_fallback_for_chain_id(chain_id: u64) -> Option<Address> {
    super::contracts::safe::default_safe_factory_addresses_for_chain_id(chain_id)
        .map(|a| a.fallback_handler)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::address;

    #[test]
    fn sepolia_book_loads_sponsor_and_gov() {
        let sp = squad_sponsor_deploy_addresses("sepolia").expect("sponsor book");
        assert_eq!(
            sp.squad_sponsor_factory,
            address!("0x12883924e71Df814ff1E198E5C16CEFd251BC308")
        );
        assert_eq!(
            sp.pacto_sponsor_paymaster,
            address!("0x065dA13369604291E628DD8022E0e504dc62Da12")
        );

        let gov = pacto_gov_deploy_addresses("sepolia").expect("gov book");
        assert_eq!(
            gov.nave_pirata_factory,
            address!("0x6E835c103F4719Fd84EAB57d256132007310B230")
        );
        assert_eq!(
            gov.nave_pirata_registry,
            Some(address!("0x50F7759F65b1a25B1a827D6c97A5dD61f0036278"))
        );
        assert_eq!(
            gov.master_quartermaster,
            address!("0x44bBAD7b0e2df484Daf0c5288B0FaDB75Feb5284")
        );
    }

    #[test]
    fn sepolia_book_safe_bundle_overrides_legacy_defaults() {
        let _lock = ENV_TEST_MUTEX.lock();
        clear_env(&[
            "PACTO_SAFE_PROXY_FACTORY",
            "PACTO_SAFE_SINGLETON",
            "PACTO_SAFE_FALLBACK_HANDLER",
        ]);
        let safe = safe_factory_addresses("sepolia", 11_155_111).expect("safe book");
        assert_eq!(
            safe.proxy_factory,
            address!("0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67")
        );
        assert_eq!(
            safe.singleton,
            address!("0x41675C099F32341bf84BFc5382aF534df5C7461a")
        );
    }

    #[test]
    fn net_suffix_uppercases_and_replaces_dashes() {
        assert_eq!(net_suffix("sepolia"), "SEPOLIA");
        assert_eq!(net_suffix("arbitrum-one"), "ARBITRUM_ONE");
    }

    #[test]
    fn safe_factory_addresses_env_override_wins() {
        let _lock = ENV_TEST_MUTEX.lock();
        clear_env(&[
            "PACTO_SAFE_PROXY_FACTORY",
            "PACTO_SAFE_SINGLETON",
            "PACTO_SAFE_FALLBACK_HANDLER",
        ]);
        let factory = address!("0x1111111111111111111111111111111111111111");
        let singleton = address!("0x2222222222222222222222222222222222222222");
        let fallback = address!("0x3333333333333333333333333333333333333333");
        let _guard = EnvVarGuard::new()
            .set(
                "PACTO_SAFE_PROXY_FACTORY",
                "0x1111111111111111111111111111111111111111",
            )
            .set(
                "PACTO_SAFE_SINGLETON",
                "0x2222222222222222222222222222222222222222",
            )
            .set(
                "PACTO_SAFE_FALLBACK_HANDLER",
                "0x3333333333333333333333333333333333333333",
            );
        let safe = safe_factory_addresses("sepolia", 11_155_111).expect("env override");
        assert_eq!(safe.proxy_factory, factory);
        assert_eq!(safe.singleton, singleton);
        assert_eq!(safe.fallback_handler, fallback);
    }

    #[test]
    fn safe_factory_addresses_mainnet_defaults() {
        let _lock = ENV_TEST_MUTEX.lock();
        clear_env(&[
            "PACTO_SAFE_PROXY_FACTORY",
            "PACTO_SAFE_SINGLETON",
            "PACTO_SAFE_FALLBACK_HANDLER",
        ]);
        let safe = safe_factory_addresses("mainnet", 1).expect("mainnet defaults");
        assert_eq!(
            safe.singleton,
            address!("0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552")
        );
    }

    #[test]
    fn default_fallback_for_chain_id_mainnet() {
        let _lock = ENV_TEST_MUTEX.lock();
        clear_env(&["PACTO_SAFE_FALLBACK_HANDLER"]);
        let fb = default_fallback_for_chain_id(1).expect("mainnet fallback");
        assert_eq!(fb, address!("0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4"));
    }

    #[test]
    fn default_fallback_for_chain_id_unknown() {
        assert!(default_fallback_for_chain_id(999_999).is_none());
    }

    const GOV_LOCAL_ENV_KEYS: &[&str] = &[
        "PACTO_LOCAL_CHAIN_ID",
        "PACTO_NAVE_PIRATA_FACTORY",
        "PACTO_NAVE_PIRATA_FACTORY_LOCAL",
        "PACTO_NAV_MASTER_QUARTERMASTER",
        "PACTO_NAV_MASTER_QUARTERMASTER_LOCAL",
        "PACTO_NAV_MASTER_MUTINY",
        "PACTO_NAV_MASTER_MUTINY_LOCAL",
        "PACTO_NAV_MASTER_TREASURY_AUTHORITY",
        "PACTO_NAV_MASTER_TREASURY_AUTHORITY_LOCAL",
        "PACTO_NAV_MASTER_SQUAD_ADMIN",
        "PACTO_NAV_MASTER_SQUAD_ADMIN_LOCAL",
        "PACTO_NAV_MASTER_SQUAD_ADMIN_EXT",
        "PACTO_NAV_MASTER_SQUAD_ADMIN_EXT_LOCAL",
        "PACTO_NAVE_PIRATA_REGISTRY",
        "PACTO_NAVE_PIRATA_REGISTRY_LOCAL",
        "PACTO_HATS",
        "PACTO_HATS_LOCAL",
        "PACTO_ROLE_HAT_CLONES_FACTORY",
        "PACTO_ROLE_HAT_CLONES_FACTORY_LOCAL",
        "PACTO_ROLE_HAT_UPGRADER",
        "PACTO_ROLE_HAT_UPGRADER_LOCAL",
    ];

    /// Sets every required `pactoGov` address override so `pacto_gov_deploy_addresses("local")`
    /// resolves without hitting the (nonexistent) compiled local book entry.
    fn set_valid_local_gov_env() -> EnvVarGuard {
        EnvVarGuard::new()
            .set(
                "PACTO_NAVE_PIRATA_FACTORY_LOCAL",
                "0x1111111111111111111111111111111111111111",
            )
            .set(
                "PACTO_NAV_MASTER_QUARTERMASTER_LOCAL",
                "0x2222222222222222222222222222222222222222",
            )
            .set(
                "PACTO_NAV_MASTER_MUTINY_LOCAL",
                "0x3333333333333333333333333333333333333333",
            )
            .set(
                "PACTO_NAV_MASTER_TREASURY_AUTHORITY_LOCAL",
                "0x4444444444444444444444444444444444444444",
            )
            .set(
                "PACTO_NAV_MASTER_SQUAD_ADMIN_LOCAL",
                "0x5555555555555555555555555555555555555555",
            )
            .set(
                "PACTO_NAV_MASTER_SQUAD_ADMIN_EXT_LOCAL",
                "0x6666666666666666666666666666666666666666",
            )
    }

    #[test]
    fn guard_local_chain_artifact_matching_resolves_over_book_and_passes() {
        let _lock = ENV_TEST_MUTEX.lock();
        clear_env(GOV_LOCAL_ENV_KEYS);
        assert!(
            book_for("local").is_none(),
            "this test assumes no compiled `local` book entry exists"
        );
        let _guard = set_valid_local_gov_env().set("PACTO_LOCAL_CHAIN_ID", "31337");

        let addrs = pacto_gov_deploy_addresses("local").expect("artifact env vars resolve");
        assert_eq!(
            addrs.nave_pirata_factory,
            address!("0x1111111111111111111111111111111111111111"),
            "addresses must come from the artifact override, not an (absent) compiled book entry"
        );

        let result = guard_local_chain_artifact("local", |_| Ok(true));
        assert!(result.is_ok(), "expected the guard to pass: {result:?}");
    }

    #[test]
    fn guard_local_chain_artifact_absent_falls_back_silently() {
        let _lock = ENV_TEST_MUTEX.lock();
        clear_env(GOV_LOCAL_ENV_KEYS);

        let result = guard_local_chain_artifact("local", |_| {
            panic!("factory liveness must not be probed when the artifact is absent")
        });
        assert!(
            result.is_ok(),
            "absent artifact must fall back to the compiled book without error: {result:?}"
        );
    }

    #[test]
    fn guard_local_chain_artifact_chain_id_mismatch_names_both_chains() {
        let _lock = ENV_TEST_MUTEX.lock();
        clear_env(GOV_LOCAL_ENV_KEYS);
        let _guard = EnvVarGuard::new().set("PACTO_LOCAL_CHAIN_ID", "1337");

        let err = guard_local_chain_artifact("local", |_| {
            panic!("factory liveness must not be probed after a chain id mismatch")
        })
        .expect_err("chain id mismatch must refuse");
        assert!(
            err.contains("1337") && err.contains("31337"),
            "expected both the found (1337) and expected (31337) chain ids named: {err}"
        );
    }

    #[test]
    fn guard_local_chain_artifact_dead_factory_names_the_address() {
        let _lock = ENV_TEST_MUTEX.lock();
        clear_env(GOV_LOCAL_ENV_KEYS);
        let _guard = set_valid_local_gov_env().set("PACTO_LOCAL_CHAIN_ID", "31337");

        let err = guard_local_chain_artifact("local", |_| Ok(false))
            .expect_err("dead factory must refuse");
        assert!(
            err.contains("0x1111111111111111111111111111111111111111"),
            "expected the dead factory address named: {err}"
        );
    }

    #[test]
    fn guard_local_chain_artifact_missing_field_names_the_field() {
        let _lock = ENV_TEST_MUTEX.lock();
        clear_env(GOV_LOCAL_ENV_KEYS);
        // Factory present, but masterQuartermaster absent from both the artifact
        // override and the (nonexistent) compiled `local` book entry.
        let _guard = EnvVarGuard::new()
            .set(
                "PACTO_NAVE_PIRATA_FACTORY_LOCAL",
                "0x1111111111111111111111111111111111111111",
            )
            .set("PACTO_LOCAL_CHAIN_ID", "31337");

        let err = guard_local_chain_artifact("local", |_| {
            panic!("factory liveness must not be probed when a required address is missing")
        })
        .expect_err("missing required field must refuse");
        assert!(
            err.contains("masterQuartermaster"),
            "expected the missing field named: {err}"
        );
    }

    #[test]
    fn guard_local_chain_artifact_cannot_fire_on_non_local_networks() {
        let _lock = ENV_TEST_MUTEX.lock();
        clear_env(GOV_LOCAL_ENV_KEYS);
        // A mismatched chain id would refuse on `local`; every non-local network must
        // short-circuit before either the chain id or liveness checks run.
        let _guard = EnvVarGuard::new().set("PACTO_LOCAL_CHAIN_ID", "1337");

        for net in ["sepolia", "arbitrum", "mainnet"] {
            let result = guard_local_chain_artifact(net, |_| {
                panic!("factory liveness must never be probed for a non-local network")
            });
            assert!(
                result.is_ok(),
                "guard must be a no-op for `{net}`: {result:?}"
            );
        }
    }

    static ENV_TEST_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn clear_env(keys: &[&str]) {
        for key in keys {
            std::env::remove_var(key);
        }
    }

    struct EnvVarGuard {
        _prev: Vec<(&'static str, Option<std::ffi::OsString>)>,
    }

    impl EnvVarGuard {
        fn new() -> Self {
            Self { _prev: Vec::new() }
        }
        fn set(mut self, key: &'static str, value: &str) -> Self {
            self._prev.push((key, std::env::var_os(key)));
            std::env::set_var(key, value);
            self
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            for (key, prev) in &self._prev {
                match prev {
                    Some(v) => std::env::set_var(key, v),
                    None => std::env::remove_var(key),
                }
            }
        }
    }
}
