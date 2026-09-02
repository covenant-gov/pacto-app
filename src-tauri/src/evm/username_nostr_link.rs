//! Publish username claim link events (kind 31337) to trusted relays.

use alloy::primitives::{Address, B256, U256};
use nostr_sdk::prelude::*;

use super::nostr_claim_link::PACTO_USERNAME_CLAIM_KIND;
use crate::get_nostr_client;
use crate::nostr_sign;
use crate::nostr_tags;

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

    let builder = EventBuilder::new(
        Kind::from_u16(PACTO_USERNAME_CLAIM_KIND),
        username,
    )
    .tag(nostr_tags::custom_tag("name", [username]))
    .tag(nostr_tags::custom_tag("evm", [evm_checksum.as_str()]))
    .tag(nostr_tags::custom_tag("npub-hash", [npub_hash_hex.as_str()]))
    .tag(nostr_tags::custom_tag("nonce", [nonce_s.as_str()]))
    .tag(nostr_tags::custom_tag("issued-at", [issued_s.as_str()]))
    .tag(nostr_tags::custom_tag("salt", [salt_hex.as_str()]))
    .tag(nostr_tags::d_tag([npub_hash_hex.as_str()]));

    let event = nostr_sign::sign_with(builder, keys)?;
    let event_id = event.id.to_hex();

    let client = get_nostr_client()?;
    let send_output = client
        .send_event_to(
            crate::trusted_relays::trusted_relays().iter().cloned(),
            &event,
        )
        .await
        .map_err(|e| format!("failed to publish username claim link: {e}"))?;
    crate::cmds::relays::record_send_outcome(&event, &send_output);

    Ok(event_id)
}
