//! Relay lifecycle commands: connectivity probing, failure classification, custom/default
//! relay CRUD, metrics/logs diagnostics, and the background connection monitor.
use crate::{
    current_login_generation, db, evm, extract_mention_notification_body,
    get_blossom_media_servers, get_file_type_description, get_nostr_client, handle_event_guarded,
    net_transport, nostr_sign, nostr_tags, notification, relay_cert, wait_for_populated_relay_pool,
    MlsService, STATE, TAURI_APP,
};
use nostr_sdk::prelude::*;
use once_cell::sync::Lazy;
use std::collections::{HashMap, VecDeque};
use std::sync::RwLock;

use lazy_static::lazy_static;
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::Mutex;

#[tauri::command]
pub(crate) async fn notifs() -> Result<bool, String> {
    let client = get_nostr_client().expect("Nostr client not initialized");

    // Grab our pubkey
    let signer = client.signer().await.map_err(|e| e.to_string())?;
    let pubkey = signer.get_public_key().await.map_err(|e| e.to_string())?;

    // A login/startup race can call this before relay setup completes (the same class of bug
    // as the account-wide sync in `fetch_messages`). Give the pool a
    // bounded chance to gain a relay before subscribing, so these live subscriptions don't fail
    // outright on "no relays specified" and never start listening.
    if client.relays().await.is_empty() {
        wait_for_populated_relay_pool(&client).await;
    }

    // Live GiftWraps to us (DMs, files, MLS welcomes)
    let giftwrap_filter = Filter::new().pubkey(pubkey).kind(Kind::GiftWrap).limit(0);

    // Live MLS group wrappers (Kind::MlsGroupMessage). Broad subscribe; we'll filter by membership in handler.
    let mls_msg_filter = Filter::new().kind(Kind::MlsGroupMessage).limit(0);

    // Subscribe to both filters
    let gift_sub_id = match client.subscribe(giftwrap_filter, None).await {
        Ok(id) => id.val,
        Err(e) => return Err(e.to_string()),
    };
    let mls_sub_id = match client.subscribe(mls_msg_filter, None).await {
        Ok(id) => id.val,
        Err(e) => return Err(e.to_string()),
    };

    // Begin watching for notifications from our subscriptions
    match client
        .handle_notifications(|notification| async {
            if let RelayPoolNotification::Message { relay_url, message: RelayMessage::Event { event, .. } } = &notification {
                // `RelayPoolNotification::Event` below is deduplicated pool-wide (fires only the
                // first time a given event is seen), which would undercount `events_received` for
                // every relay that isn't first to deliver a given event. `Message` fires once per
                // relay per delivery, so it's the correct source for per-relay receive counting.
                record_event_received(&relay_url.to_string(), event);
            }
            if let RelayPoolNotification::Event { event, subscription_id, .. } = notification {
                if subscription_id == gift_sub_id {
                    // Handle DMs/files/vector-specific + MLS welcomes inside giftwrap
                    handle_event_guarded(*event, true).await;
                } else if subscription_id == mls_sub_id {
                    // Handle live MLS group message wrappers
                    let ev = (*event).clone();

                    // Extract group wire id from 'h' tag
                    let group_wire_id_opt = nostr_tags::find_letter(&ev.tags, Alphabet::H)
                        .and_then(|t| t.content().map(|s| s.to_string()));

                    if let Some(group_wire_id) = group_wire_id_opt {
                        // Check if we are a member of this group (metadata check) without constructing MLS engine
                        let handle = TAURI_APP.get().unwrap().clone();
                        let is_member: bool = if let Ok(groups) = db::load_mls_groups(&handle).await {
                            groups.iter().any(|g| {
                                g.group_id == group_wire_id || g.engine_group_id == group_wire_id
                            })
                        } else { false };

                        // Not a member - ignore this group message
                        if !is_member {
                            return Ok(false);
                        }

                        // Resolve my pubkey for filtering and 'mine' flag
                        let (my_pubkey, my_pubkey_bech32) = {
                            let client = get_nostr_client().unwrap();
                            if let Ok(signer) = client.signer().await {
                                if let Ok(pk) = signer.get_public_key().await {
                                    (Some(pk), pk.to_bech32().unwrap())
                                } else {
                                    (None, String::new())
                                }
                            } else {
                                (None, String::new())
                            }
                        };

                        // Skip processing our own events - they're already processed locally when sent
                        if let Some(my_pk) = my_pubkey {
                            if ev.pubkey == my_pk {
                                return Ok(false);
                            }
                        }

                        // Process with non-Send MLS engine on a blocking thread (no awaits in scope)
                        let app_handle = TAURI_APP.get().unwrap().clone();
                        let my_npub_for_block = my_pubkey_bech32.clone();
                        let group_id_for_persist = group_wire_id.clone();
                        let group_id_for_emit = group_wire_id.clone();

                        // Process message and persist in one blocking operation to avoid Send issues
                        let emit_record = tokio::task::spawn_blocking(move || {
                            // Use runtime handle to drive async operations from blocking context
                            let rt = tokio::runtime::Handle::current();

                            // Create MLS service and process message
                            let svc = MlsService::new_persistent(&app_handle).ok()?;
                            let engine = svc.engine().ok()?;

                            match engine.process_message(&ev) {
                                Ok(res) => {
                                    // Use unified storage via process_rumor
                                    match res {
                                        mdk_core::prelude::MessageProcessingResult::ApplicationMessage(msg) => {
                                            // Convert to RumorEvent for protocol-agnostic processing
                                            let rumor_event = crate::rumor::RumorEvent {
                                                id: msg.id,
                                                kind: msg.kind,
                                                content: msg.content.clone(),
                                                tags: msg.tags.clone(),
                                                created_at: msg.created_at,
                                                pubkey: msg.pubkey,
                                            };

                                            let is_mine = !my_npub_for_block.is_empty() && msg.pubkey.to_bech32().unwrap() == my_npub_for_block;

                                            // Process through unified rumor processor
                                            let processed = rt.block_on(async {
                                                use crate::rumor::{process_rumor, RumorContext, ConversationType, RumorProcessingResult};

                                                let rumor_context = RumorContext {
                                                    sender: msg.pubkey,
                                                    is_mine,
                                                    conversation_id: group_id_for_persist.clone(),
                                                    conversation_type: ConversationType::MlsGroup,
                                                };

                                                match process_rumor(rumor_event, rumor_context).await {
                                                    Ok(result) => {
                                                        match result {
                                                            RumorProcessingResult::TextMessage(mut message) => {
                                                                // Populate reply context for old messages not in frontend cache
                                                                if !message.replied_to.is_empty() {
                                                                    if let Some(handle) = TAURI_APP.get() {
                                                                        let _ = db::populate_reply_context(&handle, &mut message).await;
                                                                    }
                                                                }

                                                                // Clear typing indicator for this sender (they just sent a message)
                                                                let sender_npub = msg.pubkey.to_bech32().unwrap_or_default();

                                                                let (was_added, _active_typers, level) = {
                                                                    let mut state = crate::STATE.lock().await;

                                                                    // Add message to chat
                                                                    let added = state.add_message_to_chat(&group_id_for_persist, message.clone());

                                                                    let level = state.get_chat(&group_id_for_persist)
                                                                        .map(|c| c.notification_level)
                                                                        .unwrap_or_default();

                                                                    // Clear typing indicator for sender
                                                                    let typers = if let Some(chat) = state.get_chat_mut(&group_id_for_persist) {
                                                                        chat.update_typing_participant(sender_npub.clone(), 0); // 0 = clear immediately
                                                                        chat.get_active_typers()
                                                                    } else {
                                                                        Vec::new()
                                                                    };

                                                                    (added, typers, level)
                                                                };

                                                                // Route every group text message through the single tier-aware emit (KTD4).
                                                                if was_added {
                                                                    let (sender_name, group_name) = {
                                                                        let state = crate::STATE.lock().await;

                                                                        let sender = if let Some(profile) = state.get_profile(&sender_npub) {
                                                                            if !profile.nickname.is_empty() {
                                                                                profile.nickname.clone()
                                                                            } else if !profile.name.is_empty() {
                                                                                profile.name.clone()
                                                                            } else {
                                                                                "Someone".to_string()
                                                                            }
                                                                        } else {
                                                                            "Someone".to_string()
                                                                        };

                                                                        let group = if let Some(chat) = state.get_chat(&group_id_for_persist) {
                                                                            chat.metadata.get_name().unwrap_or("Group Chat").to_string()
                                                                        } else {
                                                                            "Group Chat".to_string()
                                                                        };

                                                                        (sender, group)
                                                                    };

                                                                    let mention_hit = crate::message::envelope_names_npub(&message.content, &my_npub_for_block);
                                                                    let single = notification::SingleEventNotification {
                                                                        title: format!("{} - {}", sender_name, group_name),
                                                                        body: extract_mention_notification_body(&message.content),
                                                                    };
                                                                    if let Some(handle) = TAURI_APP.get() {
                                                                        notification::emit(
                                                                            handle,
                                                                            notification::EventKind::GroupMessage,
                                                                            level,
                                                                            message.mine,
                                                                            mention_hit,
                                                                            &group_id_for_persist,
                                                                            &group_name,
                                                                            single,
                                                                        ).await;
                                                                        crate::catch_up::record_admitted_event_for_handle(
                                                                            handle,
                                                                            notification::EventKind::GroupMessage,
                                                                            message.mine,
                                                                            mention_hit,
                                                                            &group_id_for_persist,
                                                                            &message.id,
                                                                        ).await;
                                                                    }
                                                                }

                                                                // Save to database if message was added
                                                                if was_added {
                                                                    if let Some(handle) = TAURI_APP.get() {
                                                                        // Get chat and save it
                                                                        let chat_to_save = {
                                                                            let state = crate::STATE.lock().await;
                                                                            state.get_chat(&group_id_for_persist).cloned()
                                                                        };

                                                                        if let Some(chat) = chat_to_save {
                                                                            use crate::db::{save_chat, save_chat_messages};
                                                                            let _ = save_chat(handle.clone(), &chat).await;
                                                                            let _ = save_chat_messages(handle.clone(), &group_id_for_persist, &chat.messages).await;
                                                                        }
                                                                    }
                                                                    Some(message)
                                                                } else {
                                                                    None
                                                                }
                                                            }
                                                            RumorProcessingResult::FileAttachment(mut message) => {
                                                                // Populate reply context for old messages not in frontend cache
                                                                if !message.replied_to.is_empty() {
                                                                    if let Some(handle) = TAURI_APP.get() {
                                                                        let _ = db::populate_reply_context(&handle, &mut message).await;
                                                                    }
                                                                }

                                                                // Clear typing indicator for this sender (they just sent a message)
                                                                let sender_npub = msg.pubkey.to_bech32().unwrap_or_default();
                                                                let is_file = true;

                                                                let (was_added, _active_typers, level) = {
                                                                    let mut state = crate::STATE.lock().await;

                                                                    // Add message to chat
                                                                    let added = state.add_message_to_chat(&group_id_for_persist, message.clone());

                                                                    let level = state.get_chat(&group_id_for_persist)
                                                                        .map(|c| c.notification_level)
                                                                        .unwrap_or_default();

                                                                    // Clear typing indicator for sender
                                                                    let typers = if let Some(chat) = state.get_chat_mut(&group_id_for_persist) {
                                                                        chat.update_typing_participant(sender_npub.clone(), 0); // 0 = clear immediately
                                                                        chat.get_active_typers()
                                                                    } else {
                                                                        Vec::new()
                                                                    };

                                                                    (added, typers, level)
                                                                };

                                                                // Route every group file message through the single tier-aware emit (KTD4).
                                                                if was_added {
                                                                    let (sender_name, group_name) = {
                                                                        let state = crate::STATE.lock().await;

                                                                        let sender = if let Some(profile) = state.get_profile(&sender_npub) {
                                                                            if !profile.nickname.is_empty() {
                                                                                profile.nickname.clone()
                                                                            } else if !profile.name.is_empty() {
                                                                                profile.name.clone()
                                                                            } else {
                                                                                "Someone".to_string()
                                                                            }
                                                                        } else {
                                                                            "Someone".to_string()
                                                                        };

                                                                        let group = if let Some(chat) = state.get_chat(&group_id_for_persist) {
                                                                            chat.metadata.get_name().unwrap_or("Group Chat").to_string()
                                                                        } else {
                                                                            "Group Chat".to_string()
                                                                        };

                                                                        (sender, group)
                                                                    };

                                                                    let content = if is_file {
                                                                        let extension = message.attachments.first()
                                                                            .map(|att| att.extension.clone())
                                                                            .unwrap_or_else(|| String::from("file"));
                                                                        "Sent a ".to_string() + &get_file_type_description(&extension)
                                                                    } else {
                                                                        extract_mention_notification_body(&message.content)
                                                                    };
                                                                    let single = notification::SingleEventNotification {
                                                                        title: format!("{} - {}", sender_name, group_name),
                                                                        body: content,
                                                                    };
                                                                    if let Some(handle) = TAURI_APP.get() {
                                                                        notification::emit(
                                                                            handle,
                                                                            notification::EventKind::GroupMessage,
                                                                            level,
                                                                            message.mine,
                                                                            false,
                                                                            &group_id_for_persist,
                                                                            &group_name,
                                                                            single,
                                                                        ).await;
                                                                        crate::catch_up::record_admitted_event_for_handle(
                                                                            handle,
                                                                            notification::EventKind::GroupMessage,
                                                                            message.mine,
                                                                            false,
                                                                            &group_id_for_persist,
                                                                            &message.id,
                                                                        ).await;
                                                                    }
                                                                }

                                                                // Save to database if message was added
                                                                if was_added {
                                                                    if let Some(handle) = TAURI_APP.get() {
                                                                        // Get chat and save it
                                                                        let chat_to_save = {
                                                                            let state = crate::STATE.lock().await;
                                                                            state.get_chat(&group_id_for_persist).cloned()
                                                                        };

                                                                        if let Some(chat) = chat_to_save {
                                                                            use crate::db::save_chat;
                                                                            let _ = save_chat(handle.clone(), &chat).await;
                                                                            let _ = db::save_message(handle.clone(), &group_id_for_persist, &message).await;
                                                                        }
                                                                    }
                                                                    Some(message)
                                                                } else {
                                                                    None
                                                                }
                                                            }
                                                            RumorProcessingResult::Reaction(reaction) => {
                                                                // Handle reactions in real-time
                                                                let (was_added, chat_id_for_save) = {
                                                                    let mut state = crate::STATE.lock().await;
                                                                    let added = if let Some((chat_id, msg)) = state.find_chat_and_message_mut(&reaction.reference_id) {
                                                                        msg.add_reaction(reaction.clone(), Some(chat_id))
                                                                    } else {
                                                                        false
                                                                    };

                                                                    // Get chat_id for saving if reaction was added
                                                                    let chat_id_for_save = if added {
                                                                        state.find_message(&reaction.reference_id)
                                                                            .map(|(chat, _)| chat.id().clone())
                                                                    } else {
                                                                        None
                                                                    };

                                                                    (added, chat_id_for_save)
                                                                };

                                                                // Save the updated message to database immediately (like DM reactions)
                                                                if was_added {
                                                                    if let Some(chat_id) = chat_id_for_save {
                                                                        if let Some(handle) = TAURI_APP.get() {
                                                                            let updated_message = {
                                                                                let state = crate::STATE.lock().await;
                                                                                state.find_message(&reaction.reference_id)
                                                                                    .map(|(_, msg)| msg.clone())
                                                                            };

                                                                            if let Some(msg) = updated_message {
                                                                                let _ = db::save_message(handle.clone(), &chat_id, &msg).await;
                                                                            }
                                                                        }
                                                                    }
                                                                }

                                                                None // Don't emit as message
                                                            }
                                                            RumorProcessingResult::DashboardPollCreate(mut message) => {
                                                                if !message.replied_to.is_empty() {
                                                                    if let Some(handle) = TAURI_APP.get() {
                                                                        let _ = db::populate_reply_context(&handle, &mut message).await;
                                                                    }
                                                                }
                                                                let sender_npub = msg.pubkey.to_bech32().unwrap_or_default();
                                                                let (was_added, _active_typers, level) = {
                                                                    let mut state = crate::STATE.lock().await;
                                                                    let added = state.add_message_to_chat(&group_id_for_persist, message.clone());
                                                                    let level = state.get_chat(&group_id_for_persist)
                                                                        .map(|c| c.notification_level)
                                                                        .unwrap_or_default();
                                                                    let _typers = if let Some(chat) = state.get_chat_mut(&group_id_for_persist) {
                                                                        chat.update_typing_participant(sender_npub.clone(), 0);
                                                                        chat.get_active_typers()
                                                                    } else {
                                                                        Vec::new()
                                                                    };
                                                                    (added, _typers, level)
                                                                };
                                                                // A new poll needs every member's vote — routed as an action prompt (KTD4).
                                                                if was_added {
                                                                    let (sender_name, group_name) = {
                                                                        let state = crate::STATE.lock().await;
                                                                        let sender = if let Some(profile) = state.get_profile(&sender_npub) {
                                                                            if !profile.nickname.is_empty() {
                                                                                profile.nickname.clone()
                                                                            } else if !profile.name.is_empty() {
                                                                                profile.name.clone()
                                                                            } else {
                                                                                "Someone".to_string()
                                                                            }
                                                                        } else {
                                                                            "Someone".to_string()
                                                                        };
                                                                        let group = if let Some(chat) = state.get_chat(&group_id_for_persist) {
                                                                            chat.metadata.get_name().unwrap_or("Group Chat").to_string()
                                                                        } else {
                                                                            "Group Chat".to_string()
                                                                        };
                                                                        (sender, group)
                                                                    };
                                                                    let single = notification::SingleEventNotification {
                                                                        title: format!("{} - {}", sender_name, group_name),
                                                                        body: "New poll — vote in Dashboard → Polls.".to_string(),
                                                                    };
                                                                    if let Some(handle) = TAURI_APP.get() {
                                                                        notification::emit(
                                                                            handle,
                                                                            notification::EventKind::ActionPrompt,
                                                                            level,
                                                                            message.mine,
                                                                            false,
                                                                            &group_id_for_persist,
                                                                            &group_name,
                                                                            single,
                                                                        ).await;
                                                                        crate::catch_up::record_admitted_event_for_handle(
                                                                            handle,
                                                                            notification::EventKind::ActionPrompt,
                                                                            message.mine,
                                                                            false,
                                                                            &group_id_for_persist,
                                                                            &message.id,
                                                                        ).await;
                                                                    }
                                                                }
                                                                if was_added {
                                                                    if let Some(handle) = TAURI_APP.get() {
                                                                        let group_name = crate::db::load_mls_groups(handle).await
                                                                            .ok()
                                                                            .and_then(|groups| {
                                                                                groups.into_iter()
                                                                                    .find(|g| g.group_id == group_id_for_persist || g.engine_group_id == group_id_for_persist)
                                                                                    .map(|g| g.name)
                                                                            });
                                                                        let _ = handle.emit("mls_message_new", serde_json::json!({
                                                                            "group_id": group_id_for_persist,
                                                                            "message": &message,
                                                                            "group_name": group_name
                                                                        }));
                                                                        let chat_to_save = {
                                                                            let state = crate::STATE.lock().await;
                                                                            state.get_chat(&group_id_for_persist).cloned()
                                                                        };
                                                                        if let Some(chat) = chat_to_save {
                                                                            use crate::db::{save_chat, save_chat_messages};
                                                                            let _ = save_chat(handle.clone(), &chat).await;
                                                                            let _ = save_chat_messages(handle.clone(), &group_id_for_persist, &chat.messages).await;
                                                                        }
                                                                        crate::cmds::chat::schedule_debounced_unread_recompute(handle.clone());
                                                                    }
                                                                    Some(message)
                                                                } else {
                                                                    None
                                                                }
                                                            }
                                                            RumorProcessingResult::DashboardPollVoteIngested => None,
                                                            RumorProcessingResult::TypingIndicator { profile_id, until } => {
                                                                // Handle typing indicators in real-time
                                                                let active_typers = {
                                                                    let mut state = crate::STATE.lock().await;
                                                                    if let Some(chat) = state.get_chat_mut(&group_id_for_persist) {
                                                                        chat.update_typing_participant(profile_id.clone(), until);
                                                                        chat.get_active_typers()
                                                                    } else {
                                                                        Vec::new()
                                                                    }
                                                                };

                                                                // Emit typing update event
                                                                if let Some(handle) = TAURI_APP.get() {
                                                                    let _ = handle.emit("typing-update", serde_json::json!({
                                                                        "conversation_id": group_id_for_persist,
                                                                        "typers": active_typers
                                                                    }));
                                                                }

                                                                None // Don't emit as message
                                                            }
                                                            RumorProcessingResult::UnknownEvent(mut event) => {
                                                                // Store unknown events for future compatibility
                                                                // Get chat_id and save the event
                                                                if let Some(handle) = TAURI_APP.get() {
                                                                    if let Ok(chat_id) = db::get_chat_id_by_identifier(handle, &group_id_for_persist) {
                                                                        event.chat_id = chat_id;
                                                                        let _ = db::save_event(handle, &event).await;
                                                                    }
                                                                }
                                                                None // Don't emit as message
                                                            }
                                                            RumorProcessingResult::Ignored => None,
                                                            RumorProcessingResult::Edit { message_id, new_content, edited_at, event } => {
                                                                // Skip if this edit event was already processed (deduplication)
                                                                if let Some(handle) = TAURI_APP.get() {
                                                                    if db::event_exists(handle, &event.id).unwrap_or(false) {
                                                                        return None; // Already processed, skip
                                                                    }

                                                                    // Save edit event to database
                                                                    if let Ok(chat_id) = db::get_chat_id_by_identifier(handle, &group_id_for_persist) {
                                                                        let mut event_with_chat = event;
                                                                        event_with_chat.chat_id = chat_id;
                                                                        let _ = db::save_event(handle, &event_with_chat).await;
                                                                    }
                                                                }

                                                                // Update message in state and emit to frontend
                                                                let mut state = crate::STATE.lock().await;
                                                                if let Some(chat) = state.get_chat_mut(&group_id_for_persist) {
                                                                    if let Some(msg) = chat.get_message_mut(&message_id) {
                                                                        msg.apply_edit(new_content, edited_at);

                                                                        // Emit update to frontend
                                                                        if let Some(handle) = TAURI_APP.get() {
                                                                            let _ = handle.emit("message_update", serde_json::json!({
                                                                                "old_id": &message_id,
                                                                                "message": &msg,
                                                                                "chat_id": &group_id_for_persist
                                                                            }));
                                                                        }
                                                                    }
                                                                }
                                                                None // Don't emit as message
                                                            }
                                                        }
                                                    }
                                                    Err(e) => {
                                                        eprintln!("[MLS][live] Failed to process rumor: {}", e);
                                                        None
                                                    }
                                                }
                                            });

                                            processed
                                        }
                                        mdk_core::prelude::MessageProcessingResult::Commit { mls_group_id } => {
                                            // Commit processed - member list may have changed
                                            // Check if we're still a member of this group
                                            let my_pubkey_hex = my_npub_for_block.clone();

                                            // Only evict if we can POSITIVELY CONFIRM removal
                                            let membership_check = engine.get_members(&mls_group_id)
                                                .ok()
                                                .and_then(|members| {
                                                    nostr_sdk::PublicKey::from_bech32(&my_pubkey_hex)
                                                        .ok()
                                                        .map(|pk| members.contains(&pk))
                                                });

                                            match membership_check {
                                                Some(false) => {
                                                    // Successfully checked and confirmed NOT a member - evict!
                                                    eprintln!("[MLS] Eviction detected via Commit - group: {}", group_id_for_persist);

                                                    // Perform full cleanup using the helper method
                                                    rt.block_on(async {
                                                        if let Err(e) = svc.cleanup_evicted_group(&group_id_for_persist).await {
                                                            eprintln!("[MLS] Failed to cleanup evicted group: {}", e);
                                                        }
                                                    });
                                                }
                                                Some(true) => {
                                                    // Still a member, just update the UI
                                                    if let Some(handle) = TAURI_APP.get() {
                                                        handle.emit("mls_group_updated", serde_json::json!({
                                                            "group_id": group_id_for_persist
                                                        })).ok();
                                                    }
                                                }
                                                None => {
                                                    // Check failed - don't evict, just update UI
                                                    if let Some(handle) = TAURI_APP.get() {
                                                        handle.emit("mls_group_updated", serde_json::json!({
                                                            "group_id": group_id_for_persist
                                                        })).ok();
                                                    }
                                                }
                                            }
                                            None
                                        }
                                        mdk_core::prelude::MessageProcessingResult::Proposal(update) => {
                                            // MDK 0.8 SelfRemove auto-commit: publish + merge on the same
                                            // service that staged the commit (do not open a fresh MDK).
                                            let evolution = update.evolution_event;
                                            let mls_gid = update.mls_group_id;
                                            let leaver = ev.pubkey;
                                            let gid = group_id_for_persist.clone();
                                            drop(engine);
                                            rt.block_on(async {
                                                match svc
                                                    .publish_and_merge_auto_commit(
                                                        &gid,
                                                        &mls_gid,
                                                        &evolution,
                                                        Some(leaver),
                                                    )
                                                    .await
                                                {
                                                    Ok(()) => eprintln!(
                                                        "[MLS] Live: published and merged auto-commit leave for {} in {}",
                                                        leaver.to_hex(),
                                                        gid
                                                    ),
                                                    Err(e) => eprintln!(
                                                        "[MLS] Live: failed to publish/merge auto-commit leave for {} in {}: {}",
                                                        leaver.to_hex(),
                                                        gid,
                                                        e
                                                    ),
                                                }
                                            });
                                            None
                                        }
                                        mdk_core::prelude::MessageProcessingResult::Unprocessable { mls_group_id: _ } => {
                                            if let Some(reason) =
                                                crate::mls::mls_wrapper_failure_reason(ev.id.as_ref())
                                            {
                                                if reason.contains(crate::mls::MLS_LEAVE_PROPOSAL_FAILURE) {
                                                    let gid = group_id_for_persist.clone();
                                                    let leaver = ev.pubkey;
                                                    rt.block_on(async move {
                                                        if let Ok(svc) =
                                                            MlsService::new_persistent(&app_handle)
                                                        {
                                                            match svc
                                                                .finalize_voluntary_leave_as_admin(
                                                                    &gid, leaver,
                                                                )
                                                                .await
                                                            {
                                                                Ok(true) => eprintln!(
                                                                    "[MLS] Live: finalized voluntary leave for {} in {}",
                                                                    leaver.to_hex(),
                                                                    gid
                                                                ),
                                                                Ok(false) => {}
                                                                Err(e) => eprintln!(
                                                                    "[MLS] Live: failed to finalize voluntary leave for {} in {}: {}",
                                                                    leaver.to_hex(),
                                                                    gid,
                                                                    e
                                                                ),
                                                            }
                                                        }
                                                    });
                                                }
                                            }
                                            None
                                        }
                                        // Other message types (ExternalJoinProposal) are not persisted as chat messages
                                        _ => None,
                                    }
                                }
                                Err(e) => {
                                    let error_msg = e.to_string();

                                    // Check if this is an eviction error
                                    if error_msg.contains("evicted from it") ||
                                       error_msg.contains("after being evicted") ||
                                       error_msg.contains("own leaf not found") {
                                        eprintln!("[MLS] Eviction detected in live subscription - group: {}", group_id_for_persist);

                                        // Perform full cleanup using the helper method
                                        rt.block_on(async {
                                            if let Err(e) = svc.cleanup_evicted_group(&group_id_for_persist).await {
                                                eprintln!("[MLS] Failed to cleanup evicted group: {}", e);
                                            }
                                        });
                                    } else if !error_msg.contains("group not found") {
                                        eprintln!("[MLS] live process_message failed (id={}): {}", ev.id, error_msg);
                                    }
                                    None
                                }
                            }
                        })
                        .await
                        .unwrap_or(None);

                        if let Some(record) = emit_record {
                            // Emit UI event (include group_name so non-creators can update channel name from hash)
                            let group_name = db::load_mls_groups(&handle).await
                                .ok()
                                .and_then(|groups| {
                                    groups.into_iter()
                                        .find(|g| g.group_id == group_id_for_emit || g.engine_group_id == group_id_for_emit)
                                        .map(|g| g.name)
                                });
                            let _ = handle.emit("mls_message_new", serde_json::json!({
                                "group_id": group_id_for_emit,
                                "message": record,
                                "group_name": group_name
                            }));
                            db::apply_mls_virtual_bucket_side_effects(
                                &handle,
                                &group_id_for_emit,
                                record.virtual_bucket.as_deref(),
                                &record.content,
                                record.npub.as_deref(),
                            );
                            crate::cmds::chat::schedule_debounced_unread_recompute(handle.clone());
                        }
                    }
                }
            }
            Ok(false)
        })
        .await
    {
        Ok(_) => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}

/// Default relays that come pre-configured
pub(crate) const DEFAULT_RELAYS: &[&str] = &[
    "wss://jskitty.cat/nostr",        // also in the trusted relay set
    "wss://asia.vectorapp.io/nostr",  // also in the trusted relay set
    "wss://nostr.computingcache.com", // also in the trusted relay set
    "wss://relay.damus.io",           // Damus (popular)
    "wss://relay.primal.net",         // Primal (popular)
    "wss://nos.lol",                  // nos.lol (popular)
    "wss://relay.nostr.band",         // nostr.band (popular)
];

/// Metrics tracked per relay
#[derive(serde::Serialize, Clone, Debug)]
pub struct RelayMetrics {
    pub ping_ms: Option<u64>,
    pub bytes_up: u64,
    pub bytes_down: u64,
    pub last_check: Option<u64>, // Unix timestamp
    pub events_received: u64,
    pub events_sent: u64,
}

impl Default for RelayMetrics {
    fn default() -> Self {
        Self {
            ping_ms: None,
            bytes_up: 0,
            bytes_down: 0,
            last_check: None,
            events_received: 0,
            events_sent: 0,
        }
    }
}

/// A single log entry for a relay
#[derive(serde::Serialize, Clone, Debug)]
pub struct RelayLog {
    pub timestamp: u64, // Unix timestamp
    pub level: String,  // "info", "warn", "error"
    pub message: String,
}

/// Global storage for relay metrics
pub(crate) static RELAY_METRICS: Lazy<RwLock<HashMap<String, RelayMetrics>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

/// Global storage for relay logs (max 10 per relay)
pub(crate) static RELAY_LOGS: Lazy<RwLock<HashMap<String, VecDeque<RelayLog>>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

/// Global storage for classified relay connection failures, cleared on reconnect, removal,
/// disable, and logout. Never shown for a relay whose live status reads connected -- see the
/// read-side gate in `get_relays`.
pub(crate) static RELAY_FAILURES: Lazy<RwLock<HashMap<String, RelayFailure>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

/// Shared normalization for every diagnostic-static key: trim, strip a trailing slash, then
/// lowercase. `get_relays`'s pool-matching lowercases without stripping a trailing slash, so
/// that comparison must never be reused as a key source here.
pub(crate) fn normalize_relay_url(url: &str) -> String {
    url.trim().trim_end_matches('/').to_lowercase()
}

/// Serializes tests that clear a diagnostics static (`RELAY_FAILURES`, `RELAY_LOGS`,
/// `RELAY_METRICS`, `RELAY_CERTIFICATES`) so parallel `cargo test --lib` threads never race
/// clearing one another's fixtures. Test-only -- never touched by production code paths.
#[cfg(test)]
pub(crate) static DIAGNOSTICS_TEST_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

/// Store a classified failure for `url`, guarded by the login generation captured when the
/// caller (a monitor task) spawned. A mismatch means a stale monitor loop left running for a
/// previous account is writing -- skip rather than attribute the failure to the current one
/// (KTD9).
pub(crate) fn store_relay_failure_if_current(
    url: &str,
    failure: RelayFailure,
    captured_generation: u64,
) {
    if captured_generation != current_login_generation() {
        return;
    }
    if let Ok(mut failures) = RELAY_FAILURES.write() {
        failures.insert(normalize_relay_url(url), failure);
    }
}

/// Clear any stored failure reason for `url`. Reconnect-to-Connected, relay removal, relay
/// disable, and logout all route through this.
pub(crate) fn clear_relay_failure(url: &str) {
    if let Ok(mut failures) = RELAY_FAILURES.write() {
        failures.remove(&normalize_relay_url(url));
    }
}

/// Generation-guarded clear used by monitor tasks. User-initiated remove/disable/logout
/// keep calling the unguarded [`clear_relay_failure`] so the operator's own action still
/// takes effect after a generation change.
pub(crate) fn clear_relay_failure_if_current(url: &str, captured_generation: u64) {
    if captured_generation != current_login_generation() {
        return;
    }
    clear_relay_failure(url);
}

/// Add a log entry for a relay. Monitor tasks must call [`add_relay_log_if_current`]
/// instead so a stale first-account loop cannot fill the current account's panel.
pub(crate) fn add_relay_log(url: &str, level: &str, message: &str) {
    let normalized = normalize_relay_url(url);
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let log = RelayLog {
        timestamp,
        level: level.to_string(),
        message: message.to_string(),
    };

    if let Ok(mut logs) = RELAY_LOGS.write() {
        let relay_logs = logs.entry(normalized).or_insert_with(VecDeque::new);
        let is_repeat = relay_logs
            .front()
            .is_some_and(|last| last.level == log.level && last.message == log.message);
        if is_repeat {
            return;
        }
        relay_logs.push_front(log);
        // Keep only last 10 logs
        while relay_logs.len() > 10 {
            relay_logs.pop_back();
        }
    }
}

pub(crate) fn add_relay_log_if_current(
    url: &str,
    level: &str,
    message: &str,
    captured_generation: u64,
) {
    if captured_generation != current_login_generation() {
        return;
    }
    add_relay_log(url, level, message);
}

/// Update metrics for a relay. Monitor tasks must call [`update_relay_metrics_if_current`].
pub(crate) fn update_relay_metrics(url: &str, update_fn: impl FnOnce(&mut RelayMetrics)) {
    let normalized = normalize_relay_url(url);
    if let Ok(mut metrics) = RELAY_METRICS.write() {
        let relay_metrics = metrics
            .entry(normalized)
            .or_insert_with(RelayMetrics::default);
        update_fn(relay_metrics);
    }
}

pub(crate) fn update_relay_metrics_if_current(
    url: &str,
    captured_generation: u64,
    update_fn: impl FnOnce(&mut RelayMetrics),
) {
    if captured_generation != current_login_generation() {
        return;
    }
    update_relay_metrics(url, update_fn);
}

/// Approximate wire size of an event via its serialized JSON length.
pub(crate) fn event_size(event: &Event) -> u64 {
    nostr_sign::event_json(event).len() as u64
}

/// Record that a relay delivered an event: increments `events_received` and adds the
/// event's serialized size to `bytes_down`.
pub(crate) fn record_event_received(relay_url: &str, event: &Event) {
    let size = event_size(event);
    update_relay_metrics(relay_url, |m| {
        m.events_received += 1;
        m.bytes_down += size;
    });
}

/// Record the outcome of publishing an event: increments `events_sent`/`bytes_up` for each
/// accepted relay, and logs the rejection reason for each relay that rejected it. Called at
/// each `send_event`/`send_event_to` call site with the `Output` those calls already return —
/// not hooked into the notification stream, since sent events aren't tracked in the local DB.
pub(crate) fn record_send_outcome(event: &Event, output: &Output<EventId>) {
    let size = event_size(event);
    for relay_url in &output.success {
        let url = relay_url.to_string();
        update_relay_metrics(&url, |m| {
            m.events_sent += 1;
            m.bytes_up += size;
        });
    }
    for (relay_url, reason) in &output.failed {
        add_relay_log(&relay_url.to_string(), "warn", reason);
    }
}

/// Stable, snake_case reason code for a failed relay connection attempt. Closed set so the
/// frontend owns all user-facing wording (KTD3) -- adding an outcome is a protocol change,
/// not a string tweak. `auth_required` and `not_a_relay` are produced by the probe's query
/// path (U3), never by this classifier.
#[derive(serde::Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RelayFailureCode {
    DnsFailed,
    ConnectionRefused,
    NetworkUnreachable,
    TimedOut,
    TlsFailed,
    ProtocolError,
    AuthRequired,
    NotARelay,
    InvalidUrl,
    Unknown,
}

/// A classified relay failure: a stable code plus an optional redacted, length-capped detail
/// string. The detail is diagnostic context only -- callers must never derive control flow
/// from it, only from `code`.
#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
pub struct RelayFailure {
    pub code: RelayFailureCode,
    pub detail: Option<String>,
}

/// Cap on the redacted detail string stored alongside a `RelayFailure`. A failed WebSocket
/// upgrade can carry a full relay-controlled rejection body, so this is applied before
/// redaction, not just before display.
pub(crate) const RELAY_FAILURE_DETAIL_CAP: usize = 200;

/// Truncate to at most `cap` bytes on a UTF-8 boundary, then redact any embedded relay URL.
pub(crate) fn cap_and_redact_detail(raw: &str, cap: usize) -> String {
    let truncated = if raw.len() > cap {
        let mut end = cap;
        while end > 0 && !raw.is_char_boundary(end) {
            end -= 1;
        }
        &raw[..end]
    } else {
        raw
    };
    evm::wallet_security::redact_urls_in_text(truncated)
}

/// Map a `std::io::ErrorKind` shared by both `async_wsocket::Error::Io` and the `Io` variant
/// nested inside `tungstenite::Error` -- a mid-upgrade reset is a transport failure, not a
/// TLS one, so both paths go through this same mapping. Resolver failures never produce
/// `NotFound`, so it is deliberately left unmapped here and falls to `Unknown` (KTD2).
pub(crate) fn classify_io_kind(kind: std::io::ErrorKind) -> RelayFailureCode {
    use std::io::ErrorKind;
    match kind {
        ErrorKind::ConnectionRefused => RelayFailureCode::ConnectionRefused,
        // The only resolution-related kind async-wsocket produces; a bare DNS failure
        // surfaces as the unstable, non-matchable `Uncategorized` and is not reachable here.
        ErrorKind::AddrNotAvailable => RelayFailureCode::DnsFailed,
        ErrorKind::TimedOut => RelayFailureCode::TimedOut,
        ErrorKind::HostUnreachable | ErrorKind::NetworkUnreachable | ErrorKind::NetworkDown => {
            RelayFailureCode::NetworkUnreachable
        }
        _ => RelayFailureCode::Unknown,
    }
}

/// Map the `tungstenite::Error` nested inside `async_wsocket::Error::Ws`, matched on the
/// inner variant rather than the whole `Ws(_)` wrapper.
pub(crate) fn classify_tungstenite_error(err: &tungstenite::Error) -> RelayFailureCode {
    match err {
        tungstenite::Error::Tls(_) => RelayFailureCode::TlsFailed,
        // tokio-tungstenite's rustls backend never returns `tungstenite::Error::Tls` for a
        // failed client handshake -- `tokio-rustls` surfaces a rejected/expired/mismatched
        // certificate (and any other TLS record-processing failure) as
        // `io::Error::new(io::ErrorKind::InvalidData, rustls::Error)`, which
        // `client_async_tls` then wraps as `tungstenite::Error::Io`. Verified against the
        // vendored tokio-rustls 0.26 source (`common/mod.rs`) and a real loopback handshake
        // against an expired certificate (see the relay_cert containment regression test).
        tungstenite::Error::Io(e) if e.kind() == std::io::ErrorKind::InvalidData => {
            RelayFailureCode::TlsFailed
        }
        tungstenite::Error::Io(e) => classify_io_kind(e.kind()),
        tungstenite::Error::Protocol(_)
        | tungstenite::Error::Capacity(_)
        | tungstenite::Error::Http(_)
        | tungstenite::Error::HttpFormat(_) => RelayFailureCode::ProtocolError,
        tungstenite::Error::Url(_) => RelayFailureCode::InvalidUrl,
        _ => RelayFailureCode::Unknown,
    }
}

/// Map the `async_wsocket::Error` reached by downcasting `TransportError::Backend`.
pub(crate) fn classify_async_wsocket_error(err: &async_wsocket::Error) -> RelayFailureCode {
    match err {
        async_wsocket::Error::Io(e) => classify_io_kind(e.kind()),
        async_wsocket::Error::Timeout => RelayFailureCode::TimedOut,
        async_wsocket::Error::Url(_) => RelayFailureCode::InvalidUrl,
        async_wsocket::Error::Ws(e) => classify_tungstenite_error(e),
        _ => RelayFailureCode::Unknown,
    }
}

/// Classify a relay connection failure into a stable code plus an optional redacted detail.
/// Never walks `source()` -- `async_wsocket::Error`'s `Error` impl is empty, so that walk
/// always yields `None`. The typed downcast through `TransportError::Backend` is the only
/// route that survives the async-wsocket crate boundary (KTD2).
pub(crate) fn classify_relay_error(err: &nostr_sdk::pool::relay::Error) -> RelayFailure {
    use nostr_sdk::pool::relay::Error as RelayError;
    use nostr_sdk::pool::transport::error::TransportError;

    let code = match err {
        RelayError::Transport(TransportError::Backend(b)) => b
            .downcast_ref::<async_wsocket::Error>()
            .map(classify_async_wsocket_error)
            .unwrap_or(RelayFailureCode::Unknown),
        _ => RelayFailureCode::Unknown,
    };
    let detail = Some(cap_and_redact_detail(
        &err.to_string(),
        RELAY_FAILURE_DETAIL_CAP,
    ));
    RelayFailure { code, detail }
}

#[cfg(test)]
mod relay_failure_classifier_tests {
    use super::{
        cap_and_redact_detail, classify_relay_error, RelayFailureCode, RELAY_FAILURE_DETAIL_CAP,
    };
    use nostr_sdk::pool::relay::Error as RelayError;
    use nostr_sdk::pool::transport::error::TransportError;
    use nostr_sdk::{RelayOptions, RelayPool};
    use std::io;
    use std::time::Duration;

    fn transport_err(inner: async_wsocket::Error) -> RelayError {
        RelayError::Transport(TransportError::backend(inner))
    }

    #[test]
    fn io_connection_refused_maps_to_connection_refused() {
        let err = transport_err(async_wsocket::Error::Io(io::Error::from(
            io::ErrorKind::ConnectionRefused,
        )));
        assert_eq!(
            classify_relay_error(&err).code,
            RelayFailureCode::ConnectionRefused
        );
    }

    #[test]
    fn io_addr_not_available_maps_to_dns_failed() {
        let err = transport_err(async_wsocket::Error::Io(io::Error::from(
            io::ErrorKind::AddrNotAvailable,
        )));
        assert_eq!(classify_relay_error(&err).code, RelayFailureCode::DnsFailed);
    }

    #[test]
    fn io_timed_out_maps_to_timed_out() {
        let err = transport_err(async_wsocket::Error::Io(io::Error::from(
            io::ErrorKind::TimedOut,
        )));
        assert_eq!(classify_relay_error(&err).code, RelayFailureCode::TimedOut);
    }

    #[test]
    fn io_unreachable_kinds_map_to_network_unreachable() {
        for kind in [
            io::ErrorKind::HostUnreachable,
            io::ErrorKind::NetworkUnreachable,
            io::ErrorKind::NetworkDown,
        ] {
            let err = transport_err(async_wsocket::Error::Io(io::Error::from(kind)));
            assert_eq!(
                classify_relay_error(&err).code,
                RelayFailureCode::NetworkUnreachable,
                "kind {kind:?} should map to network_unreachable"
            );
        }
    }

    #[test]
    fn async_wsocket_timeout_variant_maps_to_timed_out() {
        let err = transport_err(async_wsocket::Error::Timeout);
        assert_eq!(classify_relay_error(&err).code, RelayFailureCode::TimedOut);
    }

    #[test]
    fn async_wsocket_url_variant_maps_to_invalid_url() {
        let err = transport_err(async_wsocket::Error::Url(url::ParseError::EmptyHost));
        assert_eq!(
            classify_relay_error(&err).code,
            RelayFailureCode::InvalidUrl
        );
    }

    #[test]
    fn ws_tls_error_maps_to_tls_failed() {
        let ws_err = tungstenite::Error::Tls(tungstenite::error::TlsError::InvalidDnsName);
        let err = transport_err(async_wsocket::Error::Ws(ws_err));
        assert_eq!(classify_relay_error(&err).code, RelayFailureCode::TlsFailed);
    }

    #[test]
    fn ws_io_error_maps_to_kind_code_not_tls_failed() {
        let ws_err = tungstenite::Error::Io(io::Error::from(io::ErrorKind::ConnectionRefused));
        let err = transport_err(async_wsocket::Error::Ws(ws_err));
        let code = classify_relay_error(&err).code;
        assert_eq!(code, RelayFailureCode::ConnectionRefused);
        assert_ne!(code, RelayFailureCode::TlsFailed);
    }

    #[test]
    fn ws_invalid_data_io_error_maps_to_tls_failed() {
        // tokio-rustls surfaces a rejected/expired certificate as
        // `io::Error::new(io::ErrorKind::InvalidData, rustls::Error)`, not as
        // `tungstenite::Error::Tls`. Proven end-to-end by the relay_cert containment
        // regression test against a real expired-certificate loopback listener.
        let ws_err = tungstenite::Error::Io(io::Error::from(io::ErrorKind::InvalidData));
        let err = transport_err(async_wsocket::Error::Ws(ws_err));
        assert_eq!(classify_relay_error(&err).code, RelayFailureCode::TlsFailed);
    }

    #[test]
    fn ws_protocol_error_maps_to_protocol_error() {
        let ws_err =
            tungstenite::Error::Protocol(tungstenite::error::ProtocolError::WrongHttpMethod);
        let err = transport_err(async_wsocket::Error::Ws(ws_err));
        assert_eq!(
            classify_relay_error(&err).code,
            RelayFailureCode::ProtocolError
        );
    }

    #[test]
    fn ws_unmatched_variant_maps_to_unknown_without_panicking() {
        let ws_err = tungstenite::Error::AlreadyClosed;
        let err = transport_err(async_wsocket::Error::Ws(ws_err));
        assert_eq!(classify_relay_error(&err).code, RelayFailureCode::Unknown);
    }

    #[test]
    fn non_transport_variant_maps_to_unknown_without_panicking() {
        let err = RelayError::NotConnected;
        assert_eq!(classify_relay_error(&err).code, RelayFailureCode::Unknown);
    }

    #[test]
    fn detail_over_cap_is_truncated_before_storage() {
        let raw = "x".repeat(RELAY_FAILURE_DETAIL_CAP + 500);
        let capped = cap_and_redact_detail(&raw, RELAY_FAILURE_DETAIL_CAP);
        assert!(capped.len() <= RELAY_FAILURE_DETAIL_CAP);
    }

    #[test]
    fn detail_wss_url_with_non_allowlisted_param_is_redacted() {
        let raw = "rejected by wss://relay.example.com/?t=SECRET during upgrade";
        let capped = cap_and_redact_detail(raw, RELAY_FAILURE_DETAIL_CAP);
        assert!(!capped.contains("SECRET"));
    }

    /// The only test proving the typed downcast survives the async-wsocket crate boundary:
    /// a real `Relay::try_connect` against a closed loopback port, driven through the actual
    /// relay-pool connection path rather than a locally constructed error.
    #[tokio::test]
    async fn try_connect_against_closed_port_classifies_connection_refused() {
        // Bind then immediately drop so the OS guarantees the port refuses new connections,
        // unlike a bare unused ephemeral port which could collide with something else.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind loopback");
        let port = listener.local_addr().expect("local addr").port();
        drop(listener);

        let pool = RelayPool::new();
        let url = format!("ws://127.0.0.1:{port}");
        pool.add_relay(&url, RelayOptions::new().reconnect(false))
            .await
            .expect("add_relay");
        let relay = pool.relay(&url).await.expect("relay handle");

        let err = relay
            .try_connect(Duration::from_secs(5))
            .await
            .expect_err("connecting to a closed port must fail");

        assert_eq!(
            classify_relay_error(&err).code,
            RelayFailureCode::ConnectionRefused
        );

        pool.shutdown().await;
    }
}

/// Single deadline covering DNS resolution, connect, and the query round-trip
/// together (R13). This is the only bound an operator actually observes.
pub(crate) const PROBE_DEADLINE: std::time::Duration = std::time::Duration::from_secs(10);

/// Deliberately far larger than `PROBE_DEADLINE`. The relay-pool crate's own
/// per-call timeout is not optional, so it is set here to a value that can
/// never legitimately win a race against the probe's own outer deadline --
/// otherwise a genuine end-of-stored-events response and true silence would
/// both surface as `Ok(Events::empty())` and become indistinguishable.
pub(crate) const PROBE_INNER_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3600);

/// Result of a pre-add relay probe (F1). `round_trip_ms` is present only when
/// the candidate answered; a failure carries the classified reason and never a
/// round-trip measurement.
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum ProbeResult {
    Reachable { round_trip_ms: u64 },
    Unreachable { failure: RelayFailure },
}

impl ProbeResult {
    fn failure(code: RelayFailureCode) -> Self {
        ProbeResult::Unreachable {
            failure: RelayFailure { code, detail: None },
        }
    }
}

/// Classify a `pool::Error` surfaced by the throwaway probe pool: unwrap the
/// `Relay(..)` variant into U1's classifier, and map every other pool-level
/// variant (bad URL, pool shutdown, relay not found, ...) to `unknown` -- none
/// of them carry connectivity meaning (KTD2).
pub(crate) fn classify_probe_pool_error(err: &nostr_sdk::pool::pool::Error) -> RelayFailure {
    match err {
        nostr_sdk::pool::pool::Error::Relay(inner) => classify_relay_error(inner),
        other => RelayFailure {
            code: RelayFailureCode::Unknown,
            detail: Some(cap_and_redact_detail(
                &other.to_string(),
                RELAY_FAILURE_DETAIL_CAP,
            )),
        },
    }
}

/// Remove the candidate relay from the throwaway pool on every explicit exit
/// path (R6). The deadline-cancellation path relies on `RelayPool`'s own
/// `Drop` instead, since a cancelled future never reaches this call.
pub(crate) async fn teardown_probe_pool(pool: &RelayPool, url: &str) {
    let _ = pool.force_remove_relay(url).await;
}

/// Resolve, connect through a throwaway pool, and run one bounded read-only
/// query. Never touches `get_nostr_client()` and never writes to the
/// candidate. The caller wraps this in the probe's single deadline; on
/// success it returns the query's elapsed milliseconds.
pub(crate) async fn run_relay_probe(
    url: &str,
    handshake_done: &std::sync::atomic::AtomicBool,
) -> Result<u64, RelayFailure> {
    // Resolve the host explicitly -- the only typed route to `dns_failed`;
    // inside the monitor loops a resolver failure arrives as the unstable,
    // non-matchable `io::ErrorKind::Uncategorized` (KTD2).
    let parsed = url::Url::parse(url).map_err(|_| RelayFailure {
        code: RelayFailureCode::InvalidUrl,
        detail: None,
    })?;
    let host = parsed.host_str().ok_or(RelayFailure {
        code: RelayFailureCode::InvalidUrl,
        detail: None,
    })?;
    let port = parsed.port_or_known_default().unwrap_or(443);
    let mut addrs = match tokio::net::lookup_host((host, port)).await {
        Ok(addrs) => addrs,
        Err(_) => {
            return Err(RelayFailure {
                code: RelayFailureCode::DnsFailed,
                detail: None,
            })
        }
    };
    if addrs.next().is_none() {
        return Err(RelayFailure {
            code: RelayFailureCode::DnsFailed,
            detail: None,
        });
    }

    let pool = RelayPool::new();

    if let Err(e) = pool
        .add_relay(url, RelayOptions::new().reconnect(false))
        .await
    {
        let failure = classify_probe_pool_error(&e);
        teardown_probe_pool(&pool, url).await;
        return Err(failure);
    }

    if let Err(e) = pool.try_connect_relay(url, PROBE_INNER_TIMEOUT).await {
        let failure = classify_probe_pool_error(&e);
        teardown_probe_pool(&pool, url).await;
        return Err(failure);
    }
    handshake_done.store(true, std::sync::atomic::Ordering::SeqCst);

    let relay = match pool.relay(url).await {
        Ok(relay) => relay,
        Err(e) => {
            let failure = classify_probe_pool_error(&e);
            teardown_probe_pool(&pool, url).await;
            return Err(failure);
        }
    };

    // One bounded read-only query -- never a write. An end-of-stored-events
    // response confirms the relay; a close-with-reason answer is
    // `auth_required`; total silence is caught by the caller's outer deadline.
    let filter = Filter::new().kinds(vec![Kind::Metadata]).limit(1);
    let started = std::time::Instant::now();
    let query_result = relay
        .fetch_events(filter, PROBE_INNER_TIMEOUT, ReqExitPolicy::ExitOnEOSE)
        .await;
    let round_trip_ms = started.elapsed().as_millis() as u64;

    teardown_probe_pool(&pool, url).await;
    drop(pool);

    match query_result {
        Ok(_events) => Ok(round_trip_ms),
        Err(nostr_sdk::pool::relay::Error::RelayMessage(_))
        | Err(nostr_sdk::pool::relay::Error::AuthenticationFailed) => Err(RelayFailure {
            code: RelayFailureCode::AuthRequired,
            detail: None,
        }),
        Err(e) => Err(RelayFailure {
            code: RelayFailureCode::Unknown,
            detail: Some(cap_and_redact_detail(
                &e.to_string(),
                RELAY_FAILURE_DETAIL_CAP,
            )),
        }),
    }
}

/// Pre-add relay probe (Tauri command): validate, resolve, connect through a
/// throwaway pool, and run one read-only query round-trip, all under a single
/// 10-second deadline. Never joins the operator's live pool and writes
/// nothing to the candidate relay (R4, R5, R6, R7, R13).
#[tauri::command]
pub(crate) async fn probe_relay(url: String) -> Result<ProbeResult, String> {
    let normalized = match validate_relay_url(&url) {
        Ok(normalized) => normalized,
        Err(_) => return Ok(ProbeResult::failure(RelayFailureCode::InvalidUrl)),
    };

    let handshake_done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let handshake_done_for_probe = handshake_done.clone();
    match tokio::time::timeout(
        PROBE_DEADLINE,
        run_relay_probe(&normalized, &handshake_done_for_probe),
    )
    .await
    {
        Ok(Ok(round_trip_ms)) => Ok(ProbeResult::Reachable { round_trip_ms }),
        Ok(Err(failure)) => Ok(ProbeResult::Unreachable { failure }),
        // Silence after a completed handshake is `not_a_relay`. A deadline that
        // fires earlier -- DNS, TCP, TLS, or upgrade still in flight -- is
        // `timed_out`.
        Err(_) => {
            let code = if handshake_done.load(std::sync::atomic::Ordering::SeqCst) {
                RelayFailureCode::NotARelay
            } else {
                RelayFailureCode::TimedOut
            };
            Ok(ProbeResult::failure(code))
        }
    }
}

/// Certificate metadata plus a freshly computed expiry verdict for the wire.
/// The verdict is never cached alongside the certificate (`relay_cert`'s
/// cache holds only the time-invariant parse result) -- it is recomputed
/// against the current time on every call, so a certificate served from
/// cache still reports an up-to-date expiry state (KTD10).
#[derive(serde::Serialize)]
pub(crate) struct RelayCertificateView {
    #[serde(flatten)]
    certificate: relay_cert::RelayCertificate,
    expiry_verdict: relay_cert::ExpiryVerdict,
}

/// Fetches the certificate a `wss://` relay presents over an isolated TLS
/// handshake (`relay_cert`), never the app's own connection. `Ok(None)`
/// covers every case that isn't "here is a certificate" -- a `ws://` URL, an
/// unreachable host, and a stalled handshake past its deadline are all
/// indistinguishable to the panel, so none of them is surfaced as `Err`.
#[tauri::command]
pub(crate) async fn get_relay_certificate(
    url: String,
) -> Result<Option<RelayCertificateView>, String> {
    let Some(certificate) = relay_cert::fetch_certificate(&url).await else {
        return Ok(None);
    };
    let now_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let expiry_verdict = relay_cert::expiry_verdict(certificate.not_after, now_unix);
    Ok(Some(RelayCertificateView {
        certificate,
        expiry_verdict,
    }))
}

#[cfg(test)]
mod probe_relay_tests {
    use super::{probe_relay, ProbeResult, RelayFailureCode};

    #[tokio::test]
    async fn invalid_url_returns_immediately_with_no_network_attempt() {
        let started = std::time::Instant::now();
        let result = probe_relay("not a url".to_string()).await.unwrap();
        assert!(
            started.elapsed() < std::time::Duration::from_millis(500),
            "invalid_url must short-circuit before any connection attempt"
        );
        match result {
            ProbeResult::Unreachable { failure } => {
                assert_eq!(failure.code, RelayFailureCode::InvalidUrl);
            }
            ProbeResult::Reachable { .. } => panic!("expected an invalid_url failure"),
        }
    }

    #[tokio::test]
    async fn public_ws_url_is_rejected_by_the_validator() {
        let result = probe_relay("ws://relay.example.com".to_string())
            .await
            .unwrap();
        match result {
            ProbeResult::Unreachable { failure } => {
                assert_eq!(failure.code, RelayFailureCode::InvalidUrl);
            }
            ProbeResult::Reachable { .. } => panic!("a public ws:// URL must be rejected"),
        }
    }

    #[tokio::test]
    async fn unresolvable_hostname_returns_dns_failed() {
        let result = probe_relay("wss://this-definitely-does-not-resolve.invalid".to_string())
            .await
            .unwrap();
        match result {
            ProbeResult::Unreachable { failure } => {
                assert_eq!(failure.code, RelayFailureCode::DnsFailed);
            }
            ProbeResult::Reachable { .. } => panic!("an unresolvable hostname must fail"),
        }
    }

    #[tokio::test]
    async fn closed_local_port_classifies_connection_refused() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind loopback");
        let port = listener.local_addr().expect("local addr").port();
        drop(listener);
        let url = format!("ws://127.0.0.1:{port}");

        // Run twice: if the throwaway pool or its connection ever leaked out
        // of `run_relay_probe`, a stale relay entry or hung socket would
        // either change the second call's classification or make it hang.
        for _ in 0..2 {
            let started = std::time::Instant::now();
            let result = probe_relay(url.clone()).await.unwrap();
            assert!(started.elapsed() < std::time::Duration::from_secs(5));
            match result {
                ProbeResult::Unreachable { failure } => {
                    assert_eq!(failure.code, RelayFailureCode::ConnectionRefused);
                }
                ProbeResult::Reachable { .. } => panic!("a closed port must fail to connect"),
            }
        }
    }

    /// Exercises the exact teardown call `run_relay_probe` uses on every exit
    /// path: after `force_remove_relay`, the pool holds no relay at all.
    #[tokio::test]
    async fn probe_pool_teardown_leaves_no_relay_registered() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind loopback");
        let port = listener.local_addr().expect("local addr").port();
        drop(listener);
        let url = format!("ws://127.0.0.1:{port}");

        let pool = nostr_sdk::RelayPool::new();
        pool.add_relay(&url, nostr_sdk::RelayOptions::new().reconnect(false))
            .await
            .expect("add_relay");
        let _ = pool
            .try_connect_relay(&url, std::time::Duration::from_secs(5))
            .await;
        let _ = pool.force_remove_relay(&url).await;

        assert_eq!(
            pool.relays().await.len(),
            0,
            "force_remove_relay must leave no relay registered"
        );
    }

    #[tokio::test]
    async fn each_failure_code_round_trips_through_the_dto_and_carries_no_round_trip_ms() {
        for code in [
            RelayFailureCode::DnsFailed,
            RelayFailureCode::ConnectionRefused,
            RelayFailureCode::NetworkUnreachable,
            RelayFailureCode::TimedOut,
            RelayFailureCode::TlsFailed,
            RelayFailureCode::ProtocolError,
            RelayFailureCode::AuthRequired,
            RelayFailureCode::NotARelay,
            RelayFailureCode::InvalidUrl,
            RelayFailureCode::Unknown,
        ] {
            let result = ProbeResult::failure(code);
            let json = serde_json::to_value(&result).unwrap();
            assert_eq!(json["outcome"], "unreachable");
            assert!(
                json.get("round_trip_ms").is_none(),
                "a failure DTO must never carry a round-trip measurement"
            );
            assert!(json["failure"]["code"].is_string());
        }

        let reachable =
            serde_json::to_value(&ProbeResult::Reachable { round_trip_ms: 42 }).unwrap();
        assert_eq!(reachable["outcome"], "reachable");
        assert_eq!(reachable["round_trip_ms"], 42);
    }

    #[tokio::test]
    async fn accept_then_stall_host_returns_within_the_deadline() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind loopback");
        let port = listener.local_addr().expect("local addr").port();

        // Accept and hold the connection open without ever completing a
        // WebSocket upgrade, so the probe genuinely has nothing to read.
        tokio::spawn(async move {
            if let Ok((_stream, _)) = listener.accept().await {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            }
        });

        let url = format!("ws://127.0.0.1:{port}");
        let started = std::time::Instant::now();
        let result = tokio::time::timeout(std::time::Duration::from_secs(12), probe_relay(url))
            .await
            .expect("probe_relay must return within its own 10s deadline")
            .unwrap();
        assert!(
            started.elapsed() < std::time::Duration::from_secs(12),
            "probe must honor its single 10-second deadline"
        );
        match result {
            ProbeResult::Unreachable { failure } => {
                assert_eq!(
                    failure.code,
                    RelayFailureCode::TimedOut,
                    "a host that accepts TCP but never completes the handshake is timed_out, not not_a_relay"
                );
            }
            ProbeResult::Reachable { .. } => panic!("a stalling host must fail"),
        }
    }
}

#[cfg(test)]
mod relay_metrics_tests {
    use super::{
        get_relay_logs, get_relay_metrics, record_event_received, record_send_outcome,
        DIAGNOSTICS_TEST_LOCK,
    };
    use crate::nostr_sign;
    use nostr_sdk::prelude::{EventBuilder, Keys, Kind, Output, RelayUrl};
    use std::collections::{HashMap, HashSet};

    fn test_event(content: &str) -> nostr_sdk::Event {
        nostr_sign::sign_with(
            EventBuilder::new(Kind::TextNote, content),
            &Keys::generate(),
        )
        .unwrap()
    }

    #[tokio::test]
    async fn accepted_relays_get_events_sent_and_bytes_up() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let event = test_event("published");
        let accepted = RelayUrl::parse("wss://test-send-outcome-accepted.example").unwrap();
        let output = Output {
            val: event.id,
            success: HashSet::from([accepted.clone()]),
            failed: HashMap::new(),
        };
        record_send_outcome(&event, &output);

        let metrics = get_relay_metrics(accepted.to_string()).await.unwrap();
        assert_eq!(metrics.events_sent, 1);
        assert_eq!(
            metrics.bytes_up,
            nostr_sign::event_json(&event).len() as u64
        );
    }

    #[tokio::test]
    async fn rejected_relays_get_a_warn_log_and_no_sent_count() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let event = test_event("rejected");
        let rejected = RelayUrl::parse("wss://test-send-outcome-rejected.example").unwrap();
        let output = Output {
            val: event.id,
            success: HashSet::new(),
            failed: HashMap::from([(rejected.clone(), "rate-limited".to_string())]),
        };
        record_send_outcome(&event, &output);

        let metrics = get_relay_metrics(rejected.to_string()).await.unwrap();
        assert_eq!(metrics.events_sent, 0);
        assert_eq!(metrics.bytes_up, 0);

        let logs = get_relay_logs(rejected.to_string()).await.unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].level, "warn");
        assert_eq!(logs[0].message, "rate-limited");
    }

    #[tokio::test]
    async fn multiple_accepted_relays_each_get_their_own_counters() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let event = test_event("fanout");
        let relay_a = RelayUrl::parse("wss://test-send-outcome-fanout-a.example").unwrap();
        let relay_b = RelayUrl::parse("wss://test-send-outcome-fanout-b.example").unwrap();
        let output = Output {
            val: event.id,
            success: HashSet::from([relay_a.clone(), relay_b.clone()]),
            failed: HashMap::new(),
        };
        record_send_outcome(&event, &output);

        let metrics_a = get_relay_metrics(relay_a.to_string()).await.unwrap();
        let metrics_b = get_relay_metrics(relay_b.to_string()).await.unwrap();
        assert_eq!(metrics_a.events_sent, 1);
        assert_eq!(metrics_b.events_sent, 1);
    }

    #[tokio::test]
    async fn accumulates_events_received_and_bytes_down_for_same_relay() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let url = "wss://test-record-received-accumulate.example";
        let event_a = test_event("first");
        let event_b = test_event("second, a little longer");
        record_event_received(url, &event_a);
        record_event_received(url, &event_b);

        let metrics = get_relay_metrics(url.to_string()).await.unwrap();
        assert_eq!(metrics.events_received, 2);
        assert_eq!(
            metrics.bytes_down,
            (nostr_sign::event_json(&event_a).len() + nostr_sign::event_json(&event_b).len())
                as u64
        );
    }

    #[tokio::test]
    async fn normalizes_relay_url_without_leaking_across_distinct_relays() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let canonical = "wss://test-record-received-normalize.example";
        let variant = "WSS://Test-Record-Received-Normalize.example/";
        let other = "wss://test-record-received-other.example";
        record_event_received(canonical, &test_event("one"));
        record_event_received(variant, &test_event("two"));
        record_event_received(other, &test_event("three"));

        let canonical_metrics = get_relay_metrics(canonical.to_string()).await.unwrap();
        let other_metrics = get_relay_metrics(other.to_string()).await.unwrap();
        assert_eq!(canonical_metrics.events_received, 2);
        assert_eq!(other_metrics.events_received, 1);
    }

    #[tokio::test]
    async fn get_relay_metrics_reflects_recorded_events() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let url = "wss://test-record-received-readpath.example";
        record_event_received(url, &test_event("readable"));

        let metrics = get_relay_metrics(url.to_string()).await.unwrap();
        assert_eq!(metrics.events_received, 1);
        assert!(metrics.bytes_down > 0);
    }

    #[tokio::test]
    async fn repeated_identical_send_failures_collapse_into_one_log_entry() {
        let _guard = DIAGNOSTICS_TEST_LOCK.lock();
        let rejected = RelayUrl::parse("wss://test-send-outcome-repeated-failure.example").unwrap();
        for i in 0..3 {
            let event = test_event(&format!("retry {i}"));
            let output = Output {
                val: event.id,
                success: HashSet::new(),
                failed: HashMap::from([(rejected.clone(), "rate-limited".to_string())]),
            };
            record_send_outcome(&event, &output);
        }

        let logs = get_relay_logs(rejected.to_string()).await.unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].message, "rate-limited");
    }
}

/// Get metrics for a relay
#[tauri::command]
pub(crate) async fn get_relay_metrics(url: String) -> Result<RelayMetrics, String> {
    let normalized = url.trim().trim_end_matches('/').to_lowercase();
    let metrics = RELAY_METRICS
        .read()
        .map_err(|_| "Failed to read metrics")?
        .get(&normalized)
        .cloned()
        .unwrap_or_default();
    Ok(metrics)
}

/// Get logs for a relay
#[tauri::command]
pub(crate) async fn get_relay_logs(url: String) -> Result<Vec<RelayLog>, String> {
    let normalized = url.trim().trim_end_matches('/').to_lowercase();
    let logs = RELAY_LOGS
        .read()
        .map_err(|_| "Failed to read logs")?
        .get(&normalized)
        .map(|l| l.iter().cloned().collect())
        .unwrap_or_default();
    Ok(logs)
}

#[derive(serde::Serialize)]
pub(crate) struct RelayInfo {
    pub(crate) url: String,
    pub(crate) status: String,
    pub(crate) is_default: bool,
    pub(crate) is_custom: bool,
    pub(crate) enabled: bool,
    pub(crate) mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) failure_reason: Option<RelayFailure>,
}

/// Read-side gate for R3: a stored failure reason is never surfaced for a relay whose live
/// status resolves to connected, regardless of how the write side raced the real transition
/// (KTD8). Looks up through the shared normalization so a trailing-slash mismatch between the
/// stored key and the caller's URL never misses.
pub(crate) fn relay_failure_for(url: &str, status: &str) -> Option<RelayFailure> {
    if status == "connected" {
        return None;
    }
    RELAY_FAILURES
        .read()
        .ok()
        .and_then(|failures| failures.get(&normalize_relay_url(url)).cloned())
}

/// Get all relays with their current status
#[tauri::command]
pub(crate) async fn get_relays<R: Runtime>(handle: AppHandle<R>) -> Result<Vec<RelayInfo>, String> {
    let client = get_nostr_client().map_err(|_| "Nostr client not initialized")?;

    // Get custom relays from DB
    let custom_relays = get_custom_relays(handle.clone()).await.unwrap_or_default();
    let disabled_defaults = get_disabled_default_relays(&handle)
        .await
        .unwrap_or_default();

    // Get all connected relays from client pool
    let pool_relays = client.relays().await;

    let mut relay_infos: Vec<RelayInfo> = Vec::new();

    // First, add all default relays (even if disabled). Under a debug relay
    // override they are never connected, so listing them would misreport a
    // sandbox's real exposure.
    let listed_defaults: &[&str] = if crate::trusted_relays::is_overridden() {
        &[]
    } else {
        DEFAULT_RELAYS
    };
    for default_url in listed_defaults {
        let url_str = default_url.to_string();
        let is_disabled = disabled_defaults
            .iter()
            .any(|d| d.to_lowercase() == url_str.to_lowercase());

        // Check if this relay is in the pool
        let (status, mode) = if let Some((_, relay)) = pool_relays
            .iter()
            .find(|(u, _)| u.to_string().to_lowercase() == url_str.to_lowercase())
        {
            let status = match relay.status() {
                RelayStatus::Initialized => "initialized",
                RelayStatus::Pending => "pending",
                RelayStatus::Connecting => "connecting",
                RelayStatus::Connected => "connected",
                RelayStatus::Disconnected => "disconnected",
                RelayStatus::Terminated => "terminated",
                RelayStatus::Banned => "banned",
                RelayStatus::Sleeping => "sleeping",
            };
            (status.to_string(), "both".to_string())
        } else {
            ("disabled".to_string(), "both".to_string())
        };

        let failure_reason = relay_failure_for(&url_str, &status);
        relay_infos.push(RelayInfo {
            url: url_str,
            status,
            is_default: true,
            is_custom: false,
            enabled: !is_disabled,
            mode,
            failure_reason,
        });
    }

    // Then add custom relays
    for custom in &custom_relays {
        // Check if this relay is in the pool
        let status = if let Some((_, relay)) = pool_relays
            .iter()
            .find(|(u, _)| u.to_string().to_lowercase() == custom.url.to_lowercase())
        {
            match relay.status() {
                RelayStatus::Initialized => "initialized",
                RelayStatus::Pending => "pending",
                RelayStatus::Connecting => "connecting",
                RelayStatus::Connected => "connected",
                RelayStatus::Disconnected => "disconnected",
                RelayStatus::Terminated => "terminated",
                RelayStatus::Banned => "banned",
                RelayStatus::Sleeping => "sleeping",
            }
            .to_string()
        } else {
            "disabled".to_string()
        };

        let failure_reason = relay_failure_for(&custom.url, &status);
        relay_infos.push(RelayInfo {
            url: custom.url.clone(),
            status,
            is_default: false,
            is_custom: true,
            enabled: custom.enabled,
            mode: custom.mode.clone(),
            failure_reason,
        });
    }

    Ok(relay_infos)
}

/// Get the list of Blossom media servers (Tauri command)
#[tauri::command]
pub(crate) async fn get_media_servers() -> Vec<String> {
    get_blossom_media_servers()
}

/// Saved custom relay entry with optional metadata
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub(crate) struct CustomRelay {
    pub(crate) url: String,
    pub(crate) enabled: bool,
    #[serde(default = "default_relay_mode")]
    pub(crate) mode: String, // "read" | "write" | "both"
}

pub(crate) fn default_relay_mode() -> String {
    "both".to_string()
}

/// Validate a relay URL format. Secure WebSockets (`wss://`) are required for
/// public relays; insecure `ws://` is allowed only for local development hosts
/// so containers like the pacto dev-setup relay can be used without TLS.
pub(crate) fn validate_relay_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    let parsed = url::Url::parse(trimmed).map_err(|_| {
        "Relay URL must start with wss:// (ws:// is allowed only for localhost/127.0.0.1 development relays)".to_string()
    })?;

    let host = parsed
        .host_str()
        .ok_or_else(|| "Relay URL must include a host".to_string())?;

    match parsed.scheme() {
        "wss" => {}
        "ws" => {
            let is_localhost = host == "localhost";
            let is_loopback_with_port = host == "127.0.0.1" && parsed.port().is_some();
            if !is_localhost && !is_loopback_with_port {
                return Err("Relay URL must start with wss:// (ws:// is allowed only for localhost/127.0.0.1 development relays)".to_string());
            }
        }
        _ => {
            return Err("Relay URL must start with wss:// (ws:// is allowed only for localhost/127.0.0.1 development relays)".to_string());
        }
    }

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Relay URL must not contain userinfo".to_string());
    }

    let normalized = trimmed.trim_end_matches('/');
    Ok(normalized.to_string())
}

/// Get the list of custom relays from settings
#[tauri::command]
pub(crate) async fn get_custom_relays<R: Runtime>(
    handle: AppHandle<R>,
) -> Result<Vec<CustomRelay>, String> {
    // Check if an account is selected
    if crate::account_manager::get_current_account().is_err() {
        return Ok(vec![]);
    }

    let conn = crate::account_manager::get_db_connection(&handle)?;

    let result: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params!["custom_relays"],
            |row| row.get(0),
        )
        .ok();

    crate::account_manager::return_db_connection(conn);

    match result {
        Some(json_str) => serde_json::from_str(&json_str)
            .map_err(|e| format!("Failed to parse custom relays: {}", e)),
        None => Ok(vec![]),
    }
}

/// Get the list of disabled default relays from settings
pub(crate) async fn get_disabled_default_relays<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<Vec<String>, String> {
    if crate::account_manager::get_current_account().is_err() {
        return Ok(vec![]);
    }

    let conn = crate::account_manager::get_db_connection(handle)?;

    let result: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params!["disabled_default_relays"],
            |row| row.get(0),
        )
        .ok();

    crate::account_manager::return_db_connection(conn);

    match result {
        Some(json_str) => serde_json::from_str(&json_str)
            .map_err(|e| format!("Failed to parse disabled default relays: {}", e)),
        None => Ok(vec![]),
    }
}

/// Toggle a default relay's enabled state
#[tauri::command]
pub(crate) async fn toggle_default_relay<R: Runtime>(
    handle: AppHandle<R>,
    url: String,
    enabled: bool,
) -> Result<bool, String> {
    // Verify it's actually a default relay
    if !is_default_relay(&url) {
        return Err("Not a default relay".to_string());
    }

    let normalized_url = url.trim().trim_end_matches('/').to_string();
    let mut disabled = get_disabled_default_relays(&handle).await?;

    if enabled {
        // Remove from disabled list
        disabled.retain(|d| d.to_lowercase() != normalized_url.to_lowercase());
    } else {
        // Add to disabled list if not already there
        if !disabled
            .iter()
            .any(|d| d.to_lowercase() == normalized_url.to_lowercase())
        {
            disabled.push(normalized_url.clone());
        }
    }

    save_disabled_default_relays(&handle, &disabled).await?;

    // Update the relay pool
    if let Ok(client) = get_nostr_client() {
        if enabled {
            // Re-add the relay
            match client
                .pool()
                .add_relay(&normalized_url, RelayOptions::new().reconnect(false))
                .await
            {
                Ok(_) => {
                    let _ = client.pool().connect_relay(&normalized_url).await;
                    println!("[Relay] Enabled default relay: {}", normalized_url);
                }
                Err(e) => eprintln!("[Relay] Failed to enable default relay: {}", e),
            }
        } else {
            // Remove the relay from pool
            clear_relay_failure(&normalized_url);
            if let Err(e) = client.pool().remove_relay(&normalized_url).await {
                eprintln!(
                    "[Relay] Note: Could not disable default relay in pool: {}",
                    e
                );
            } else {
                println!("[Relay] Disabled default relay: {}", normalized_url);
            }
        }
    }

    Ok(true)
}

/// Add a custom relay URL
#[tauri::command]
pub(crate) async fn add_custom_relay<R: Runtime>(
    handle: AppHandle<R>,
    url: String,
    mode: Option<String>,
) -> Result<CustomRelay, String> {
    // Validate and normalize the URL
    let normalized_url = validate_relay_url(&url)?;

    // Validate mode
    let relay_mode = mode.unwrap_or_else(|| "both".to_string());
    if !["read", "write", "both"].contains(&relay_mode.as_str()) {
        return Err("Invalid mode. Must be 'read', 'write', or 'both'".to_string());
    }

    // Get existing relays
    let mut relays = get_custom_relays(handle.clone()).await?;

    // Check for duplicates (case-insensitive)
    let url_lower = normalized_url.to_lowercase();
    if relays.iter().any(|r| r.url.to_lowercase() == url_lower) {
        return Err("Relay already exists".to_string());
    }

    // Don't allow adding default relays as custom
    if is_default_relay(&normalized_url) {
        return Err("Cannot add default relay as custom relay".to_string());
    }

    // Create new relay entry
    let new_relay = CustomRelay {
        url: normalized_url,
        enabled: true,
        mode: relay_mode.clone(),
    };

    relays.push(new_relay.clone());

    // Save to settings
    save_custom_relays(&handle, &relays).await?;

    // If we're already connected, add this relay to the pool immediately
    if let Ok(client) = get_nostr_client() {
        if client.relays().await.len() > 0 {
            match client
                .pool()
                .add_relay(&new_relay.url, relay_options_for_mode(&relay_mode))
                .await
            {
                Ok(_) => {
                    println!(
                        "[Relay] Added custom relay to pool: {} (mode: {})",
                        new_relay.url, relay_mode
                    );
                    // Connect to the new relay
                    if let Err(e) = client.pool().connect_relay(&new_relay.url).await {
                        eprintln!("[Relay] Failed to connect to new relay: {}", e);
                    }
                }
                Err(e) => eprintln!("[Relay] Failed to add relay to pool: {}", e),
            }
        }
    }

    Ok(new_relay)
}

/// Remove a custom relay URL
#[tauri::command]
pub(crate) async fn remove_custom_relay<R: Runtime>(
    handle: AppHandle<R>,
    url: String,
) -> Result<bool, String> {
    let mut relays = get_custom_relays(handle.clone()).await?;

    let url_lower = url.to_lowercase();
    let original_len = relays.len();
    relays.retain(|r| r.url.to_lowercase() != url_lower);

    if relays.len() == original_len {
        return Ok(false); // Relay not found
    }

    // Save updated list
    save_custom_relays(&handle, &relays).await?;

    // Remove from active pool if connected
    if let Ok(client) = get_nostr_client() {
        if let Err(e) = client.pool().remove_relay(&url).await {
            // Log but don't fail - relay might not be in pool
            eprintln!("[Relay] Note: Could not remove relay from pool: {}", e);
        } else {
            println!("[Relay] Removed custom relay from pool: {}", url);
        }
    }

    clear_relay_failure(&url);

    Ok(true)
}

/// Toggle a custom relay's enabled state
#[tauri::command]
pub(crate) async fn toggle_custom_relay<R: Runtime>(
    handle: AppHandle<R>,
    url: String,
    enabled: bool,
) -> Result<bool, String> {
    let mut relays = get_custom_relays(handle.clone()).await?;

    let url_lower = url.to_lowercase();
    let mut found = false;
    let mut relay_mode = "both".to_string();

    for relay in relays.iter_mut() {
        if relay.url.to_lowercase() == url_lower {
            relay.enabled = enabled;
            relay_mode = relay.mode.clone();
            found = true;
            break;
        }
    }

    if !found {
        return Err("Relay not found".to_string());
    }

    // Save updated list
    save_custom_relays(&handle, &relays).await?;

    // Update the relay pool
    if let Ok(client) = get_nostr_client() {
        if enabled {
            // Add and connect with proper mode
            match client
                .pool()
                .add_relay(&url, relay_options_for_mode(&relay_mode))
                .await
            {
                Ok(_) => {
                    let _ = client.pool().connect_relay(&url).await;
                    println!(
                        "[Relay] Enabled custom relay: {} (mode: {})",
                        url, relay_mode
                    );
                }
                Err(e) => eprintln!("[Relay] Failed to enable relay: {}", e),
            }
        } else {
            // Disconnect and remove
            clear_relay_failure(&url);
            if let Err(e) = client.pool().remove_relay(&url).await {
                eprintln!("[Relay] Note: Could not disable relay in pool: {}", e);
            } else {
                println!("[Relay] Disabled custom relay: {}", url);
            }
        }
    }

    Ok(true)
}

/// Update a custom relay's mode (read/write/both)
#[tauri::command]
pub(crate) async fn update_relay_mode<R: Runtime>(
    handle: AppHandle<R>,
    url: String,
    mode: String,
) -> Result<bool, String> {
    // Validate mode
    if !["read", "write", "both"].contains(&mode.as_str()) {
        return Err("Invalid mode. Must be 'read', 'write', or 'both'".to_string());
    }

    let mut relays = get_custom_relays(handle.clone()).await?;

    let url_lower = url.to_lowercase();
    let mut found = false;
    let mut is_enabled = false;

    for relay in relays.iter_mut() {
        if relay.url.to_lowercase() == url_lower {
            relay.mode = mode.clone();
            is_enabled = relay.enabled;
            found = true;
            break;
        }
    }

    if !found {
        return Err("Relay not found".to_string());
    }

    // Save updated list
    save_custom_relays(&handle, &relays).await?;

    // If relay is currently enabled, reconnect with new mode
    if is_enabled {
        if let Ok(client) = get_nostr_client() {
            // Remove and re-add with new options
            let _ = client.pool().remove_relay(&url).await;
            match client
                .pool()
                .add_relay(&url, relay_options_for_mode(&mode))
                .await
            {
                Ok(_) => {
                    let _ = client.pool().connect_relay(&url).await;
                    println!("[Relay] Updated relay mode: {} -> {}", url, mode);
                }
                Err(e) => eprintln!("[Relay] Failed to update relay mode: {}", e),
            }
        }
    }

    Ok(true)
}

/// Validate a relay URL without saving it
#[tauri::command]
pub(crate) async fn validate_relay_url_cmd(url: String) -> Result<String, String> {
    validate_relay_url(&url)
}

/// Whether a relay's current status alone (not a probe outcome) warrants a
/// forced disconnect+reconnect from the health-check loop.
pub(crate) fn relay_needs_forced_reconnect(status: RelayStatus) -> bool {
    matches!(status, RelayStatus::Terminated | RelayStatus::Disconnected)
}

// Relay URLs with a reconnect fetch in flight (lazy_static items cannot take /// docs).
lazy_static! {
    static ref RELAY_FETCH_IN_FLIGHT: Mutex<std::collections::HashSet<String>> =
        Mutex::new(std::collections::HashSet::new());
}

/// Whether a relay is allowed to start a new single-relay reconnect fetch, given the set of
/// relay URLs that currently have one in flight.
pub(crate) fn relay_fetch_may_start(
    in_flight: &std::collections::HashSet<String>,
    url: &str,
) -> bool {
    !in_flight.contains(url)
}

/// Monitor relay pool connection status changes
#[tauri::command]
pub(crate) async fn monitor_relay_connections() -> Result<bool, String> {
    // Guard against multiple invocations (e.g., from hot-reloads in debug mode)
    static MONITOR_STARTED: std::sync::atomic::AtomicBool =
        std::sync::atomic::AtomicBool::new(false);
    if MONITOR_STARTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        // Already running, return success without spawning duplicate tasks
        return Ok(false);
    }

    let client = get_nostr_client().expect("Nostr client not initialized");
    // Captured once, at spawn time, and reused by every task below. Compared against the
    // live generation on every diagnostic write (failure store/clear, log, metric) so a
    // stale monitor loop left running for a previous account cannot attribute diagnostics
    // to the current one.
    let login_generation = current_login_generation();
    let handle = TAURI_APP.get().unwrap().clone();

    // Get the monitor and subscribe to real-time notifications
    let monitor = client.monitor().ok_or("Failed to get monitor")?;
    let mut receiver = monitor.subscribe();

    // RAII guard releasing a relay's RELAY_FETCH_IN_FLIGHT slot on Drop, so a panicking or
    // erroring single-relay fetch can't strand the slot and permanently block that relay's
    // future reconnect fetches.
    struct InFlightGuard(String);
    impl Drop for InFlightGuard {
        fn drop(&mut self) {
            let url = std::mem::take(&mut self.0);
            tokio::spawn(async move {
                RELAY_FETCH_IN_FLIGHT.lock().await.remove(&url);
            });
        }
    }

    // Spawn a task to handle real-time relay status notifications
    let handle_clone = handle.clone();
    tokio::spawn(async move {
        while let Ok(notification) = receiver.recv().await {
            match notification {
                MonitorNotification::StatusChanged { relay_url, status } => {
                    let url_str = relay_url.to_string();
                    let status_str = match status {
                        RelayStatus::Initialized => "initialized",
                        RelayStatus::Pending => "pending",
                        RelayStatus::Connecting => "connecting",
                        RelayStatus::Connected => "connected",
                        RelayStatus::Disconnected => "disconnected",
                        RelayStatus::Terminated => "terminated",
                        RelayStatus::Banned => "banned",
                        RelayStatus::Sleeping => "sleeping",
                    };

                    // Log the status change
                    let log_level = match status {
                        RelayStatus::Connected => "info",
                        RelayStatus::Disconnected | RelayStatus::Terminated => "warn",
                        RelayStatus::Banned => "error",
                        _ => "info",
                    };
                    add_relay_log_if_current(
                        &url_str,
                        log_level,
                        &format!("Status changed to {}", status_str),
                        login_generation,
                    );

                    // Emit relay status update to frontend
                    handle_clone
                        .emit(
                            "relay_status_change",
                            serde_json::json!({
                                "url": url_str,
                                "status": status_str
                            }),
                        )
                        .unwrap();

                    // Handle reconnection logic
                    match status {
                        RelayStatus::Disconnected => {
                            // The aggressive health check system will handle reconnection
                            // No action needed here to avoid race conditions
                        }
                        RelayStatus::Terminated => {
                            // Relay connection terminated (hard disconnect)
                        }
                        RelayStatus::Connected => {
                            clear_relay_failure_if_current(&url_str, login_generation);
                            // When a relay reconnects, fetch its bounded catch-up window from just
                            // that relay — skip if a fetch for this relay is already in flight so
                            // rapid Connected/Disconnected flapping never overlaps fetches.
                            let handle_inner = handle_clone.clone();
                            let url_string = url_str.clone();
                            let guard = {
                                let mut in_flight = RELAY_FETCH_IN_FLIGHT.lock().await;
                                if relay_fetch_may_start(&in_flight, &url_string) {
                                    in_flight.insert(url_string.clone());
                                    Some(InFlightGuard(url_string.clone()))
                                } else {
                                    None
                                }
                            };
                            if let Some(guard) = guard {
                                tokio::spawn(async move {
                                    // fetch_messages handles both DM and MLS group syncing for single-relay reconnections.
                                    // `guard` is held across the await and dropped afterward, so a panic mid-fetch still
                                    // releases the RELAY_FETCH_IN_FLIGHT slot via unwind.
                                    crate::cmds::chat::fetch_messages(
                                        handle_inner,
                                        false,
                                        Some(url_string.clone()),
                                    )
                                    .await;
                                    drop(guard);
                                });
                            } else {
                                add_relay_log_if_current(
                                    &url_str,
                                    "info",
                                    "Skipping single-relay reconnect fetch: already in flight",
                                    login_generation,
                                );
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    });

    // Spawn conservative health check task: measures/logs Connected relays but
    // no longer force-disconnects them; only Terminated/Disconnected relays get
    // reconnected here (the 5s poller below independently retries Terminated
    // relays, but not Disconnected ones, so that case stays in this loop).
    let client_health = client.clone();
    let handle_health = handle.clone();
    tokio::spawn(async move {
        // Wait 60 seconds before starting health checks
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;

        loop {
            // Get all relays
            let relays = client_health.relays().await;
            let mut unhealthy_relays = Vec::new();

            for (url, relay) in &relays {
                let status = relay.status();

                // Only test relays that claim to be connected
                if status == RelayStatus::Connected {
                    // Create a simple query to test connectivity
                    let test_filter = Filter::new().kinds(vec![Kind::Metadata]).limit(1);

                    // Try to fetch with short timeout
                    let start = std::time::Instant::now();
                    let result = tokio::time::timeout(
                        std::time::Duration::from_secs(3),
                        client_health.fetch_events_from(
                            vec![url.to_string()],
                            test_filter,
                            std::time::Duration::from_secs(2),
                        ),
                    )
                    .await;

                    let elapsed = start.elapsed();

                    let url_str = url.to_string();
                    let ping_ms = elapsed.as_millis() as u64;
                    let now_secs = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs();

                    match result {
                        Ok(Ok(events)) => {
                            // Any completed round-trip is useful ping data, even an
                            // empty/slow one — we no longer disconnect on this alone.
                            update_relay_metrics_if_current(&url_str, login_generation, |m| {
                                m.ping_ms = Some(ping_ms);
                                m.last_check = Some(now_secs);
                            });
                            if events.is_empty() && elapsed.as_secs() >= 2 {
                                add_relay_log_if_current(
                                    &url_str,
                                    "warn",
                                    "Health check: slow/empty response",
                                    login_generation,
                                );
                            }
                        }
                        Ok(Err(e)) => {
                            // Query failed but the relay responded (no timeout): record the
                            // probe attempt (R11), but don't force a reconnect — a slower-but-
                            // alive relay shouldn't be treated the same as one that never
                            // answers at all.
                            update_relay_metrics_if_current(&url_str, login_generation, |m| {
                                m.last_check = Some(now_secs);
                            });
                            add_relay_log_if_current(
                                &url_str,
                                "warn",
                                &format!("Health check failed: {}", e),
                                login_generation,
                            );
                        }
                        Err(_) => {
                            // Full probe timeout: a materially stronger "not there" signal
                            // than a slow-but-completed response. A Connected relay that never
                            // answers has no other recovery path — RelayStatus never
                            // transitions out of Connected on its own, so the reconnect-only-
                            // on-Terminated branch below never sees it. Queue it for the same
                            // forced disconnect+reconnect that branch already uses.
                            update_relay_metrics_if_current(&url_str, login_generation, |m| {
                                m.last_check = Some(now_secs);
                            });
                            add_relay_log_if_current(
                                &url_str,
                                "warn",
                                "Health check failed: timeout",
                                login_generation,
                            );
                            unhealthy_relays.push((url.clone(), relay.clone()));
                        }
                    }
                } else if relay_needs_forced_reconnect(status) {
                    // Already disconnected, add to reconnect list
                    unhealthy_relays.push((url.clone(), relay.clone()));
                }
            }

            // Force reconnect unhealthy relays
            for (url, relay) in unhealthy_relays {
                let url_str = url.to_string();
                // Force a disconnect first for any status `try_connect` can't act on -- the
                // SDK's `can_connect` only accepts Initialized | Terminated | Sleeping, so
                // anything else (Connected included) would otherwise make `try_connect`
                // return `Ok(())` without attempting anything and no cause would ever be
                // produced.
                if !matches!(
                    relay.status(),
                    RelayStatus::Initialized | RelayStatus::Terminated | RelayStatus::Sleeping
                ) {
                    let _ = relay.disconnect();
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                }

                // Try to reconnect
                add_relay_log_if_current(
                    &url_str,
                    "info",
                    "Attempting reconnection...",
                    login_generation,
                );
                match relay.try_connect(std::time::Duration::from_secs(10)).await {
                    Ok(()) => {
                        // Cheap optimization only -- R3's real guarantee is the read-side gate
                        // in `get_relays` (KTD8), not this status re-check.
                        if relay.status() == RelayStatus::Connected {
                            clear_relay_failure_if_current(&url_str, login_generation);
                        }
                    }
                    Err(e) => {
                        let failure = classify_relay_error(&e);
                        store_relay_failure_if_current(&url_str, failure, login_generation);
                    }
                }

                // Emit status update
                handle_health
                    .emit(
                        "relay_health_check",
                        serde_json::json!({
                            "url": url_str,
                            "healthy": false,
                            "action": "force_reconnect"
                        }),
                    )
                    .unwrap();
            }

            // Wait 15 seconds before next health check round
            tokio::time::sleep(std::time::Duration::from_secs(15)).await;
        }
    });

    // Keep the original periodic terminated relay check
    tokio::spawn(async move {
        // Wait 30 seconds before starting the polling loop
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;

        loop {
            // Check all relays every 5 seconds
            let relays = client.relays().await;

            for (url, relay) in relays {
                let status = relay.status();
                let url_str = url.to_string();

                // If relay is terminated, attempt to reconnect. `Terminated` is one of the
                // statuses `try_connect` can act on directly, so no forced disconnect first.
                if status == RelayStatus::Terminated {
                    match relay.try_connect(std::time::Duration::from_secs(5)).await {
                        Ok(()) => {
                            if relay.status() == RelayStatus::Connected {
                                clear_relay_failure_if_current(&url_str, login_generation);
                            }
                        }
                        Err(e) => {
                            let failure = classify_relay_error(&e);
                            store_relay_failure_if_current(&url_str, failure, login_generation);
                        }
                    }
                }
            }

            // Wait 5 seconds before next check
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
    });

    Ok(true)
}

#[cfg(test)]
mod relay_health_reconnect_tests {
    use super::{relay_fetch_may_start, relay_needs_forced_reconnect};
    use nostr_sdk::prelude::RelayStatus;

    #[test]
    fn terminated_and_disconnected_trigger_reconnect() {
        assert!(relay_needs_forced_reconnect(RelayStatus::Terminated));
        assert!(relay_needs_forced_reconnect(RelayStatus::Disconnected));
    }

    #[test]
    fn connected_and_other_statuses_do_not_trigger_reconnect() {
        assert!(!relay_needs_forced_reconnect(RelayStatus::Connected));
        assert!(!relay_needs_forced_reconnect(RelayStatus::Initialized));
        assert!(!relay_needs_forced_reconnect(RelayStatus::Pending));
        assert!(!relay_needs_forced_reconnect(RelayStatus::Connecting));
        assert!(!relay_needs_forced_reconnect(RelayStatus::Banned));
        assert!(!relay_needs_forced_reconnect(RelayStatus::Sleeping));
    }

    #[test]
    fn same_relay_may_not_start_a_second_fetch_while_one_is_in_flight() {
        let mut in_flight = std::collections::HashSet::new();
        assert!(relay_fetch_may_start(&in_flight, "wss://relay.example.com"));
        in_flight.insert("wss://relay.example.com".to_string());
        assert!(!relay_fetch_may_start(
            &in_flight,
            "wss://relay.example.com"
        ));
    }

    #[test]
    fn different_relay_may_start_its_own_fetch_independently() {
        let mut in_flight = std::collections::HashSet::new();
        in_flight.insert("wss://relay-a.example.com".to_string());
        assert!(relay_fetch_may_start(
            &in_flight,
            "wss://relay-b.example.com"
        ));
    }

    #[test]
    fn relay_may_start_again_once_its_in_flight_slot_is_cleared() {
        let mut in_flight = std::collections::HashSet::new();
        in_flight.insert("wss://relay.example.com".to_string());
        assert!(!relay_fetch_may_start(
            &in_flight,
            "wss://relay.example.com"
        ));
        in_flight.remove("wss://relay.example.com");
        assert!(relay_fetch_may_start(&in_flight, "wss://relay.example.com"));
    }
}

/// # Debug Hot-Reload State Sync
///
/// This command ONLY compiles in debug builds and provides a fast-path for
/// frontend hot-reloads during development. When the frontend hot-reloads,
/// the backend retains all state, so we can skip the entire login/decrypt
/// flow and just bulk-send the existing state back to the frontend.
///
/// Returns:
/// - `Ok(json)` with full state if backend is already initialized
/// - `Err(...)` if backend is not initialized (frontend should do normal login)
#[cfg(debug_assertions)]
#[tauri::command]
pub(crate) async fn debug_hot_reload_sync() -> Result<serde_json::Value, String> {
    // Check if we have an active Nostr client (meaning we're already logged in)
    let client = get_nostr_client()
        .map_err(|_| "Backend not initialized - perform normal login".to_string())?;

    // Get the current user's public key
    let signer = client
        .signer()
        .await
        .map_err(|e| format!("Signer error: {}", e))?;
    let my_npub = signer
        .get_public_key()
        .await
        .map_err(|e| format!("Public key error: {}", e))?
        .to_bech32()
        .map_err(|e| format!("Bech32 error: {}", e))?;

    // Get the full state
    let state = STATE.lock().await;

    // Verify we have meaningful state (not just an empty initialized state)
    if state.profiles.is_empty() && state.chats.is_empty() {
        return Err("Backend state is empty - perform normal login".to_string());
    }

    // Return the full state for the frontend to hydrate
    println!(
        "[Debug Hot-Reload] Sending cached state to frontend ({} profiles, {} chats)",
        state.profiles.len(),
        state.chats.len()
    );

    Ok(serde_json::json!({
        "success": true,
        "npub": my_npub,
        "profiles": &state.profiles,
        "chats": &state.chats,
        "is_syncing": state.is_syncing,
        "sync_mode": format!("{:?}", state.sync_mode)
    }))
}

/// Check if a URL is a default relay
pub(crate) fn is_default_relay(url: &str) -> bool {
    let normalized = url.trim().trim_end_matches('/').to_lowercase();
    DEFAULT_RELAYS
        .iter()
        .any(|r| r.to_lowercase() == normalized)
}

#[cfg(test)]
mod validate_relay_url_tests {
    use super::validate_relay_url;

    #[test]
    fn accepts_wss_relay() {
        assert_eq!(
            validate_relay_url("wss://relay.example.com").unwrap(),
            "wss://relay.example.com"
        );
    }

    #[test]
    fn accepts_ws_localhost_with_port() {
        assert_eq!(
            validate_relay_url("ws://localhost:7000").unwrap(),
            "ws://localhost:7000"
        );
    }

    #[test]
    fn accepts_ws_127_0_0_1_with_port() {
        assert_eq!(
            validate_relay_url("ws://127.0.0.1:7000").unwrap(),
            "ws://127.0.0.1:7000"
        );
    }

    #[test]
    fn rejects_public_ws() {
        assert!(validate_relay_url("ws://relay.example.com").is_err());
    }

    #[test]
    fn rejects_ws_localhost_with_userinfo_bypass() {
        assert!(validate_relay_url("ws://localhost:7000@evil.com").is_err());
    }

    #[test]
    fn rejects_ws_userinfo_at_localhost() {
        assert!(validate_relay_url("ws://user@localhost:7000").is_err());
    }

    #[test]
    fn rejects_ws_127_0_0_1() {
        assert!(validate_relay_url("ws://127.0.0.1").is_err());
    }

    #[test]
    fn rejects_wss_missing_host() {
        assert!(validate_relay_url("wss://").is_err());
    }

    #[test]
    fn normalizes_trailing_slash() {
        assert_eq!(
            validate_relay_url("wss://relay.example.com/").unwrap(),
            "wss://relay.example.com"
        );
    }
}

/// Save the list of custom relays to settings
pub(crate) async fn save_custom_relays<R: Runtime>(
    handle: &AppHandle<R>,
    relays: &[CustomRelay],
) -> Result<(), String> {
    if crate::account_manager::get_current_account().is_err() {
        return Err("No account selected".to_string());
    }

    let json_str =
        serde_json::to_string(relays).map_err(|e| format!("Failed to serialize relays: {}", e))?;

    let conn = crate::account_manager::get_db_connection(handle)?;

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params!["custom_relays", json_str],
    )
    .map_err(|e| format!("Failed to save custom relays: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Save the list of disabled default relays to settings
pub(crate) async fn save_disabled_default_relays<R: Runtime>(
    handle: &AppHandle<R>,
    relays: &[String],
) -> Result<(), String> {
    if crate::account_manager::get_current_account().is_err() {
        return Err("No account selected".to_string());
    }

    let json_str = serde_json::to_string(relays)
        .map_err(|e| format!("Failed to serialize disabled relays: {}", e))?;

    let conn = crate::account_manager::get_db_connection(handle)?;

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params!["disabled_default_relays", json_str],
    )
    .map_err(|e| format!("Failed to save disabled default relays: {}", e))?;

    crate::account_manager::return_db_connection(conn);
    Ok(())
}

/// Helper to build RelayOptions based on mode
pub(crate) fn relay_options_for_mode(mode: &str) -> RelayOptions {
    let opts = RelayOptions::new()
        .reconnect(false)
        .connection_mode(net_transport::nostr_connection_mode());
    match mode {
        "read" => opts.write(false),
        "write" => opts.read(false),
        _ => opts, // "both" - default read and write enabled
    }
}
