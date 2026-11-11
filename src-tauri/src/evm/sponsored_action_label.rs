//! Selector → name for sponsored fee ledgers. Catalog: `sponsored-actions.json`.

use once_cell::sync::Lazy;
use serde::Deserialize;
use std::collections::HashMap;

const EMBEDDED_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../src/lib/evm/sponsor/sponsored-actions.json"
));

#[derive(Debug, Deserialize)]
struct CatalogEntry {
    name: String,
    selector: String,
}

static BY_SELECTOR: Lazy<HashMap<[u8; 4], String>> = Lazy::new(load_catalog);

fn load_catalog() -> HashMap<[u8; 4], String> {
    let entries: Vec<CatalogEntry> =
        serde_json::from_str(EMBEDDED_JSON).expect("sponsored-actions.json");
    let mut map = HashMap::with_capacity(entries.len());
    for entry in entries {
        let body = entry
            .selector
            .trim()
            .strip_prefix("0x")
            .unwrap_or(entry.selector.trim());
        let bytes = hex::decode(body)
            .unwrap_or_else(|_| panic!("sponsored action {} has a non-hex selector", entry.name));
        let selector: [u8; 4] = bytes
            .as_slice()
            .try_into()
            .unwrap_or_else(|_| panic!("sponsored action {} selector is not 4 bytes", entry.name));
        if map.insert(selector, entry.name.clone()).is_some() {
            panic!("duplicate sponsored selector for {}", entry.name);
        }
    }
    map
}

fn calldata_selector_hex(calldata: &[u8]) -> String {
    if calldata.len() >= 4 {
        format!("0x{}", hex::encode(&calldata[..4]))
    } else {
        "0x".to_string()
    }
}

/// `(selector hex, action name)`. Unknown selectors use the hex as the name.
pub(crate) fn sponsored_action_label(calldata: &[u8]) -> (String, String) {
    let selector = calldata_selector_hex(calldata);
    if calldata.len() < 4 {
        return (selector.clone(), selector);
    }
    let key: [u8; 4] = calldata[..4].try_into().unwrap();
    match BY_SELECTOR.get(&key) {
        Some(name) => (selector, name.clone()),
        None => (selector.clone(), selector),
    }
}

#[cfg(test)]
mod tests {
    use super::{sponsored_action_label, CatalogEntry, EMBEDDED_JSON};
    use crate::evm::contracts::pacto_gov::read_bindings::IMutinyModule::{
        captainResignCall, castVoteCall, executeMutinyCall, expireMutinyCall,
        startMutinyToArbitraryContractCall, startMutinyToArbitraryEoaCall,
        startMutinyToCommitteeCall, startMutinyToCrewMemberCall, startMutinyToPauseCaptainCall,
    };
    use crate::evm::contracts::pacto_gov::read_bindings::IQuartermaster::{
        bootstrapCrewCall, cancelAddCrewCall, cancelRemoveCrewCall, crewOffboardVoteCall,
        executeAddCrewCall, executeOffboardCall, executeRemoveCrewCall, expireOffboardCall,
        proposeOffboardCall, requestAddCrewCall, requestRemoveCrewCall,
    };
    use crate::evm::contracts::pacto_gov::read_bindings::ISquadAdminBase::{
        createRoleCall, disableExecutorCall, enableExecutorCall, enableFullPermissionCall,
    };
    use crate::evm::contracts::pacto_gov::read_bindings::ITreasuryAuthority::{
        captainVoteCall, crewVoteCall, executeCall, proposeCall,
    };
    use crate::evm::contracts::pacto_gov::INavePirataFactory::{
        deployNavePirataCall, deploySquadAdminExtStandaloneCall,
        deploySquadAdminStandaloneCaptainHatCall,
    };
    use crate::evm::contracts::pacto_sponsor::ISquadSponsorFactory::{
        createSquadSponsorCall, createSquadSponsorExtCall, createWarGameSponsorCall,
    };
    use crate::evm::contracts::pacto_username::IPactoUsernameNFT::{
        cancelAddressTransferCall, claimAddressTransferCall, claimCall, initiateAddressTransferCall,
    };
    use crate::evm::contracts::safe::GnosisSafeProxyFactory::createProxyWithNonceCall;
    use alloy::primitives::U256;
    use alloy::sol_types::SolCall;
    use std::collections::{HashMap, HashSet};

    fn sponsored_calls() -> Vec<(&'static str, [u8; 4])> {
        vec![
            ("propose", proposeCall::SELECTOR),
            ("crewVote", crewVoteCall::SELECTOR),
            ("captainVote", captainVoteCall::SELECTOR),
            ("execute", executeCall::SELECTOR),
            ("castVote", castVoteCall::SELECTOR),
            ("executeMutiny", executeMutinyCall::SELECTOR),
            ("captainResign", captainResignCall::SELECTOR),
            (
                "startMutinyToCrewMember",
                startMutinyToCrewMemberCall::SELECTOR,
            ),
            (
                "startMutinyToCommittee",
                startMutinyToCommitteeCall::SELECTOR,
            ),
            (
                "startMutinyToArbitraryEoa",
                startMutinyToArbitraryEoaCall::SELECTOR,
            ),
            (
                "startMutinyToArbitraryContract",
                startMutinyToArbitraryContractCall::SELECTOR,
            ),
            (
                "startMutinyToPauseCaptain",
                startMutinyToPauseCaptainCall::SELECTOR,
            ),
            ("bootstrapCrew", bootstrapCrewCall::SELECTOR),
            ("requestAddCrew", requestAddCrewCall::SELECTOR),
            ("cancelAddCrew", cancelAddCrewCall::SELECTOR),
            ("executeAddCrew", executeAddCrewCall::SELECTOR),
            ("requestRemoveCrew", requestRemoveCrewCall::SELECTOR),
            ("cancelRemoveCrew", cancelRemoveCrewCall::SELECTOR),
            ("executeRemoveCrew", executeRemoveCrewCall::SELECTOR),
            ("expireMutiny", expireMutinyCall::SELECTOR),
            ("proposeOffboard", proposeOffboardCall::SELECTOR),
            ("crewOffboardVote", crewOffboardVoteCall::SELECTOR),
            ("executeOffboard", executeOffboardCall::SELECTOR),
            ("expireOffboard", expireOffboardCall::SELECTOR),
            ("claimUsername", claimCall::SELECTOR),
            (
                "initiateAddressTransfer",
                initiateAddressTransferCall::SELECTOR,
            ),
            ("claimAddressTransfer", claimAddressTransferCall::SELECTOR),
            ("cancelAddressTransfer", cancelAddressTransferCall::SELECTOR),
            ("deployNavePirata", deployNavePirataCall::SELECTOR),
            ("createSquadSponsorExt", createSquadSponsorExtCall::SELECTOR),
            ("createSquadSponsor", createSquadSponsorCall::SELECTOR),
            ("createWarGameSponsor", createWarGameSponsorCall::SELECTOR),
            (
                "deploySquadAdminExtStandalone",
                deploySquadAdminExtStandaloneCall::SELECTOR,
            ),
            (
                "deploySquadAdminStandaloneCaptainHat",
                deploySquadAdminStandaloneCaptainHatCall::SELECTOR,
            ),
            ("createSafeProxy", createProxyWithNonceCall::SELECTOR),
            ("createRole", createRoleCall::SELECTOR),
            ("enableExecutor", enableExecutorCall::SELECTOR),
            ("disableExecutor", disableExecutorCall::SELECTOR),
            ("enableFullPermission", enableFullPermissionCall::SELECTOR),
        ]
    }

    #[test]
    fn catalog_matches_alloy_selectors() {
        let entries: Vec<CatalogEntry> = serde_json::from_str(EMBEDDED_JSON).unwrap();
        let expected = sponsored_calls();
        let expected_names: HashSet<&str> = expected.iter().map(|(name, _)| *name).collect();
        assert_eq!(
            expected.len(),
            expected_names.len(),
            "duplicate expected name"
        );
        assert_eq!(entries.len(), expected.len(), "catalog size");

        let mut by_name: HashMap<&str, &str> = HashMap::new();
        for entry in &entries {
            assert!(
                by_name
                    .insert(entry.name.as_str(), entry.selector.as_str())
                    .is_none(),
                "duplicate catalog name {}",
                entry.name
            );
        }
        for name in by_name.keys() {
            assert!(
                expected_names.contains(name),
                "unexpected catalog name {name}"
            );
        }

        for (name, selector) in &expected {
            let hex = format!("0x{}", hex::encode(selector));
            assert_eq!(
                by_name.get(name).map(|value| value.to_lowercase()),
                Some(hex.clone()),
                "{name}"
            );
            let (labeled_sel, labeled_name) = sponsored_action_label(selector);
            assert_eq!(labeled_name, *name);
            assert_eq!(labeled_sel, hex);
        }
    }

    #[test]
    fn factory_and_unlabeled_gov_calls_are_named() {
        assert_eq!(
            sponsored_action_label(&deployNavePirataCall::SELECTOR).1,
            "deployNavePirata"
        );
        assert_eq!(
            sponsored_action_label(&createWarGameSponsorCall::SELECTOR).1,
            "createWarGameSponsor"
        );
        assert_eq!(
            sponsored_action_label(&expireMutinyCall::SELECTOR).1,
            "expireMutiny"
        );
        assert_eq!(
            sponsored_action_label(&proposeOffboardCall::SELECTOR).1,
            "proposeOffboard"
        );
    }

    #[test]
    fn labels_full_calldata() {
        let vote = castVoteCall {
            _mutinyId: U256::from(1u64),
        }
        .abi_encode();
        let (sel, name) = sponsored_action_label(&vote);
        assert_eq!(name, "castVote");
        assert_eq!(sel, format!("0x{}", hex::encode(castVoteCall::SELECTOR)));

        let boot = bootstrapCrewCall {
            _candidates: vec![],
        }
        .abi_encode();
        assert_eq!(sponsored_action_label(&boot).1, "bootstrapCrew");
    }

    #[test]
    fn unknown_or_short_calldata_stays_hex() {
        let unknown = [0xaa, 0xbb, 0xcc, 0xdd];
        let (sel, name) = sponsored_action_label(&unknown);
        assert_eq!(sel, "0xaabbccdd");
        assert_eq!(name, "0xaabbccdd");

        let (sel, name) = sponsored_action_label(&[0xaa, 0xbb]);
        assert_eq!(sel, "0x");
        assert_eq!(name, "0x");
    }
}
