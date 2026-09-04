//! Profile sync queueing commands plus the Guy Fawkes Day badge check.
use crate::{get_nostr_client, profile_sync, trusted_relays};
use nostr_sdk::prelude::*;

// Guy Fawkes Day 2025 - V for Vector Badge (Event Ended)
pub(crate) const FAWKES_DAY_START: u64 = 1762300800; // 2025-11-05 00:00:00 UTC

pub(crate) const FAWKES_DAY_END: u64 = 1762387200; // 2025-11-06 00:00:00 UTC

/// Check if a user has the Guy Fawkes Day badge
/// Verifies they have a valid badge claim event from the November 5, 2025 event
#[tauri::command]
pub(crate) async fn check_fawkes_badge(npub: String) -> Result<bool, String> {
    let client = get_nostr_client().map_err(|_| "Nostr client not initialized")?;

    // Convert npub to PublicKey
    let user_pubkey = PublicKey::from_bech32(&npub).map_err(|e| e.to_string())?;

    // Fetch the user's badge claim event
    let filter = Filter::new()
        .author(user_pubkey)
        .kind(Kind::ApplicationSpecificData)
        .custom_tag(SingleLetterTag::lowercase(Alphabet::D), "fawkes_2025")
        .limit(10);

    let mut events = client
        .stream_events_from(
            trusted_relays::trusted_relays().to_vec(),
            filter,
            std::time::Duration::from_secs(10),
        )
        .await
        .map_err(|e| e.to_string())?;

    // Check if they have a valid badge claim from the event period
    while let Some(event) = events.next().await {
        if event.content == "fawkes_badge_claimed" {
            let timestamp = event.created_at.as_secs();
            // Verify the timestamp is within the valid event window
            if timestamp >= FAWKES_DAY_START && timestamp < FAWKES_DAY_END {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

#[tauri::command]
pub(crate) async fn queue_profile_sync(
    npub: String,
    priority: String,
    force_refresh: bool,
) -> Result<(), String> {
    let sync_priority = match priority.as_str() {
        "critical" => profile_sync::SyncPriority::Critical,
        "high" => profile_sync::SyncPriority::High,
        "medium" => profile_sync::SyncPriority::Medium,
        "low" => profile_sync::SyncPriority::Low,
        _ => return Err(format!("Invalid priority: {}", priority)),
    };

    profile_sync::queue_profile_sync(npub, sync_priority, force_refresh).await;
    Ok(())
}

#[tauri::command]
pub(crate) async fn queue_chat_profiles_sync(
    chat_id: String,
    is_opening: bool,
) -> Result<(), String> {
    profile_sync::queue_chat_profiles(chat_id, is_opening).await;
    Ok(())
}

#[tauri::command]
pub(crate) async fn refresh_profile_now(npub: String) -> Result<(), String> {
    profile_sync::refresh_profile_now(npub).await;
    Ok(())
}

#[tauri::command]
pub(crate) async fn sync_all_profiles() -> Result<(), String> {
    profile_sync::sync_all_profiles().await;
    Ok(())
}
