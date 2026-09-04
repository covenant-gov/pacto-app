//! MLS group commands: create/invite/remove members, welcomes, sync, and group metadata.
use crate::{
    db, get_nostr_client, handle_event_guarded, mls, mls_store_reset_state, notification,
    require_key_derivation_version_2, session, trusted_relays, MlsService, NotificationLevel,
    STATE, TAURI_APP,
};
use nostr_sdk::prelude::*;

use rand::distributions::Alphanumeric;
use rand::{thread_rng, Rng};
use tauri::{AppHandle, Emitter, Runtime};

/// Re-apply governance/treasury/roster automation side effects from persisted MLS chat rows.
#[tauri::command]
pub(crate) async fn replay_mls_automation_side_effects<R: Runtime>(
    handle: AppHandle<R>,
    chat_id: String,
) -> Result<u32, String> {
    db::replay_automation_side_effects_for_chat(&handle, chat_id.trim()).await
}

/// Regenerate this device's MLS KeyPackage. If `cache` is true, attempt to reuse an existing
/// cached KeyPackage if it exists on the relay; otherwise always generate a fresh one.
/// Load MLS device ID for the current account
#[tauri::command]
pub(crate) async fn load_mls_device_id() -> Result<Option<String>, String> {
    let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
    match db::load_mls_device_id(&handle).await {
        Ok(Some(id)) => Ok(Some(id)),
        Ok(None) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Load MLS keypackages for the current account
#[tauri::command]
pub(crate) async fn load_mls_keypackages() -> Result<Vec<serde_json::Value>, String> {
    let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
    db::load_mls_keypackages(&handle)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn regenerate_device_keypackage(cache: bool) -> Result<serde_json::Value, String> {
    // Access handle and client
    let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
    crate::migration::require_key_derivation_version_2_on_handle(&handle)?;
    let client = get_nostr_client().map_err(|_| "Nostr client not initialized")?;

    // Ensure a persistent device_id exists
    let device_id: String = match db::load_mls_device_id(&handle).await {
        Ok(Some(id)) => id,
        _ => {
            let id: String = thread_rng()
                .sample_iter(&Alphanumeric)
                .take(12)
                .map(char::from)
                .collect::<String>()
                .to_lowercase();
            let _ = db::save_mls_device_id(handle.clone(), &id).await;
            id
        }
    };

    // Resolve my pubkey (awaits before any MLS engine is created)
    let signer = client.signer().await.map_err(|e| e.to_string())?;
    let my_pubkey = signer.get_public_key().await.map_err(|e| e.to_string())?;
    let owner_pubkey_b32 = my_pubkey.to_bech32().map_err(|e| e.to_string())?;

    // Opening the service runs legacy-store detection before cache lookup. A reset
    // invalidates the private init key behind the previously published KeyPackage,
    // so cached relay state must not short-circuit fresh publication.
    drop(MlsService::new_persistent_for_keypackage_refresh(&handle).map_err(|e| e.to_string())?);
    let force_refresh = mls_store_reset_state::keypackage_refresh_required(&handle)?;
    let cache = cache && !force_refresh;

    // Ensure we're connected to the trusted relay set (needed for both cache verification and publishing)
    for relay_url in trusted_relays::trusted_relays().iter() {
        // Check if relay is in the pool
        if !client.relays().await.contains_key(relay_url) {
            println!(
                "[MLS][KeyPackage] Adding trusted relay to pool: {}",
                relay_url
            );
            client
                .add_relay(relay_url.clone())
                .await
                .map_err(|e| e.to_string())?;
        }

        // Connect with timeout if not already connected
        match client.relay(relay_url.clone()).await {
            Ok(relay_instance) => {
                if !relay_instance.is_connected() {
                    println!(
                        "[MLS][KeyPackage] Connecting to trusted relay: {}",
                        relay_url
                    );
                    let _ = client.connect_relay(relay_url.clone()).await;
                    // Give it time to connect
                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                }
            }
            Err(_) => {
                // Relay not in pool, add and connect
                println!(
                    "[MLS][KeyPackage] Adding and connecting to trusted relay: {}",
                    relay_url
                );
                let _ = client.add_relay(relay_url.clone()).await;
                let _ = client.connect_relay(relay_url.clone()).await;
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
            }
        }
    }

    // If caching is requested, attempt to load and verify an existing KeyPackage. Dual
    // publish mints two event ids from the same content — a 30443 (spec, primary) and a
    // 443 (legacy, secondary) — so both must independently still verify before the cache
    // is trusted. An entry recorded before this feature shipped has no secondary ref and
    // falls through to republish, which is how it picks up 30443 coverage.
    if cache {
        let cached_entry: Option<serde_json::Value> = {
            let index = db::load_mls_keypackages(&handle).await.unwrap_or_default();
            index.into_iter().find(|entry| {
                entry.get("owner_pubkey").and_then(|v| v.as_str())
                    == Some(owner_pubkey_b32.as_str())
                    && entry.get("device_id").and_then(|v| v.as_str()) == Some(device_id.as_str())
            })
        };

        if let Some(entry) = cached_entry {
            let primary_ref = entry
                .get("keypackage_ref")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let secondary_ref = entry
                .get("keypackage_ref_secondary")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            if let (Some(primary_hex), Some(secondary_hex)) =
                (primary_ref.as_deref(), secondary_ref.as_deref())
            {
                println!(
                    "[MLS][KeyPackage] Found cached references (30443={}, 443={}), verifying on relay...",
                    primary_hex, secondary_hex
                );
                // Short-circuit: the secondary ref's verdict cannot change the outcome once
                // the primary has already failed, and each check is a relay round trip plus
                // an MLS store open.
                match keypackage_ref_still_usable(&client, &handle, primary_hex).await {
                    Ok(()) => match keypackage_ref_still_usable(&client, &handle, secondary_hex).await {
                        Ok(()) => {
                            return Ok(serde_json::json!({
                                "device_id": device_id,
                                "owner_pubkey": owner_pubkey_b32,
                                "keypackage_ref": primary_hex,
                                "keypackage_ref_secondary": secondary_hex,
                                "cached": true
                            }));
                        }
                        Err(e) => eprintln!(
                            "[MLS][KeyPackage] Cached 443 reference {} no longer usable ({}); republishing",
                            secondary_hex, e
                        ),
                    },
                    Err(e) => eprintln!(
                        "[MLS][KeyPackage] Cached 30443 reference {} no longer usable ({}); republishing",
                        primary_hex, e
                    ),
                }
            } else {
                println!(
                    "[MLS][KeyPackage] Cached entry missing dual-kind (30443+443) coverage; republishing"
                );
            }
        }
    }

    // Reuse this device's addressable (kind 30443) `d` tag across rotations — NIP-33
    // replacement only fires when successive publishes share the same (kind, pubkey, d)
    // tuple, so a fresh random `d` every rotation would leave every past KeyPackage this
    // device ever published live and addressable on the relay forever.
    let existing_d_tag: Option<String> = db::load_mls_keypackages(&handle)
        .await
        .unwrap_or_default()
        .into_iter()
        .find(|entry| {
            entry.get("owner_pubkey").and_then(|v| v.as_str()) == Some(owner_pubkey_b32.as_str())
                && entry.get("device_id").and_then(|v| v.as_str()) == Some(device_id.as_str())
        })
        .and_then(|entry| {
            entry
                .get("keypackage_d_tag")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        });

    // Create device KeyPackage using persistent MLS engine inside a no-await scope
    let kp_data = {
        let mls_service = MlsService::new_persistent_for_keypackage_refresh(&handle)
            .map_err(|e| e.to_string())?;
        let engine = mls_service.engine().map_err(|e| e.to_string())?;
        let relay_urls: Vec<nostr_sdk::RelayUrl> = trusted_relays::trusted_relays().to_vec();
        engine
            .create_key_package_for_event(&my_pubkey, relay_urls)
            .map_err(|e| e.to_string())?
    }; // engine and mls_service dropped here before any await

    let d_tag = existing_d_tag.unwrap_or_else(|| kp_data.d_tag.clone());
    let mut tags_30443 = kp_data.tags_30443;
    if let Some(pos) = tags_30443.iter().position(|t| t.kind() == TagKind::d()) {
        tags_30443[pos] = Tag::identifier(&d_tag);
    }

    // Sign and publish both the spec (30443, addressable) and legacy (443) events from the
    // same KeyPackage content, so clients that still only understand 443 and clients that
    // already require 30443 can both resolve this device. Both events share one timestamp
    // so `mls::sort_keypackage_candidates`'s "prefer 30443 on a tie" actually applies —
    // signed separately, they would otherwise straddle a second boundary and let the
    // legacy event's later timestamp win instead.
    let published_at = Timestamp::now();
    let kp_event_30443 = client
        .sign_event_builder(
            EventBuilder::new(mls::MLS_KEY_PACKAGE_KIND_30443, kp_data.content.clone())
                .tags(tags_30443)
                .custom_created_at(published_at),
        )
        .await
        .map_err(|e| e.to_string())?;
    let kp_event_443 = client
        .sign_event_builder(
            EventBuilder::new(mls::MLS_KEY_PACKAGE_KIND_LEGACY, kp_data.content)
                .tags(kp_data.tags_443)
                .custom_created_at(published_at),
        )
        .await
        .map_err(|e| e.to_string())?;

    // Publish both to the trusted relay set. A publish every relay rejects must not be
    // cached as if it succeeded — the cache check above requires both refs to
    // independently verify, so caching an id no relay holds would just force every future
    // call to republish anyway, without ever telling the caller why.
    let send_output_30443 = client
        .send_event_to(
            trusted_relays::trusted_relays().iter().cloned(),
            &kp_event_30443,
        )
        .await
        .map_err(|e| e.to_string())?;
    crate::cmds::relays::record_send_outcome(&kp_event_30443, &send_output_30443);
    if send_output_30443.success.is_empty() {
        return Err(format!(
            "No trusted relay accepted the kind 30443 KeyPackage: {:?}",
            send_output_30443.failed
        ));
    }
    let send_output_443 = client
        .send_event_to(
            trusted_relays::trusted_relays().iter().cloned(),
            &kp_event_443,
        )
        .await
        .map_err(|e| e.to_string())?;
    crate::cmds::relays::record_send_outcome(&kp_event_443, &send_output_443);
    if send_output_443.success.is_empty() {
        return Err(format!(
            "No trusted relay accepted the legacy 443 KeyPackage: {:?}",
            send_output_443.failed
        ));
    }

    // Upsert into mls_keypackage_index, recording both event ids and the reusable `d` tag
    {
        let mut index = db::load_mls_keypackages(&handle).await.unwrap_or_default();
        index.retain(|entry| {
            entry.get("owner_pubkey").and_then(|value| value.as_str())
                != Some(owner_pubkey_b32.as_str())
                || entry.get("device_id").and_then(|value| value.as_str())
                    != Some(device_id.as_str())
        });
        let now = Timestamp::now().as_secs();
        index.push(serde_json::json!({
            "owner_pubkey": owner_pubkey_b32,
            "device_id": device_id,
            "keypackage_ref": kp_event_30443.id.to_hex(),
            "keypackage_ref_secondary": kp_event_443.id.to_hex(),
            "keypackage_d_tag": d_tag,
            "fetched_at": now,
            "expires_at": 0u64
        }));
        let _ = db::save_mls_keypackages(handle.clone(), &index).await;
    }

    if force_refresh {
        mls_store_reset_state::mark_keypackage_refreshed(&handle)?;
    }
    if let Err(e) = replay_reset_pending_welcomes(&handle).await {
        // Keep the durable wrapper-id queue for the next login when a relay or
        // the MLS engine is temporarily unavailable.
        eprintln!(
            "[MLS] Pending welcome replay after store reset deferred: {}",
            e
        );
    }

    Ok(serde_json::json!({
        "device_id": device_id,
        "owner_pubkey": owner_pubkey_b32,
        "keypackage_ref": kp_event_30443.id.to_hex(),
        "keypackage_ref_secondary": kp_event_443.id.to_hex(),
        "cached": false
    }))
}

/// Fetch a KeyPackage event by id across both the spec (30443) and legacy (443) kinds and
/// confirm the current MLS engine can still parse it. `regenerate_device_keypackage`'s cache
/// check calls this once per dual-published ref, so one kind being pruned from a relay does
/// not silently pass the check on the strength of the other still resolving. Returns the
/// rejection reason on failure so the caller can log why the cache was invalidated.
pub(crate) async fn keypackage_ref_still_usable(
    client: &nostr_sdk::Client,
    handle: &AppHandle,
    ref_id_hex: &str,
) -> Result<(), String> {
    let event_id = nostr_sdk::EventId::from_hex(ref_id_hex)
        .map_err(|e| format!("invalid keypackage ref: {}", e))?;
    let filter = Filter::new()
        .id(event_id)
        .kinds(mls::mls_key_package_kinds())
        .limit(1);
    let mut events = client
        .stream_events_from(
            trusted_relays::trusted_relays().to_vec(),
            filter,
            std::time::Duration::from_secs(5),
        )
        .await
        .map_err(|e| format!("relay fetch failed: {}", e))?;
    let event = events
        .next()
        .await
        .ok_or_else(|| "not found on the trusted relays".to_string())?;
    let mls_service =
        MlsService::new_persistent_for_keypackage_refresh(handle).map_err(|e| e.to_string())?;
    mls_service.key_package_event_usable(&event)
}

/// Re-fetch pending pre-reset welcomes by id. Forward sync is time-windowed,
/// so clearing `discarded_giftwraps` alone cannot recover an old invitation.
pub(crate) async fn replay_reset_pending_welcomes<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<(), String> {
    let ids = mls_store_reset_state::pending_wrapper_ids(handle)?;
    if ids.is_empty() {
        return Ok(());
    }

    let client = get_nostr_client().map_err(|_| "Nostr client not initialized")?;
    let mut remaining = Vec::new();
    for wrapper_id in ids {
        let Ok(event_id) = EventId::from_hex(&wrapper_id) else {
            eprintln!(
                "[MLS] Dropping malformed reset welcome wrapper id: {}",
                wrapper_id
            );
            continue;
        };
        let filter = Filter::new().id(event_id).kind(Kind::GiftWrap).limit(1);
        let event = match client
            .stream_events_from(
                trusted_relays::trusted_relays().to_vec(),
                filter,
                std::time::Duration::from_secs(10),
            )
            .await
        {
            Ok(mut events) => events.next().await,
            Err(e) => {
                eprintln!(
                    "[MLS] Exact welcome re-fetch failed for {}: {}",
                    wrapper_id, e
                );
                None
            }
        };

        let Some(event) = event else {
            remaining.push(wrapper_id);
            continue;
        };
        let _ = handle_event_guarded(event, true).await;
        if !db::wrapper_event_exists(handle, &wrapper_id)
            .await
            .unwrap_or(false)
        {
            remaining.push(wrapper_id);
        }
    }
    mls_store_reset_state::retain_pending_wrapper_ids(handle, &remaining)
}

/// Merge preflight skips (no key package published) with engine-time skips (key package
/// unfetchable or rejected by MDK's parser) into one list for the caller, preflight first.
pub(crate) fn merge_skipped_members(
    preflight: Vec<mls::SkippedMember>,
    mut engine_skips: Vec<mls::SkippedMember>,
) -> Vec<mls::SkippedMember> {
    let mut merged = preflight;
    merged.append(&mut engine_skips);
    merged
}

/// Result returned to the frontend by `create_group_chat`: the new group's wire id plus every
/// requested member who was left out and why. Reasons are backend diagnostics for logging only
/// — the UI never renders them, it maps skipped npubs through its own copy.
#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GroupChatCreated {
    group_id: String,
    skipped_members: Vec<mls::SkippedMember>,
    pending_invites: Vec<mls::UndeliveredInvite>,
}

/// Runs `MlsService::create_group` on a blocking thread (the engine is `!Send`) and returns the
/// full outcome, including any members skipped for an unresolved or unparseable KeyPackage.
pub(crate) async fn run_create_mls_group(
    name: String,
    avatar_ref: Option<String>,
    initial_member_devices: Vec<(String, String)>,
) -> Result<mls::GroupCreateOutcome, String> {
    tokio::task::spawn_blocking(move || {
        // Get handle in blocking context
        let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();

        // Use tokio runtime to run async code from blocking context
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async move {
            let mls = MlsService::new_persistent(&handle).map_err(|e| e.to_string())?;
            mls.create_group(&name, avatar_ref.as_deref(), &initial_member_devices)
                .await
                .map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Create an MLS group from a group name + member npubs (multi-device aware)
/// - Validates non-empty group name (channel name; squad display name is a separate
///   field validated in `squad_catalog::upsert_squad`). `member_ids` may be empty
///   (creator-only group; consent-first invites add humans after create).
/// - For each member npub, refreshes their latest device keypackage(s)
/// - A member with zero keypackages after refresh, or whose KeyPackage the MLS engine cannot
///   parse (e.g. a legacy event missing the MIP-00/02 encoding tag), is skipped rather than
///   aborting the whole group. If *every* requested member ends up skipped, creation still
///   fails with a per-member reason.
/// - Creates the MLS group and persists metadata so it's immediately discoverable
///
/// Note on device selection policy:
/// - refresh_keypackages_for_contact(npub) returns Vec<(device_id, keypackage_ref)>
/// - For now we choose the first returned device as the member's device to add
///   This can be evolved to pick "newest" by fetched_at if exposed; UI can later allow device selection.
///
/// Frontend invokes this via: invoke('create_group_chat', { groupName, memberIds }) and gets
/// back `{ groupId, skippedMembers }`. Skipped members are never sent squad-invite DMs.
#[tauri::command]
pub(crate) async fn create_group_chat(
    group_name: String,
    member_ids: Vec<String>,
) -> Result<GroupChatCreated, String> {
    session::heartbeat();
    require_key_derivation_version_2()?;
    // Input validation
    /*
    Error mapping for UI (Create Group)
    - "Group name must not be empty": validation error. Frontend disables Create until non-empty; if surfaced, show inline status.
    - Empty member_ids is allowed (creator-only announcements group).
    - "Failed to refresh device keypackage for {npub}: {error}": hard failure for a specific member during preflight refresh. Abort creation and show this exact string in popup/toast and inline status.
    - Members with zero device keypackages after refresh, or whose KeyPackage the engine rejects,
      are skipped rather than aborting: they show up in the response's `skippedMembers` instead of
      blocking the rest of the group. If *every* selected member ends up skipped, creation aborts
      with an error naming each npub and why.
    - Any other error bubbled from group creation: engine/storage/network issues are propagated as
      user-facing strings. Surface them verbatim in the UI.

    Success path
    - Returns `{ groupId, skippedMembers }`: groupId is the wire id used for relay 'h' tag
      filtering; skippedMembers lists members left out with their reason (backend diagnostics —
      the UI maps skipped npubs through its own copy, it never renders these strings).
    - Backend also emits "mls_group_initial_sync" so the list view updates without restart.
    */
    let name = group_name.trim();
    if name.is_empty() {
        return Err("Group name must not be empty".to_string());
    }
    if name.len() > crate::app_config::CHANNEL_NAME_MAX_LENGTH {
        return Err(format!(
            "Channel name must be at most {} characters",
            crate::app_config::CHANNEL_NAME_MAX_LENGTH
        ));
    }
    // Empty member_ids = creator-only group (consent-first invites add humans later).

    // For each member id (npub), refresh keypackages and pick one device to add
    let mut initial_member_devices: Vec<(String, String)> = Vec::with_capacity(member_ids.len());
    let mut preflight_skipped: Vec<mls::SkippedMember> = Vec::new();

    for npub in member_ids {
        // Attempt to refresh and fetch device keypackages for this contact
        // If this fails for any reason, abort group creation with actionable error text
        let devices = refresh_keypackages_for_contact(npub.clone())
            .await
            .map_err(|e| format!("Failed to refresh device keypackage for {}: {}", npub, e))?;

        // Choose a device. Currently: first entry. Future: prefer newest by fetched_at if available.
        let maybe_first = devices.into_iter().next();
        if let Some((device_id, _kp_ref)) = maybe_first {
            // Shape required by run_create_mls_group: (member_npub, device_id)
            initial_member_devices.push((npub, device_id));
        } else {
            // No keypackages for this member → skip them but keep going
            eprintln!(
                "[MLS][create_group_chat] Skipping member with no device keypackages: {}",
                npub
            );
            preflight_skipped.push(mls::SkippedMember {
                npub,
                reason: "no key package published".to_string(),
                transient: false,
            });
        }
    }

    // If members were requested but everyone was skipped, abort with a clear error
    if initial_member_devices.is_empty() && !preflight_skipped.is_empty() {
        return Err(format!(
            "No device keypackages found for any selected member: {}",
            skipped_members_detail(&preflight_skipped)
        ));
    }

    // Log any partially skipped members for troubleshooting
    if !preflight_skipped.is_empty() {
        eprintln!(
            "[MLS][create_group_chat] Proceeding without members missing keypackages: [{}]",
            preflight_skipped
                .iter()
                .map(|s| s.npub.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        );
    }

    // Delegate to the shared helper that persists metadata, publishes welcomes and emits UI
    // events; avatar_ref is None for now (out of scope for this subtask)
    let outcome = run_create_mls_group(name.to_string(), None, initial_member_devices).await?;

    let skipped_members = merge_skipped_members(preflight_skipped, outcome.skipped);
    for s in &skipped_members {
        eprintln!("[MLS][create_group_chat] skipped {}: {}", s.npub, s.reason);
    }

    let pending_invites = outcome.pending_invites;
    for p in &pending_invites {
        eprintln!(
            "[MLS][create_group_chat] pending welcome {}: {}",
            p.npub, p.reason
        );
    }

    tokio::spawn(async {
        if let Err(err) = regenerate_device_keypackage(false).await {
            eprintln!(
                "[MLS] Failed to regenerate device KeyPackage after group creation: {}",
                err
            );
        }
    });

    Ok(GroupChatCreated {
        group_id: outcome.group_id,
        skipped_members,
        pending_invites,
    })
}

/// Format a skip list as `"[npub1 (reason1), npub2 (reason2)]"`, or `"none"` when empty — used
/// in the "every selected member was skipped" error text.
pub(crate) fn skipped_members_detail(skipped: &[mls::SkippedMember]) -> String {
    if skipped.is_empty() {
        return "none".to_string();
    }
    format!(
        "[{}]",
        skipped
            .iter()
            .map(|s| format!("{} ({})", s.npub, s.reason))
            .collect::<Vec<_>>()
            .join(", ")
    )
}

#[cfg(test)]
mod create_group_chat_helper_tests {
    use super::{merge_skipped_members, skipped_members_detail};
    use crate::mls::SkippedMember;

    fn member(npub: &str, reason: &str) -> SkippedMember {
        SkippedMember {
            npub: npub.to_string(),
            reason: reason.to_string(),
            transient: false,
        }
    }

    #[test]
    fn merge_skipped_members_keeps_preflight_before_engine_skips() {
        let preflight = vec![member("npub1", "no key package published")];
        let engine = vec![member("npub2", "Missing required encoding tag")];
        let merged = merge_skipped_members(preflight, engine);
        assert_eq!(
            merged.iter().map(|s| s.npub.as_str()).collect::<Vec<_>>(),
            vec!["npub1", "npub2"]
        );
    }

    #[test]
    fn merge_skipped_members_handles_either_side_empty() {
        assert!(merge_skipped_members(vec![], vec![]).is_empty());
        let only_preflight = merge_skipped_members(vec![member("npub1", "reason")], vec![]);
        assert_eq!(only_preflight.len(), 1);
        let only_engine = merge_skipped_members(vec![], vec![member("npub1", "reason")]);
        assert_eq!(only_engine.len(), 1);
    }

    #[test]
    fn skipped_members_detail_formats_npub_and_reason() {
        let skipped = vec![
            member("npub1", "no key package published"),
            member("npub2", "Missing required encoding tag"),
        ];
        assert_eq!(
            skipped_members_detail(&skipped),
            "[npub1 (no key package published), npub2 (Missing required encoding tag)]"
        );
    }

    #[test]
    fn skipped_members_detail_reports_none_when_empty() {
        assert_eq!(skipped_members_detail(&[]), "none");
    }
}

/// Add a member device to an MLS group
#[tauri::command]
pub(crate) async fn add_mls_member_device(
    group_id: String,
    member_npub: String,
    device_id: String,
) -> Result<(), String> {
    session::heartbeat();
    require_key_derivation_version_2()?;
    // Run non-Send MLS engine work on a blocking thread; drive async via current runtime
    tokio::task::spawn_blocking(move || {
        let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async move {
            let mls = MlsService::new_persistent(&handle).map_err(|e| e.to_string())?;
            mls.add_member_device(&group_id, &member_npub, &device_id, false)
                .await
                .map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Invite a new member to an existing MLS group
/// Similar to create_group_chat, this refreshes the member's keypackages and adds them to the group.
/// `is_resend`: true for the "Resend invite" UI action on an already-pending member (lets
/// `add_member_device` no-op if a concurrent call already resolved it); false for a genuine
/// first-time invite or "Restore access".
#[tauri::command]
pub(crate) async fn invite_member_to_group(
    group_id: String,
    member_npub: String,
    is_resend: bool,
) -> Result<(), String> {
    session::heartbeat();
    require_key_derivation_version_2()?;
    // Refresh keypackages for the new member
    let devices = refresh_keypackages_for_contact(member_npub.clone())
        .await
        .map_err(|e| {
            format!(
                "Failed to refresh device keypackage for {}: {}",
                member_npub, e
            )
        })?;

    // Choose the first device (same policy as group creation)
    let (device_id, _kp_ref) = devices
        .into_iter()
        .next()
        .ok_or_else(|| format!("No device keypackages found for {}", member_npub))?;

    // Run non-Send MLS engine work on a blocking thread
    let group_id_clone = group_id.clone();
    tokio::task::spawn_blocking(move || {
        let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async move {
            let mls = MlsService::new_persistent(&handle).map_err(|e| e.to_string())?;
            mls.add_member_device(&group_id_clone, &member_npub, &device_id, is_resend)
                .await
                .map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    // Sync participants array after adding member
    sync_mls_group_participants(group_id).await?;

    Ok(())
}

/// Remove a member device from an MLS group
#[tauri::command]
pub(crate) async fn remove_mls_member_device(
    group_id: String,
    member_npub: String,
    device_id: String,
) -> Result<(), String> {
    session::heartbeat();
    require_key_derivation_version_2()?;
    // Run non-Send MLS engine work on a blocking thread; drive async via current runtime
    let group_id_clone = group_id.clone();
    tokio::task::spawn_blocking(move || {
        let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async move {
            let mls = MlsService::new_persistent(&handle).map_err(|e| e.to_string())?;
            mls.remove_member_device(&group_id_clone, &member_npub, &device_id)
                .await
                .map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    // Sync participants array after removing member
    sync_mls_group_participants(group_id).await?;

    Ok(())
}

/// Sync MLS groups with the network
/// If group_id is provided, sync only that group
/// If None, sync all groups (placeholder for now)
#[tauri::command]
pub(crate) async fn sync_mls_groups_now(group_id: Option<String>) -> Result<(u32, u32), String> {
    session::heartbeat();
    // Run non-Send MLS engine work on blocking thread; drive async via current runtime
    tokio::task::spawn_blocking(move || {
        let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async move {
            let mls = MlsService::new_persistent(&handle).map_err(|e| e.to_string())?;

            if let Some(id) = group_id {
                // Sync specific group since last cursor
                mls.sync_group_since_cursor(&id)
                    .await
                    .map_err(|e| e.to_string())
            } else {
                // Reconcile local engine state on startup / relay reconnection: reap any engine
                // group left behind by a prior release's create_group failure mode (see
                // MlsService::reap_orphaned_engine_groups). Non-fatal — log-only.
                if let Err(e) = mls.reap_orphaned_engine_groups().await {
                    eprintln!("[MLS] Orphan reap failed: {}", e);
                }

                // Multi-group sync: load MLS groups from SQL and sync each
                let group_ids: Vec<String> = match db::load_mls_groups(&handle).await {
                    Ok(groups) => {
                        groups
                            .into_iter()
                            .filter(|g| !g.evicted) // Skip evicted groups
                            .map(|g| g.group_id)
                            .collect()
                    }
                    Err(e) => {
                        eprintln!("Failed to load MLS groups: {}", e);
                        Vec::new()
                    }
                };

                let mut total_processed: u32 = 0;
                let mut total_new: u32 = 0;

                for gid in group_ids {
                    match mls.sync_group_since_cursor(&gid).await {
                        Ok((processed, new_msgs)) => {
                            total_processed = total_processed.saturating_add(processed);
                            total_new = total_new.saturating_add(new_msgs);
                        }
                        Err(e) => {
                            eprintln!("[MLS] sync_group_since_cursor failed for {}: {}", gid, e);
                        }
                    }

                    // Sync participants array to ensure it matches actual group members
                    if let Err(e) = sync_mls_group_participants(gid.clone()).await {
                        eprintln!("[MLS] Failed to sync participants for group {}: {}", gid, e);
                    }
                }

                Ok((total_processed, total_new))
            }
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Simplified representation of a pending MLS Welcome for UI
#[derive(serde::Serialize)]
pub(crate) struct SimpleWelcome {
    // Welcome event id (rumor id) hex
    id: String,
    // Wrapper id carrying the welcome (giftwrap id) hex
    wrapper_event_id: String,
    // Group metadata
    nostr_group_id: String,
    group_name: String,
    group_description: Option<String>,
    group_image_url: Option<String>,
    // Admins (npub strings if possible are not available here; expose hex pubkeys)
    group_admin_pubkeys: Vec<String>,
    // Relay URLs
    group_relays: Vec<String>,
    // Welcomer (hex)
    welcomer: String,
    member_count: u32,
}

/// Shared flow: get pending welcome for channel_group_id, accept it, emit `channel_added_to_squad`.
pub(crate) fn spawn_accept_channel_welcome_and_emit(
    announcements_group_id: String,
    channel_group_id: String,
    channel_name: String,
) {
    tokio::spawn(async move {
        for _ in 0..10 {
            let handle = match TAURI_APP.get() {
                Some(h) => h.clone(),
                None => break,
            };
            let cid = channel_group_id.clone();
            let welcome_id = tokio::task::spawn_blocking(move || {
                get_pending_welcome_id_for_group_sync(&handle, &cid)
            })
            .await
            .ok()
            .and_then(|o| o);
            if let Some(wid) = welcome_id {
                let handle = match TAURI_APP.get() {
                    Some(h) => h.clone(),
                    None => break,
                };
                let accepted = tokio::task::spawn_blocking(move || {
                    let rt = tokio::runtime::Handle::current();
                    rt.block_on(do_accept_mls_welcome(handle, wid))
                })
                .await
                .ok()
                .and_then(|r| r.ok())
                .unwrap_or(false);
                if accepted {
                    if let Some(app) = TAURI_APP.get() {
                        let payload = serde_json::json!({
                            "announcements_group_id": announcements_group_id,
                            "channel_group_id": channel_group_id,
                            "channel_name": channel_name,
                        });
                        let _ = app.emit("channel_added_to_squad", payload);
                    }
                    break;
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    });
}

/// Get the welcome event id (hex) for a pending MLS welcome that matches the given channel group id.
/// Must be called from a blocking context (uses MLS engine).
pub(crate) fn get_pending_welcome_id_for_group_sync<R: Runtime>(
    handle: &AppHandle<R>,
    channel_group_id: &str,
) -> Option<String> {
    let mls = MlsService::new_persistent(handle).ok()?;
    let engine = mls.engine().ok()?;
    let pending = engine.get_pending_welcomes(None).ok()?;
    let cid_lower = channel_group_id.to_lowercase();
    let w = pending
        .into_iter()
        .find(|w| hex::encode(&w.nostr_group_id).to_lowercase() == cid_lower)?;
    Some(w.id.to_hex())
}

/// List pending MLS welcomes (invites)
#[tauri::command]
pub(crate) async fn list_pending_mls_welcomes() -> Result<Vec<SimpleWelcome>, String> {
    // Run non-Send MLS engine work on blocking thread; drive async via current runtime
    let welcomes: Vec<SimpleWelcome> = tokio::task::spawn_blocking(move || {
        let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async move {
            let mls = MlsService::new_persistent(&handle).map_err(|e| e.to_string())?;
            let engine = mls.engine().map_err(|e| e.to_string())?;

            let pending = engine
                .get_pending_welcomes(None)
                .map_err(|e| e.to_string())?;

            let mut out: Vec<SimpleWelcome> = Vec::with_capacity(pending.len());
            for w in pending {
                out.push(SimpleWelcome {
                    id: w.id.to_hex(),
                    wrapper_event_id: w.wrapper_event_id.to_hex(),
                    nostr_group_id: hex::encode(w.nostr_group_id),
                    group_name: w.group_name.clone(),
                    group_description: Some(w.group_description.clone()),
                    group_image_url: None, // MDK uses group_image_hash/key/nonce instead of URL
                    group_admin_pubkeys: w
                        .group_admin_pubkeys
                        .iter()
                        .filter_map(|pk| pk.to_bech32().ok())
                        .collect(),
                    group_relays: w.group_relays.iter().map(|r| r.to_string()).collect(),
                    welcomer: w.welcomer.to_bech32().map_err(|e| e.to_string())?,
                    member_count: w.member_count,
                });
            }

            Ok::<Vec<SimpleWelcome>, String>(out)
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    // Send notifications for new welcomes (outside blocking task)
    // Only notify for welcomes we haven't notified about before
    for welcome in &welcomes {
        if let Some(handle) = TAURI_APP.get() {
            // DB-backed dedup (R13): a `welcome`-kind entry already existing
            // for this wrapper_event_id means already notified, and it holds
            // across a restart because the row is in SQLite, not process memory.
            let is_new = crate::catch_up::record_welcome_for_handle(
                handle,
                &welcome.nostr_group_id,
                &welcome.wrapper_event_id,
            )
            .await;
            if !is_new {
                continue;
            }

            // Get inviter's display name
            let inviter_name = {
                let state = STATE.lock().await;
                if let Some(profile) = state.get_profile(&welcome.welcomer) {
                    if !profile.nickname.is_empty() {
                        profile.nickname.clone()
                    } else if !profile.name.is_empty() {
                        profile.name.clone()
                    } else {
                        "Someone".to_string()
                    }
                } else {
                    "Someone".to_string()
                }
            };

            // No chat exists yet for a not-yet-accepted welcome, so there is
            // no per-chat level to read; default (Mentions) always
            // interrupts for an ActionPrompt, matching the prior
            // unconditional-notify behavior. Keyed by wrapper_event_id
            // rather than a chat id — each invite is distinct, so
            // per-chat coalescing does not apply here.
            let single = notification::SingleEventNotification {
                title: format!("Group Invite: {}", welcome.group_name),
                body: format!("Invited by {}", inviter_name),
            };
            notification::emit(
                handle,
                notification::EventKind::ActionPrompt,
                NotificationLevel::default(),
                false,
                false,
                &welcome.wrapper_event_id,
                &welcome.group_name,
                single,
            )
            .await;
        }
    }

    Ok(welcomes)
}

/// Core logic for accepting an MLS welcome. Used by the tauri command and by channel-in-squad auto-accept.
/// Must be run from a blocking context (e.g. rt.block_on) because it uses the MLS engine.
pub(crate) async fn do_accept_mls_welcome<R: Runtime>(
    handle: AppHandle<R>,
    welcome_event_id_hex: String,
) -> Result<bool, String> {
    let mls = MlsService::new_persistent(&handle).map_err(|e| e.to_string())?;

    // Serialize accept-then-persist against the reaper. `accept_welcome` commits the
    // group into the engine before `save_mls_group`; without this lock a login/reconnect
    // reap can delete the just-joined group as an "orphan".
    let _create_lock_guard = crate::mls_orphan_reaper::MLS_GROUPS_ENGINE_CREATE_LOCK
        .lock()
        .await;

    let (nostr_group_id, engine_group_id, group_name, welcomer_hex, wrapper_event_id_hex) = {
        let engine = mls.engine().map_err(|e| e.to_string())?;
        let id = nostr_sdk::EventId::from_hex(&welcome_event_id_hex).map_err(|e| e.to_string())?;
        let welcome_opt = engine.get_welcome(&id).map_err(|e| e.to_string())?;
        let welcome = welcome_opt.ok_or_else(|| "Welcome not found".to_string())?;
        let nostr_group_id_bytes = welcome.nostr_group_id.clone();
        let group_name = welcome.group_name.clone();
        let welcomer_hex = welcome.welcomer.to_hex();
        let wrapper_event_id_hex = welcome.wrapper_event_id.to_hex();
        // The welcome already carries the engine GroupId. Falling back to nostr_group_id
        // made the reaper treat a live group as unmatched and delete it.
        let engine_group_id = hex::encode(welcome.mls_group_id.as_slice());
        engine.accept_welcome(&welcome).map_err(|e| e.to_string())?;
        let nostr_group_id = hex::encode(&nostr_group_id_bytes);
        (
            nostr_group_id,
            engine_group_id,
            group_name,
            welcomer_hex,
            wrapper_event_id_hex,
        )
    };

    let mut groups = mls.read_groups().await.map_err(|e| e.to_string())?;
    let existing_index = groups.iter().position(|g| g.group_id == nostr_group_id);

    if let Some(idx) = existing_index {
        if groups[idx].evicted {
            groups[idx].evicted = false;
            groups[idx].updated_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_secs();
            crate::db::save_mls_group(handle.clone(), &groups[idx])
                .await
                .map_err(|e| e.to_string())?;
            mls::emit_group_metadata_event(&groups[idx]);
        }
    } else {
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs();
        let metadata = mls::MlsGroupMetadata {
            group_id: nostr_group_id.clone(),
            engine_group_id: engine_group_id.clone(),
            creator_pubkey: welcomer_hex,
            name: group_name.clone(),
            avatar_ref: None,
            created_at: now_secs,
            updated_at: now_secs,
            evicted: false,
            pending_welcomes: Vec::new(),
        };
        crate::db::save_mls_group(handle.clone(), &metadata)
            .await
            .map_err(|e| e.to_string())?;
        mls::emit_group_metadata_event(&metadata);
    }
    // Metadata is durable; release before STATE so this cannot deadlock with
    // paths that take STATE then the create lock. Matches `create_group`.
    drop(_create_lock_guard);

    if existing_index.is_none() {
        let mut state = STATE.lock().await;
        let chat_id = state.create_or_get_mls_group_chat(&nostr_group_id, vec![]);
        if let Some(chat) = state.get_chat_mut(&chat_id) {
            chat.metadata.set_name(group_name);
        }
        if let Some(chat) = state.get_chat(&chat_id) {
            let _ = db::save_chat(handle.clone(), chat).await;
        }
    }

    crate::catch_up::resolve_welcome_for_handle(&handle, &wrapper_event_id_hex).await;
    mls_store_reset_state::mark_group_restored(&handle, &nostr_group_id)?;
    mls_store_reset_state::emit_reset_state(&handle)?;

    if let Some(app) = TAURI_APP.get() {
        let _ = app.emit(
            "mls_welcome_accepted",
            serde_json::json!({
                "welcome_event_id": welcome_event_id_hex,
                "group_id": nostr_group_id
            }),
        );
    }

    if let Err(e) = sync_mls_group_participants(nostr_group_id.clone()).await {
        eprintln!(
            "[MLS] Failed to sync participants after welcome accept: {}",
            e
        );
    }

    if let Err(e) = mls.sync_group_since_cursor(&nostr_group_id).await {
        eprintln!(
            "[MLS] Post-accept initial sync failed for group {}: {}",
            nostr_group_id, e
        );
    } else if let Some(app) = TAURI_APP.get() {
        let _ = app.emit(
            "mls_group_initial_sync",
            serde_json::json!({ "group_id": nostr_group_id }),
        );
    }

    Ok(true)
}

/// Accept an MLS welcome by its welcome (rumor) event id hex
#[tauri::command]
pub(crate) async fn accept_mls_welcome(welcome_event_id_hex: String) -> Result<bool, String> {
    session::heartbeat();
    require_key_derivation_version_2()?;
    let accepted = tokio::task::spawn_blocking(move || {
        let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
        let rt = tokio::runtime::Handle::current();
        rt.block_on(do_accept_mls_welcome(handle, welcome_event_id_hex))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    if accepted {
        tokio::spawn(async {
            if let Err(err) = regenerate_device_keypackage(false).await {
                eprintln!(
                    "[MLS] Failed to regenerate device KeyPackage after accepting welcome: {}",
                    err
                );
            }
        });
    }

    Ok(accepted)
}

#[tauri::command]
pub(crate) async fn list_mls_groups() -> Result<Vec<String>, String> {
    let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
    match db::load_mls_groups(&handle).await {
        Ok(groups) => {
            let ids = groups.into_iter().map(|g| g.group_id).collect();
            Ok(ids)
        }
        Err(e) => Err(format!("Failed to load MLS groups: {}", e)),
    }
}

#[tauri::command]
pub(crate) async fn get_mls_group_metadata() -> Result<Vec<serde_json::Value>, String> {
    let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
    let groups = db::load_mls_groups(&handle)
        .await
        .map_err(|e| format!("Failed to load MLS group metadata: {}", e))?;

    Ok(groups
        .iter()
        .filter(|meta| !meta.evicted)
        .map(|meta| mls::metadata_to_frontend(meta))
        .collect())
}

#[tauri::command]
pub(crate) fn get_mls_store_reset_state(
) -> Result<Vec<mls_store_reset_state::MlsStoreResetGroupState>, String> {
    let handle = TAURI_APP.get().ok_or("App handle not initialized")?;
    mls_store_reset_state::reset_group_states(handle)
}

#[derive(serde::Serialize, Clone)]
pub(crate) struct GroupMembers {
    group_id: String,
    members: Vec<String>, // npubs
    admins: Vec<String>,  // admin npubs
    pending_welcomes: Vec<String>,
}

/// Sync the participants array for an MLS group chat with the actual members from the engine
/// This ensures chat.participants is always up-to-date
pub(crate) async fn sync_mls_group_participants(group_id: String) -> Result<(), String> {
    if let Some(handle) = TAURI_APP.get() {
        if mls_store_reset_state::is_group_state_lost(handle, &group_id)? {
            // The fresh engine has no membership yet. Keep the app DB's former
            // participant list until a welcome restores this group.
            return Ok(());
        }
    }
    // Get actual members from the engine
    let group_members = get_mls_group_members(group_id.clone()).await?;

    // Update the chat's participants array
    let mut state = STATE.lock().await;
    if let Some(chat) = state.get_chat_mut(&group_id) {
        let old_count = chat.participants.len();
        chat.participants = group_members.members.clone();
        let new_count = chat.participants.len();

        if old_count != new_count {
            eprintln!(
                "[MLS] Synced participants for group {}: {} -> {} members",
                &group_id[..8.min(group_id.len())],
                old_count,
                new_count
            );
            if let Some(app) = TAURI_APP.get() {
                let _ = app.emit(
                    "mls_group_updated",
                    serde_json::json!({ "group_id": group_id.clone() }),
                );
            }
        }

        // Save updated chat to disk
        let chat_clone = chat.clone();
        drop(state);

        if let Some(handle) = TAURI_APP.get() {
            if let Err(e) = db::save_chat(handle.clone(), &chat_clone).await {
                eprintln!(
                    "[MLS] Failed to save chat after syncing participants: {}",
                    e
                );
            }
        }
    } else {
        drop(state);
        eprintln!(
            "[MLS] Chat not found when syncing participants: {}",
            group_id
        );
    }

    Ok(())
}

/// Get members (npubs) of an MLS group from the persistent engine (on-demand).
/// When the group is in MLS store-reset "lost" state the fresh engine has no
/// membership — fall back to the preserved chat.participants roster so UI paths
/// like sole-admin recreate can still invite former members.
#[tauri::command]
pub(crate) async fn get_mls_group_members(group_id: String) -> Result<GroupMembers, String> {
    // Run engine operations on a blocking thread so the outer future is Send
    tokio::task::spawn_blocking(move || {
        let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async move {
            // Initialise persistent MLS
            let mls = MlsService::new_persistent(&handle).map_err(|e| e.to_string())?;
            // Map wire-id/engine-id using encrypted metadata
            let meta_groups = mls.read_groups().await.unwrap_or_default();
            let (wire_id, engine_id, pending_welcomes) = if let Some(m) =
                meta_groups.iter().find(|g| {
                    g.group_id == group_id
                        || (!g.engine_group_id.is_empty() && g.engine_group_id == group_id)
                }) {
                (
                    m.group_id.clone(),
                    if !m.engine_group_id.is_empty() {
                        m.engine_group_id.clone()
                    } else {
                        m.group_id.clone()
                    },
                    m.pending_welcomes.clone(),
                )
            } else {
                (group_id.clone(), group_id.clone(), Vec::new())
            };

            // Acquire non-Send engine; all calls below must be non-await while engine is in scope
            let engine = mls.engine().map_err(|e| e.to_string())?;
            use mdk_core::prelude::GroupId;

            let mut members: Vec<String> = Vec::new();
            let mut admins: Vec<String> = Vec::new();
            if let Ok(gid_bytes) = hex::decode(&engine_id) {
                // Decode engine id to GroupId
                let gid = GroupId::from_slice(&gid_bytes);

                // Get members via engine API
                if let Ok(pk_list) = engine.get_members(&gid) {
                    members = pk_list
                        .into_iter()
                        .filter_map(|pk| pk.to_bech32().ok())
                        .collect();
                }

                // Get admins from the group
                if let Ok(groups) = engine.get_groups() {
                    for g in groups {
                        let gid_hex = hex::encode(g.mls_group_id.as_slice());
                        if gid_hex == engine_id {
                            admins = g
                                .admin_pubkeys
                                .iter()
                                .filter_map(|pk| pk.to_bech32().ok())
                                .collect();
                            break;
                        }
                    }
                }
            }
            drop(engine);

            let lost = mls_store_reset_state::is_group_state_lost(&handle, &wire_id)
                .or_else(|_| mls_store_reset_state::is_group_state_lost(&handle, &group_id))
                .unwrap_or(false);
            if lost && members.is_empty() {
                let preserved = {
                    let state = STATE.lock().await;
                    state
                        .get_chat(&wire_id)
                        .or_else(|| state.get_chat(&group_id))
                        .map(|chat| chat.participants.clone())
                        .unwrap_or_default()
                };
                if !preserved.is_empty() {
                    members = preserved;
                }
                if admins.is_empty() {
                    if let Ok(states) = mls_store_reset_state::reset_group_states(&handle) {
                        if let Some(s) = states
                            .into_iter()
                            .find(|s| s.group_id == wire_id || s.group_id == group_id)
                        {
                            admins = s.admin_npubs;
                        }
                    }
                }
            }

            Ok(GroupMembers {
                group_id: wire_id,
                members,
                admins,
                pending_welcomes,
            })
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Leave an MLS group (publishes SelfRemove proposal, then local cleanup).
#[tauri::command]
pub(crate) async fn leave_mls_group(group_id: String) -> Result<(), String> {
    require_key_derivation_version_2()?;
    // Run non-Send MLS engine work on a blocking thread
    tokio::task::spawn_blocking(move || {
        let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();
        let rt = tokio::runtime::Handle::current();
        rt.block_on(async move {
            let mls = MlsService::new_persistent(&handle).map_err(|e| e.to_string())?;
            mls.leave_group(&group_id).await.map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Refresh keypackages for a contact from the trusted relay set.
/// Fetches KeyPackage events (kind 30443, or legacy 443) from the contact, updates the local
/// index, and returns (device_id, keypackage_ref) pairs, newest first. The 30443/443 pair
/// from one dual publish collapses into a single entry; separate rotations do not, so a
/// contact who has republished multiple times may still return more than one entry.
#[tauri::command]
pub(crate) async fn refresh_keypackages_for_contact(
    npub: String,
) -> Result<Vec<(String, String)>, String> {
    // Resolve contact pubkey
    let contact_pubkey = PublicKey::from_bech32(&npub).map_err(|e| e.to_string())?;

    // Access client
    let client = get_nostr_client().map_err(|_| "Nostr client not initialized")?;

    // Build filter: author(contact) + both KeyPackage kinds (dual publish). A generous
    // limit tolerates a contact having several real devices, each visible under both
    // kinds.
    let filter = Filter::new()
        .author(contact_pubkey)
        .kinds(mls::mls_key_package_kinds())
        .limit(50);

    // Fetch from the trusted relay set with a short timeout
    let mut events = client
        .stream_events_from(
            trusted_relays::trusted_relays().to_vec(),
            filter,
            std::time::Duration::from_secs(10),
        )
        .await
        .map_err(|e| e.to_string())?;

    let mut raw_events: Vec<Event> = Vec::new();
    while let Some(e) = events.next().await {
        raw_events.push(e);
    }

    // A dual-published device yields two distinct event ids (30443 + 443) carrying identical
    // content. Collapse those into one logical device, keeping the sort order intact —
    // downstream callers (create_group_chat, invite_member_to_group) treat the first
    // returned entry as the device to use, so an unordered dedupe (e.g. draining a HashMap)
    // could hand back a stale duplicate instead of the newest one.
    let mut seen_content: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut deduped: Vec<Event> = Vec::new();
    for event in mls::sort_keypackage_candidates(raw_events) {
        if seen_content.insert(event.content.clone()) {
            deduped.push(event);
        }
    }

    // Prepare results and index entries
    let owner_pubkey_b32 = contact_pubkey.to_bech32().map_err(|e| e.to_string())?;
    let mut results: Vec<(String, String)> = Vec::new();
    let mut new_entries: Vec<serde_json::Value> = Vec::new();

    for e in deduped {
        // Use event id as synthetic device_id when not explicitly provided by remote
        let device_id = e.id.to_hex();
        let keypackage_ref = e.id.to_hex();

        results.push((device_id.clone(), keypackage_ref.clone()));

        new_entries.push(serde_json::json!({
            "owner_pubkey": owner_pubkey_b32,
            "device_id": device_id,
            "keypackage_ref": keypackage_ref,
            "fetched_at": Timestamp::now().as_secs(),
            "expires_at": 0u64
        }));
    }

    // Update local plaintext index after network await
    let handle = TAURI_APP.get().ok_or("App handle not initialized")?.clone();

    // Load existing index
    let mut index = db::load_mls_keypackages(&handle).await.unwrap_or_default();

    // Remove any existing entries for this owner+device_id to avoid duplicates
    for new_entry in &new_entries {
        let owner = new_entry
            .get("owner_pubkey")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let device = new_entry
            .get("device_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        index.retain(|entry| {
            let same_owner = entry.get("owner_pubkey").and_then(|v| v.as_str()) == Some(owner);
            let same_device = entry.get("device_id").and_then(|v| v.as_str()) == Some(device);
            !(same_owner && same_device)
        });
    }

    // Append new entries and persist
    index.extend(new_entries.into_iter());
    let _ = db::save_mls_keypackages(handle.clone(), &index).await;

    Ok(results)
}
