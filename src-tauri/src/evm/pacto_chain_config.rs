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

fn resolve_optional(
    env_primary: &str,
    net_key: &str,
    book_value: Option<&str>,
) -> Option<Address> {
    env_addr_optional(env_primary, net_key).or_else(|| {
        book_value.and_then(|raw| parse_book_addr(raw).ok())
    })
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
        hats: resolve_optional(
            "PACTO_HATS",
            net_key,
            book.and_then(|b| b.hats.as_deref()),
        ),
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

#[derive(Clone, Debug)]
pub struct SquadSponsorDeployAddresses {
    pub squad_sponsor_factory: Address,
    pub pacto_sponsor_paymaster: Address,
    pub entry_point: Address,
    pub nave_pirata_registry: Option<Address>,
}

pub fn squad_sponsor_deploy_addresses(net_key: &str) -> Result<SquadSponsorDeployAddresses, String> {
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
            address!("0x3994B38f9A0Cf542241FD9C959F94386e6733D6e")
        );
        assert_eq!(
            sp.pacto_sponsor_paymaster,
            address!("0x42C76dEbCF45507532B22Ca890C9091240311bD8")
        );

        let gov = pacto_gov_deploy_addresses("sepolia").expect("gov book");
        assert_eq!(
            gov.nave_pirata_factory,
            address!("0x44E42cf7b2DadDe6D5fc27B57625EaF3e3D41316")
        );
        assert_eq!(
            gov.master_quartermaster,
            address!("0xE9C111428E23bd68C892785A6566DFc160358af1")
        );
    }

    #[test]
    fn sepolia_book_safe_bundle_overrides_legacy_defaults() {
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
}
