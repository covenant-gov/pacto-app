//! Hats-wire an existing parent Ext (`deposit` then `postInitialize`).

use alloy::network::TransactionBuilder;
use alloy::primitives::{Address, B256, U256};
use alloy::sol_types::SolCall;
use serde_json::json;
use tauri::{AppHandle, Runtime};

use super::contracts::pacto_sponsor::ISquadSponsorBase::depositCall;
use super::contracts::pacto_sponsor::ISquadSponsorExt::{
    addressOwnerCall, hatsWiredCall, postInitializeCall,
};
use super::contracts::pacto_sponsor::SquadVariant;
use super::pacto_chain_config;
use super::rpc::call::eth_call_decode;
use super::rpc::signer::{
    load_active_squad_embedded_signer, load_squad_roster_embedded_signer,
    require_roster_treasury_signing_allowed, require_treasury_signing_allowed,
};
use super::rpc::{
    connect_signing_provider, contract_call_request, send_and_confirm, wallet_err_json,
    wallet_err_json_with_tx_hash,
};
use super::squad_sponsor_common::{parse_signer_wallet, squad_variant_label};
use super::squad_sponsor_deploy::{sponsor_provider_payload, SquadSponsorDeployResult};
use super::squad_sponsor_read::read_sponsor_pool;
use super::wallet_chain_config;
use crate::db;

/// Hats-deploy view of the parent factory slot. Unwired Ext is wired, not rejected.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum HatsFactorySlot {
    Empty,
    Wire,
    Already,
}

pub(crate) fn hats_factory_slot(
    sponsor: Address,
    variant: SquadVariant,
    hats_wired: bool,
) -> HatsFactorySlot {
    if sponsor.is_zero() || matches!(variant, SquadVariant::NONE) {
        HatsFactorySlot::Empty
    } else if matches!(variant, SquadVariant::EXT) && !hats_wired {
        HatsFactorySlot::Wire
    } else {
        HatsFactorySlot::Already
    }
}

/// Skip a retry deposit when the clone pool already covers the requested amount.
pub(crate) fn should_skip_clone_deposit(spendable: U256, deposit: U256) -> bool {
    !deposit.is_zero() && spendable >= deposit
}

pub(crate) fn hats_wire_payload_extras(
    top_hat: U256,
    registry: Address,
    address_owner: Address,
) -> Vec<(&'static str, serde_json::Value)> {
    vec![
        ("topHatId", json!(top_hat.to_string())),
        ("registry", json!(format!("{:#x}", registry))),
        ("hatsWired", json!(true)),
        ("addressOwner", json!(format!("{:#x}", address_owner))),
    ]
}

/// Deposit into the existing parent Ext, then `postInitialize` onto NavePirataRegistry.
pub(crate) async fn wire_parent_ext_hats<R: Runtime>(
    app: AppHandle<R>,
    pid: &str,
    net: &wallet_chain_config::WalletNetworkConfig,
    addrs: &pacto_chain_config::SquadSponsorDeployAddresses,
    urls: &[String],
    squad_id: B256,
    sponsor: Address,
    top_hat: U256,
    registry: Address,
    deposit: U256,
    signer_wallet: Option<&str>,
) -> Result<SquadSponsorDeployResult, String> {
    require_roster_treasury_signing_allowed(app.clone(), pid).await?;
    let (roster_signer, roster_wallet) =
        load_squad_roster_embedded_signer(app.clone(), pid).await?;
    let roster_addr = roster_signer.address();

    let signer_mode = parse_signer_wallet(signer_wallet, "squad")?;
    let pay_addr;
    let pay_wallet;
    if signer_mode == "default" {
        require_treasury_signing_allowed(app.clone()).await?;
        let (pay_signer, wallet) = load_active_squad_embedded_signer(app.clone()).await?;
        pay_addr = pay_signer.address();
        pay_wallet = wallet;
        let _ = roster_signer;
    } else {
        pay_addr = roster_addr;
        pay_wallet = roster_wallet.clone();
        let _ = roster_signer;
    }

    let pay_provider = connect_signing_provider(urls, pay_wallet).await?;
    let roster_provider = if pay_addr == roster_addr {
        pay_provider.clone()
    } else {
        connect_signing_provider(urls, roster_wallet).await?
    };

    let already_wired = eth_call_decode(&roster_provider, sponsor, &hatsWiredCall {})
        .await
        .unwrap_or(false);
    if !deposit.is_zero() {
        let spendable = match read_sponsor_pool(&roster_provider, sponsor).await {
            Ok((spendable, _, _, _)) => spendable,
            Err(_) => U256::ZERO,
        };
        if !should_skip_clone_deposit(spendable, deposit) {
            let deposit_calldata = depositCall {}.abi_encode();
            send_and_confirm(
                &pay_provider,
                contract_call_request(sponsor, deposit_calldata).with_value(deposit),
                "Timed out waiting for sponsor deposit confirmation.",
            )
            .await?;
        }
    }

    let tx_hash = if already_wired {
        String::new()
    } else {
        let wire_calldata = postInitializeCall {
            topHatId: top_hat,
            registry,
            customEligibleHats: vec![],
        }
        .abi_encode();
        let wire_receipt = send_and_confirm(
            &roster_provider,
            contract_call_request(sponsor, wire_calldata),
            "Timed out waiting for hats sponsor wiring confirmation.",
        )
        .await?;
        format!("0x{:x}", wire_receipt.transaction_hash)
    };
    let sponsor_hex = format!("{:#x}", sponsor);
    let address_owner: Address = eth_call_decode(&roster_provider, sponsor, &addressOwnerCall {})
        .await
        .map_err(|e| wallet_err_json_with_tx_hash("SPONSOR_READ", e, None, tx_hash.clone()))?;
    let extras = hats_wire_payload_extras(top_hat, registry, address_owner);
    let payload = sponsor_provider_payload(
        pid,
        squad_id,
        sponsor,
        addrs.pacto_sponsor_paymaster,
        addrs.entry_point,
        squad_variant_label(SquadVariant::EXT),
        if tx_hash.is_empty() {
            None
        } else {
            Some(tx_hash.clone())
        },
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
        paymaster_address: format!("{:#x}", addrs.pacto_sponsor_paymaster),
        variant: "hats".to_string(),
        provider_payload: payload,
        infra_row_id,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        hats_factory_slot, hats_wire_payload_extras, should_skip_clone_deposit, HatsFactorySlot,
    };
    use crate::evm::contracts::pacto_sponsor::ISquadSponsorBase::depositCall;
    use crate::evm::contracts::pacto_sponsor::ISquadSponsorExt::postInitializeCall;
    use crate::evm::contracts::pacto_sponsor::SquadVariant;
    use crate::evm::squad_sponsor_common::squad_id_from_parent_id;
    use crate::evm::squad_sponsor_deploy::sponsor_provider_payload;
    use alloy::primitives::{Address, U256};
    use alloy::sol_types::SolCall;

    fn selector(signature: &str) -> [u8; 4] {
        let hash = alloy::primitives::keccak256(signature.as_bytes());
        [hash[0], hash[1], hash[2], hash[3]]
    }

    #[test]
    fn hats_factory_slot_empty_wire_or_already() {
        let sponsor = Address::repeat_byte(0x55);
        assert_eq!(
            hats_factory_slot(Address::ZERO, SquadVariant::NONE, false),
            HatsFactorySlot::Empty
        );
        assert_eq!(
            hats_factory_slot(Address::ZERO, SquadVariant::EXT, false),
            HatsFactorySlot::Empty
        );
        assert_eq!(
            hats_factory_slot(sponsor, SquadVariant::EXT, false),
            HatsFactorySlot::Wire
        );
        assert_eq!(
            hats_factory_slot(sponsor, SquadVariant::EXT, true),
            HatsFactorySlot::Already
        );
        assert_eq!(
            hats_factory_slot(sponsor, SquadVariant::SPONSOR, false),
            HatsFactorySlot::Already
        );
        assert_eq!(
            hats_factory_slot(sponsor, SquadVariant::SPONSOR, true),
            HatsFactorySlot::Already
        );
    }

    #[test]
    fn encode_post_initialize_targets_nave_pirata_registry_not_war_game() {
        let nave_pirata_registry = Address::repeat_byte(0x71);
        let war_game_registry = Address::repeat_byte(0x72);
        let encoded = postInitializeCall {
            topHatId: U256::from(42u64),
            registry: nave_pirata_registry,
            customEligibleHats: vec![],
        }
        .abi_encode();
        assert_eq!(
            &encoded[..4],
            &selector("postInitialize(uint256,address,uint256[])")
        );
        let decoded = postInitializeCall::abi_decode(&encoded).expect("decode");
        assert_eq!(decoded.topHatId, U256::from(42u64));
        assert_eq!(decoded.registry, nave_pirata_registry);
        assert_ne!(decoded.registry, war_game_registry);
        assert!(decoded.customEligibleHats.is_empty());
    }

    #[test]
    fn encode_clone_deposit_matches_selector() {
        let encoded = depositCall {}.abi_encode();
        assert_eq!(&encoded[..4], &selector("deposit()"));
        assert_eq!(encoded.len(), 4);
    }

    #[test]
    fn skip_clone_deposit_when_pool_already_covers() {
        assert!(should_skip_clone_deposit(
            U256::from(10u64),
            U256::from(10u64)
        ));
        assert!(should_skip_clone_deposit(
            U256::from(11u64),
            U256::from(10u64)
        ));
        assert!(!should_skip_clone_deposit(
            U256::from(9u64),
            U256::from(10u64)
        ));
        assert!(!should_skip_clone_deposit(U256::ZERO, U256::from(10u64)));
        assert!(!should_skip_clone_deposit(U256::from(10u64), U256::ZERO));
    }

    #[test]
    fn wire_payload_carries_top_hat_registry_and_hats_wired() {
        let nave = Address::repeat_byte(0x71);
        let owner = Address::repeat_byte(0x44);
        let extras = hats_wire_payload_extras(U256::from(42u64), nave, owner);
        let payload = sponsor_provider_payload(
            "squad-alpha",
            squad_id_from_parent_id("squad-alpha"),
            Address::repeat_byte(0x11),
            Address::repeat_byte(0x22),
            Address::repeat_byte(0x33),
            "ext",
            Some("0xwire".to_string()),
            &extras,
        );
        let v: serde_json::Value = serde_json::from_str(&payload).expect("json");
        assert_eq!(v.get("variant").and_then(|c| c.as_str()), Some("ext"));
        assert_eq!(v.get("topHatId").and_then(|c| c.as_str()), Some("42"));
        assert_eq!(
            v.get("registry").and_then(|c| c.as_str()),
            Some(format!("{:#x}", nave).as_str())
        );
        assert_eq!(v.get("hatsWired").and_then(|c| c.as_bool()), Some(true));
        assert_eq!(
            v.get("addressOwner").and_then(|c| c.as_str()),
            Some(format!("{:#x}", owner).as_str())
        );
        assert_eq!(v.get("txHash").and_then(|c| c.as_str()), Some("0xwire"));
    }
}
