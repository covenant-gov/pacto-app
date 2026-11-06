//! Publish and restore username claim link events (kind 31337) on trusted relays.

use alloy::primitives::{Address, B256, U256};
use nostr_sdk::prelude::*;

use super::nostr_claim_link::PACTO_USERNAME_CLAIM_KIND;
use super::rpc::parse_address;
use crate::get_nostr_client;
use crate::nostr_sign;
use crate::nostr_tags;

const CLAIM_LINK_FETCH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);

/// Publish a replaceable username claim link event; returns event id hex.
pub async fn publish_username_claim_link(
    keys: &Keys,
    username: &str,
    evm_address: Address,
    npub_hash: B256,
    nonce: U256,
    issued_at: U256,
    salt: B256,
) -> Result<String, String> {
    let evm_checksum = evm_address.to_checksum(None);
    let npub_hash_hex = format!("{npub_hash:#x}");
    let salt_hex = format!("{salt:#x}");
    let nonce_s = nonce.to_string();
    let issued_s = issued_at.to_string();

    let builder = EventBuilder::new(Kind::from_u16(PACTO_USERNAME_CLAIM_KIND), username)
        .tag(nostr_tags::custom_tag("name", [username]))
        .tag(nostr_tags::custom_tag("evm", [evm_checksum.as_str()]))
        .tag(nostr_tags::custom_tag(
            "npub-hash",
            [npub_hash_hex.as_str()],
        ))
        .tag(nostr_tags::custom_tag("nonce", [nonce_s.as_str()]))
        .tag(nostr_tags::custom_tag("issued-at", [issued_s.as_str()]))
        .tag(nostr_tags::custom_tag("salt", [salt_hex.as_str()]))
        .tag(nostr_tags::d_tag([npub_hash_hex.as_str()]));

    let event = nostr_sign::sign_with(builder, keys)?;
    let event_id = event.id.to_hex();

    let client = get_nostr_client()?;
    let pool = client.relays().await;
    let targets = crate::trusted_relays::trusted_relays_in_pool(&pool);
    if targets.is_empty() {
        return Err("no trusted relays available in the relay pool".to_string());
    }
    let send_output = client
        .send_event_to(targets, &event)
        .await
        .map_err(|e| format!("failed to publish username claim link: {e}"))?;
    crate::cmds::relays::record_send_outcome(&event, &send_output);

    Ok(event_id)
}

/// Best-effort read of the addressable kind 31337 link. `None` on relay or client failure.
pub async fn fetch_username_claim_link_id(
    keys: &Keys,
    npub_hash: B256,
    name: &str,
    evm_address: Address,
) -> Option<String> {
    let client = match get_nostr_client() {
        Ok(client) => client,
        Err(e) => {
            log::warn!(
                target: "pacto_wallet",
                "username claim link fetch skipped: {e}"
            );
            return None;
        }
    };
    let pool = client.relays().await;
    let targets = crate::trusted_relays::trusted_relays_in_pool(&pool);
    if targets.is_empty() {
        log::warn!(
            target: "pacto_wallet",
            "username claim link fetch skipped: no trusted relays in pool"
        );
        return None;
    }
    let filter = username_claim_link_filter(keys.public_key(), npub_hash);
    let events = match client
        .fetch_events_from(targets, filter, CLAIM_LINK_FETCH_TIMEOUT)
        .await
    {
        Ok(events) => events,
        Err(e) => {
            log::warn!(
                target: "pacto_wallet",
                "username claim link fetch failed: {e}"
            );
            return None;
        }
    };
    let events: Vec<Event> = events.into_iter().collect();
    resolve_username_claim_link_from_events(&events, keys, npub_hash, name, evm_address)
}

/// Addressable kind 31337 query: author + `#d` = npub hash.
pub fn username_claim_link_filter(author: PublicKey, npub_hash: B256) -> Filter {
    Filter::new()
        .kind(Kind::from_u16(PACTO_USERNAME_CLAIM_KIND))
        .author(author)
        .identifier(format!("{npub_hash:#x}"))
}

/// Selector over already-fetched events. Same match rules as restore.
pub fn resolve_username_claim_link_from_events(
    events: &[Event],
    keys: &Keys,
    npub_hash: B256,
    name: &str,
    evm_address: Address,
) -> Option<String> {
    select_username_claim_link(
        events,
        &keys.public_key(),
        name,
        &format!("{npub_hash:#x}"),
        evm_address,
    )
}

/// Event id whose author and `name` / `evm` / `npub-hash` tags match the chain record.
/// Newest `created_at` wins when more than one event matches. `None` means do not write.
pub fn select_username_claim_link(
    events: &[Event],
    author: &PublicKey,
    name: &str,
    npub_hash_hex: &str,
    evm_address: Address,
) -> Option<String> {
    let expected_name = name.trim();
    if expected_name.is_empty() {
        return None;
    }
    let mut best: Option<&Event> = None;
    for event in events {
        if event.kind != Kind::from_u16(PACTO_USERNAME_CLAIM_KIND) || &event.pubkey != author {
            continue;
        }
        let Some(tag_name) = nostr_tags::custom_content(&event.tags, "name") else {
            continue;
        };
        if tag_name.trim() != expected_name {
            continue;
        }
        let Some(tag_hash) = nostr_tags::custom_content(&event.tags, "npub-hash") else {
            continue;
        };
        if !hex_body_eq(tag_hash, npub_hash_hex) {
            continue;
        }
        let Some(tag_evm) = nostr_tags::custom_content(&event.tags, "evm") else {
            continue;
        };
        if parse_address(tag_evm.trim()).ok() != Some(evm_address) {
            continue;
        }
        match best {
            Some(current) if event.created_at <= current.created_at => {}
            _ => best = Some(event),
        }
    }
    best.map(|event| event.id.to_hex())
}

fn hex_body_eq(left: &str, right: &str) -> bool {
    fn body(value: &str) -> String {
        let trimmed = value.trim();
        let bare = trimmed
            .strip_prefix("0x")
            .or_else(|| trimmed.strip_prefix("0X"))
            .unwrap_or(trimmed);
        bare.to_ascii_lowercase()
    }
    let left = body(left);
    let right = body(right);
    !left.is_empty() && left == right
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::address;
    use std::str::FromStr;

    const HASH: &str = "0x540d126644e922328318f1870ba0c9de3b2d5c0c271e27af7efea3e44025fdc1";

    fn link_event(
        keys: &Keys,
        name: &str,
        evm: Address,
        npub_hash_hex: &str,
        created_at: u64,
    ) -> Event {
        let evm_tag = evm.to_checksum(None);
        signed_link(keys, name, &evm_tag, npub_hash_hex, created_at)
    }

    fn signed_link(
        keys: &Keys,
        name: &str,
        evm_tag: &str,
        npub_hash_hex: &str,
        created_at: u64,
    ) -> Event {
        let builder = EventBuilder::new(Kind::from_u16(PACTO_USERNAME_CLAIM_KIND), name)
            .tag(nostr_tags::custom_tag("name", [name]))
            .tag(nostr_tags::custom_tag("evm", [evm_tag]))
            .tag(nostr_tags::custom_tag("npub-hash", [npub_hash_hex]))
            .tag(nostr_tags::d_tag([npub_hash_hex]))
            .custom_created_at(Timestamp::from(created_at));
        nostr_sign::sign_with(builder, keys).expect("sign link")
    }

    #[test]
    fn select_returns_matching_event_id() {
        let keys = Keys::generate();
        let evm = address!("0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7");
        let event = link_event(&keys, "daopunk", evm, HASH, 100);
        let id = select_username_claim_link(
            &[event.clone()],
            &keys.public_key(),
            " daopunk ",
            HASH,
            evm,
        );
        assert_eq!(id.as_deref(), Some(event.id.to_hex().as_str()));
    }

    #[test]
    fn select_accepts_lowercase_evm_tag() {
        let keys = Keys::generate();
        let evm = address!("0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7");
        let event = signed_link(
            &keys,
            "daopunk",
            "0xe05fcc23807536bee418f142d19fa0d21bb0cff7",
            &HASH.to_ascii_uppercase(),
            100,
        );
        let id =
            select_username_claim_link(&[event.clone()], &keys.public_key(), "daopunk", HASH, evm);
        assert_eq!(id.as_deref(), Some(event.id.to_hex().as_str()));
    }

    #[test]
    fn select_rejects_wrong_author_name_hash_or_evm() {
        let keys = Keys::generate();
        let other = Keys::generate();
        let evm = address!("0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7");
        let other_evm = address!("0x1111111111111111111111111111111111111111");
        let wrong_author = link_event(&other, "daopunk", evm, HASH, 100);
        let wrong_name = link_event(&keys, "other", evm, HASH, 100);
        let wrong_hash = link_event(
            &keys,
            "daopunk",
            evm,
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            100,
        );
        let wrong_evm = link_event(&keys, "daopunk", other_evm, HASH, 100);
        for event in [wrong_author, wrong_name, wrong_hash, wrong_evm] {
            assert!(
                select_username_claim_link(&[event], &keys.public_key(), "daopunk", HASH, evm)
                    .is_none()
            );
        }
    }

    #[test]
    fn select_prefers_event_whose_evm_matches_record() {
        let keys = Keys::generate();
        let previous = address!("0x1111111111111111111111111111111111111111");
        let current = address!("0x2222222222222222222222222222222222222222");
        let older_address = link_event(&keys, "daopunk", previous, HASH, 500);
        let matching = link_event(&keys, "daopunk", current, HASH, 100);
        let id = select_username_claim_link(
            &[older_address, matching.clone()],
            &keys.public_key(),
            "daopunk",
            HASH,
            current,
        );
        assert_eq!(id.as_deref(), Some(matching.id.to_hex().as_str()));
    }

    #[test]
    fn select_keeps_newest_when_several_evm_tags_match() {
        let keys = Keys::generate();
        let evm = address!("0x2222222222222222222222222222222222222222");
        let older = link_event(&keys, "daopunk", evm, HASH, 100);
        let newer = link_event(&keys, "daopunk", evm, HASH, 200);
        let id = select_username_claim_link(
            &[older, newer.clone()],
            &keys.public_key(),
            "daopunk",
            HASH,
            evm,
        );
        assert_eq!(id.as_deref(), Some(newer.id.to_hex().as_str()));
    }

    fn hash_b256() -> B256 {
        B256::from_str(HASH).expect("hash")
    }

    #[test]
    fn filter_matches_published_link_event() {
        let keys = Keys::generate();
        let other = Keys::generate();
        let evm = address!("0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7");
        let filter = username_claim_link_filter(keys.public_key(), hash_b256());
        let matching = link_event(&keys, "daopunk", evm, HASH, 100);
        let wrong_author = link_event(&other, "daopunk", evm, HASH, 100);
        let wrong_d = link_event(
            &keys,
            "daopunk",
            evm,
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            100,
        );
        assert!(filter.match_event(&matching, MatchEventOptions::default()));
        assert!(!filter.match_event(&wrong_author, MatchEventOptions::default()));
        assert!(!filter.match_event(&wrong_d, MatchEventOptions::default()));
    }

    #[test]
    fn fetch_pipeline_resolves_id_from_matched_events() {
        let keys = Keys::generate();
        let evm = address!("0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7");
        let event = link_event(&keys, "daopunk", evm, HASH, 100);
        let id = resolve_username_claim_link_from_events(
            &[event.clone()],
            &keys,
            hash_b256(),
            "daopunk",
            evm,
        );
        assert_eq!(id.as_deref(), Some(event.id.to_hex().as_str()));
    }
}
