//! Attachment commands: blurhash previews, download, and save-to-disk.

use crate::util;
use crate::{
    calculate_file_hash, crypto, db, net, save_chat_messages, Attachment, Chat, ChatType, Message,
    STATE, TAURI_APP,
};
use nostr_sdk::prelude::*;
use tauri::{AppHandle, Emitter, Manager};

fn is_target_chat(chat: &Chat, npub: &str) -> bool {
    match &chat.chat_type {
        ChatType::MlsGroup => chat.id == npub,
        ChatType::DirectMessage => chat.has_participant(npub),
    }
}

struct DownloadedAttachmentSync {
    chat_id: String,
    db_attachment_id: String,
    message: Message,
}

/// Marks the attachment downloaded in memory. `lookup_id` is the id currently
/// stored (nonce or ox hash); `new_id` is the on-disk hash after decrypt.
fn mark_attachment_downloaded(
    chats: &mut [Chat],
    npub: &str,
    msg_id: &str,
    lookup_id: &str,
    new_id: &str,
    path: &str,
) -> Option<DownloadedAttachmentSync> {
    for chat in chats {
        if !is_target_chat(chat, npub) {
            continue;
        }
        let chat_id = chat.id().clone();
        let Some(message) = chat.messages.iter_mut().find(|m| m.id == msg_id) else {
            continue;
        };
        let Some(attachment) = message.attachments.iter_mut().find(|a| a.id == lookup_id) else {
            continue;
        };
        attachment.id = new_id.to_string();
        attachment.downloading = false;
        attachment.downloaded = true;
        attachment.path = path.to_string();
        return Some(DownloadedAttachmentSync {
            chat_id,
            db_attachment_id: lookup_id.to_string(),
            message: message.clone(),
        });
    }
    None
}

fn emit_attachment_download_success<R: tauri::Runtime>(
    handle: &AppHandle<R>,
    npub: &str,
    msg_id: &str,
    old_id: &str,
    new_id: &str,
    path: Option<&str>,
    message: &Message,
    chat_id: &str,
) {
    let mut payload = serde_json::json!({
        "profile_id": npub,
        "msg_id": msg_id,
        "old_id": old_id,
        "id": new_id,
        "success": true,
    });
    if let Some(path) = path {
        payload["result"] = serde_json::json!(path);
    }
    let _ = handle.emit("attachment_download_result", payload);
    let _ = handle.emit(
        "message_update",
        serde_json::json!({
            "old_id": &message.id,
            "message": message,
            "chat_id": chat_id
        }),
    );
}

fn persist_attachment_downloaded<R: tauri::Runtime>(
    handle: &AppHandle<R>,
    chat_id: &str,
    msg_id: &str,
    attachment_id: &str,
    path: &str,
) {
    let _ =
        db::update_attachment_downloaded_status(handle, chat_id, msg_id, attachment_id, true, path);
}

/// Decrypts and saves an attachment to disk
///
/// Returns the path to the decrypted file if successful, or an error message if unsuccessful
pub(crate) async fn decrypt_and_save_attachment<R: tauri::Runtime>(
    handle: &AppHandle<R>,
    encrypted_data: &[u8],
    attachment: &Attachment,
) -> Result<std::path::PathBuf, String> {
    // Remote-plaintext marker (see `message::klipy_gif_message`): an empty
    // key/nonce means this attachment was never encrypted — it carries a
    // provider URL directly, e.g. a Klipy GIF. Attempting AES-GCM decryption
    // on an empty key would panic (`GenericArray::from_slice` asserts on
    // length), so refuse before ever calling into `crypto::decrypt_data`.
    if attachment.key.is_empty() || attachment.nonce.is_empty() {
        return Err(
            "This attachment has no decryption key and cannot be decrypted locally".to_string(),
        );
    }

    // Attempt to decrypt the attachment
    let decrypted_data = crypto::decrypt_data(encrypted_data, &attachment.key, &attachment.nonce)
        .map_err(|e| e.to_string())?;

    // Calculate the hash of the decrypted file
    let file_hash = calculate_file_hash(&decrypted_data);

    // Choose the appropriate base directory based on platform
    let base_directory = if cfg!(target_os = "ios") {
        tauri::path::BaseDirectory::Document
    } else {
        tauri::path::BaseDirectory::Download
    };

    // Resolve the directory path using the determined base directory
    let dir = handle.path().resolve("pacto", base_directory).unwrap();

    // Use hash-based filename
    let file_path = dir.join(format!("{}.{}", file_hash, attachment.extension));

    // Create the pacto directory if it doesn't exist
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create directory: {}", e))?;

    // Save the file to disk
    std::fs::write(&file_path, decrypted_data)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(file_path)
}

#[cfg(test)]
mod remote_plaintext_attachment_tests {
    use super::*;

    fn test_handle() -> AppHandle<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap()
            .handle()
            .clone()
    }

    /// Shape produced by `message::klipy_gif_message`: empty key/nonce marks
    /// "remote plaintext, do not decrypt" rather than a corrupted upload.
    fn remote_plaintext_attachment() -> Attachment {
        Attachment {
            id: "abc123slug".to_string(),
            extension: "gif".to_string(),
            url: "https://static.klipy.com/hd.gif".to_string(),
            downloaded: false,
            ..Attachment::default()
        }
    }

    #[tokio::test]
    async fn refuses_to_decrypt_an_attachment_with_no_decryption_key() {
        let handle = test_handle();
        let attachment = remote_plaintext_attachment();
        // Without the guard this reaches `crypto::decrypt_data` with an empty
        // key, which panics (`GenericArray::from_slice` on a length
        // mismatch) instead of returning this clean error.
        let result =
            decrypt_and_save_attachment(&handle, b"sixteen+ bytes of fake ciphertext", &attachment)
                .await;
        assert!(result.is_err());
    }
}

#[cfg(test)]
mod download_finalize_tests {
    use super::*;

    fn sample_attachment(id: &str) -> Attachment {
        Attachment {
            id: id.to_string(),
            extension: "png".to_string(),
            downloaded: false,
            downloading: true,
            ..Attachment::default()
        }
    }

    fn dm_with_attachment(peer: &str, msg_id: &str, attachment_id: &str) -> Chat {
        let mut chat = Chat::new_dm(peer.to_string());
        chat.messages.push(Message {
            id: msg_id.to_string(),
            attachments: vec![sample_attachment(attachment_id)],
            ..Message::default()
        });
        chat
    }

    #[test]
    fn marks_downloaded_and_renames_id() {
        let mut chats = vec![dm_with_attachment("npub1peer", "m1", "nonce")];
        let sync = mark_attachment_downloaded(
            &mut chats,
            "npub1peer",
            "m1",
            "nonce",
            "hash",
            "/tmp/hash.png",
        )
        .expect("attachment should be found");
        let att = &sync.message.attachments[0];
        assert_eq!(att.id, "hash");
        assert!(att.downloaded);
        assert!(!att.downloading);
        assert_eq!(att.path, "/tmp/hash.png");
        assert_eq!(sync.db_attachment_id, "nonce");
        assert_eq!(sync.chat_id, "npub1peer");
        assert_eq!(chats[0].messages[0].attachments[0].id, "hash");
    }

    #[test]
    fn returns_none_when_attachment_is_missing() {
        let mut chats = vec![dm_with_attachment("npub1peer", "m1", "nonce")];
        assert!(
            mark_attachment_downloaded(&mut chats, "npub1peer", "m1", "other", "hash", "/x")
                .is_none()
        );
    }
}

#[tauri::command]
pub(crate) async fn generate_blurhash_preview(
    npub: String,
    msg_id: String,
) -> Result<String, String> {
    // Get the first attachment from the message by searching through chats
    let img_meta = {
        let state = STATE.lock().await;

        // Search through all chats to find the message
        let mut found_attachment = None;

        for chat in &state.chats {
            // Check if this is the target chat (works for both DMs and group chats)
            let is_target_chat = match &chat.chat_type {
                ChatType::MlsGroup => chat.id == npub,
                ChatType::DirectMessage => chat.has_participant(&npub),
            };

            if is_target_chat {
                // Look for the message in this chat
                if let Some(message) = chat.messages.iter().find(|m| m.id == msg_id) {
                    // Get the first attachment
                    if let Some(attachment) = message.attachments.first() {
                        found_attachment = attachment.img_meta.clone();
                        break;
                    }
                }
            }
        }

        found_attachment.ok_or_else(|| "No image attachment found".to_string())?
    };

    // Generate the Base64 image using the decode_blurhash_to_base64 function
    let base64_image = util::decode_blurhash_to_base64(
        &img_meta.blurhash,
        img_meta.width,
        img_meta.height,
        1.0, // Default punch value
    );

    Ok(base64_image)
}

/// Generic blurhash decoder - converts a blurhash string to a base64 data URL
/// Used by the GIF picker for placeholder backgrounds
#[tauri::command]
pub(crate) fn decode_blurhash(blurhash: String, width: u32, height: u32) -> String {
    util::decode_blurhash_to_base64(&blurhash, width, height, 1.0)
}

#[tauri::command]
pub(crate) async fn download_attachment(
    npub: String,
    msg_id: String,
    attachment_id: String,
) -> bool {
    let handle = TAURI_APP.get().unwrap();

    // Grab the attachment's metadata by searching through chats
    let attachment = {
        let mut state = STATE.lock().await;

        let mut found_attachment = None;
        let mut on_disk_path: Option<String> = None;
        for chat in &mut state.chats {
            if !is_target_chat(chat, &npub) {
                continue;
            }
            let Some(message) = chat.messages.iter_mut().find(|m| m.id == msg_id) else {
                continue;
            };
            let Some(attachment) = message
                .attachments
                .iter_mut()
                .find(|a| a.id == attachment_id)
            else {
                continue;
            };
            if attachment.downloading {
                return false;
            }

            let base_directory = if cfg!(target_os = "ios") {
                tauri::path::BaseDirectory::Document
            } else {
                tauri::path::BaseDirectory::Download
            };
            if let Ok(vector_dir) = handle.path().resolve("pacto", base_directory) {
                let file_path =
                    vector_dir.join(format!("{}.{}", &attachment.id, &attachment.extension));
                if file_path.exists() {
                    on_disk_path = Some(file_path.to_string_lossy().to_string());
                    break;
                }
            }

            attachment.downloading = true;
            found_attachment = Some(attachment.clone());
            break;
        }

        if let Some(path_str) = on_disk_path {
            let sync = mark_attachment_downloaded(
                &mut state.chats,
                &npub,
                &msg_id,
                &attachment_id,
                &attachment_id,
                &path_str,
            );
            if let Some(sync) = sync {
                emit_attachment_download_success(
                    handle,
                    &npub,
                    &msg_id,
                    &attachment_id,
                    &attachment_id,
                    Some(&path_str),
                    &sync.message,
                    &sync.chat_id,
                );
                let chat_id = sync.chat_id;
                let db_attachment_id = sync.db_attachment_id;
                drop(state);
                persist_attachment_downloaded(
                    handle,
                    &chat_id,
                    &msg_id,
                    &db_attachment_id,
                    &path_str,
                );
                return true;
            }
        }

        if found_attachment.is_none() {
            eprintln!(
                "Attachment not found for download: {} in message {}",
                attachment_id, msg_id
            );
            return false;
        }

        found_attachment.unwrap()
    };

    // Remote-plaintext attachment (empty key/nonce, e.g. a Klipy GIF): never a
    // general-purpose fetch primitive. Rendering one goes through its own
    // allowlisted command (`klipy_fetch_media`); this generic path refuses
    // outright rather than fetching an attacker-supplied URL on the user's
    // behalf.
    if attachment.key.is_empty() || attachment.nonce.is_empty() {
        handle
            .emit(
                "attachment_download_result",
                serde_json::json!({
                    "profile_id": npub,
                    "msg_id": msg_id,
                    "id": attachment_id,
                    "success": false,
                    "result": "This attachment has no decryption key and cannot be downloaded here."
                }),
            )
            .unwrap();
        return false;
    }

    // Begin our download progress events
    handle
        .emit(
            "attachment_download_progress",
            serde_json::json!({
                "id": &attachment.id,
                "progress": 0
            }),
        )
        .unwrap();

    // Download the file - no timeout, allow large downloads to complete
    let encrypted_data = match net::download(&attachment.url, handle, &attachment.id, None).await {
        Ok(data) => data,
        Err(error) => {
            // Handle download error
            let mut state = STATE.lock().await;

            // Find and update the attachment status
            for chat in &mut state.chats {
                let is_target_chat = match &chat.chat_type {
                    ChatType::MlsGroup => chat.id == npub,
                    ChatType::DirectMessage => chat.has_participant(&npub),
                };

                if is_target_chat {
                    if let Some(message) = chat.messages.iter_mut().find(|m| m.id == msg_id) {
                        if let Some(attachment) = message
                            .attachments
                            .iter_mut()
                            .find(|a| a.id == attachment_id)
                        {
                            attachment.downloading = false;
                            attachment.downloaded = false;
                            break;
                        }
                    }
                }
            }

            // Emit the error
            handle
                .emit(
                    "attachment_download_result",
                    serde_json::json!({
                        "profile_id": npub,
                        "msg_id": msg_id,
                        "id": attachment_id,
                        "success": false,
                        "result": error
                    }),
                )
                .unwrap();
            return false;
        }
    };

    // Check if we got a reasonable amount of data
    if encrypted_data.len() < 16 {
        eprintln!(
            "Downloaded file too small: {} bytes for attachment {}",
            encrypted_data.len(),
            attachment_id
        );
        let mut state = STATE.lock().await;

        // Find and update the attachment status
        for chat in &mut state.chats {
            let is_target_chat = match &chat.chat_type {
                ChatType::MlsGroup => chat.id == npub,
                ChatType::DirectMessage => chat.has_participant(&npub),
            };

            if is_target_chat {
                if let Some(message) = chat.messages.iter_mut().find(|m| m.id == msg_id) {
                    if let Some(attachment) = message
                        .attachments
                        .iter_mut()
                        .find(|a| a.id == attachment_id)
                    {
                        attachment.downloading = false;
                        attachment.downloaded = false;
                        break;
                    }
                }
            }
        }

        // Emit a more helpful error
        let error_msg = format!(
            "Downloaded file too small ({} bytes). URL may be invalid or expired.",
            encrypted_data.len()
        );
        handle
            .emit(
                "attachment_download_result",
                serde_json::json!({
                    "profile_id": npub,
                    "msg_id": msg_id,
                    "id": attachment_id,
                    "success": false,
                    "result": error_msg
                }),
            )
            .unwrap();
        return false;
    }

    // Decrypt and save the file
    let result = decrypt_and_save_attachment(handle, &encrypted_data, &attachment).await;

    // Process the result
    match result {
        Err(error) => {
            // Check if this is a corrupted attachment (decryption failure)
            let is_decryption_error = error.contains("aead") || error.contains("decrypt");

            if is_decryption_error {
                eprintln!(
                    "Decryption failed for attachment {}: corrupted keys/data mismatch",
                    attachment_id
                );
            }

            // Handle decryption/saving error
            let mut state = STATE.lock().await;

            // Find and update the attachment status
            let mut should_remove = false;
            for chat in &mut state.chats {
                let is_target_chat = match &chat.chat_type {
                    ChatType::MlsGroup => chat.id == npub,
                    ChatType::DirectMessage => chat.has_participant(&npub),
                };

                if is_target_chat {
                    if let Some(message) = chat.messages.iter_mut().find(|m| m.id == msg_id) {
                        if let Some(attachment) = message
                            .attachments
                            .iter_mut()
                            .find(|a| a.id == attachment_id)
                        {
                            attachment.downloading = false;
                            attachment.downloaded = false;

                            // If it's a decryption error, mark for removal as it's corrupted
                            if is_decryption_error {
                                eprintln!(
                                    "Marking corrupted attachment for removal: {}",
                                    attachment_id
                                );
                                should_remove = true;
                            }
                            break;
                        }
                    }
                }
            }

            // Remove corrupted attachment if needed and save
            if should_remove {
                // Collect chat_id and messages to save
                let save_data: Option<(String, Vec<Message>)> = {
                    let mut result = None;
                    for chat in &mut state.chats {
                        let is_target_chat = match &chat.chat_type {
                            ChatType::MlsGroup => chat.id == npub,
                            ChatType::DirectMessage => chat.has_participant(&npub),
                        };

                        if is_target_chat {
                            let chat_id = chat.id().to_string();

                            if let Some(message) = chat.messages.iter_mut().find(|m| m.id == msg_id)
                            {
                                let original_count = message.attachments.len();
                                message.attachments.retain(|a| a.id != attachment_id);
                                if message.attachments.len() < original_count {
                                    result = Some((chat_id, vec![message.clone()]));
                                }
                                break;
                            }
                        }
                    }
                    result
                };

                // Drop state and save
                drop(state);
                if let Some((chat_id, messages)) = save_data {
                    let _ = save_chat_messages(handle.clone(), &chat_id, &messages).await;
                }
            }

            // Emit the error
            handle
                .emit(
                    "attachment_download_result",
                    serde_json::json!({
                        "profile_id": npub,
                        "msg_id": msg_id,
                        "id": attachment_id,
                        "success": false,
                        "result": if should_remove {
                            "Corrupted attachment removed. Please re-send the file.".to_string()
                        } else {
                            error
                        }
                    }),
                )
                .unwrap();
            return false;
        }
        Ok(hash_file_path) => {
            let file_hash = hash_file_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(&attachment_id)
                .to_string();
            let path_str = hash_file_path.to_string_lossy().to_string();

            let sync = {
                let mut state = STATE.lock().await;
                let sync = mark_attachment_downloaded(
                    &mut state.chats,
                    &npub,
                    &msg_id,
                    &attachment_id,
                    &file_hash,
                    &path_str,
                );
                if let Some(ref sync) = sync {
                    emit_attachment_download_success(
                        handle,
                        &npub,
                        &msg_id,
                        &attachment_id,
                        &file_hash,
                        None,
                        &sync.message,
                        &sync.chat_id,
                    );
                }
                sync
            };

            if let Some(sync) = sync {
                persist_attachment_downloaded(
                    handle,
                    &sync.chat_id,
                    &msg_id,
                    &sync.db_attachment_id,
                    &path_str,
                );
            }

            true
        }
    }
}

/// Downloads and decrypts an attachment if it is not already on disk, then opens a
/// native save dialog and copies the plaintext file to the chosen destination.
/// Returns the saved path, or an empty string if the user cancelled the dialog.
#[tauri::command]
pub(crate) async fn save_attachment_as(
    npub: String,
    msg_id: String,
    attachment_id: String,
) -> Result<String, String> {
    let handle = TAURI_APP.get().ok_or("App handle not available")?;

    // Locate the attachment the same way `download_attachment` does.
    let attachment = {
        let state = STATE.lock().await;
        state
            .chats
            .iter()
            .find(|chat| match &chat.chat_type {
                ChatType::MlsGroup => chat.id == npub,
                ChatType::DirectMessage => chat.has_participant(&npub),
            })
            .and_then(|chat| chat.messages.iter().find(|m| m.id == msg_id))
            .and_then(|message| message.attachments.iter().find(|a| a.id == attachment_id))
            .cloned()
    }
    .ok_or_else(|| {
        format!(
            "Attachment not found: {} in message {}",
            attachment_id, msg_id
        )
    })?;

    // Remote-plaintext attachment (empty key/nonce, e.g. a Klipy GIF): nothing
    // to decrypt, and "Save as…" is never offered for these — Klipy's terms
    // forbid retaining its media on disk. Refuse rather than fetch-and-write.
    if attachment.key.is_empty() || attachment.nonce.is_empty() {
        return Err("This attachment has no decryption key and cannot be saved".to_string());
    }

    // Choose the appropriate base directory based on platform (matches `download_attachment`).
    let base_directory = if cfg!(target_os = "ios") {
        tauri::path::BaseDirectory::Document
    } else {
        tauri::path::BaseDirectory::Download
    };
    let vector_dir = handle
        .path()
        .resolve("pacto", base_directory)
        .map_err(|e| format!("Failed to resolve download directory: {}", e))?;
    let expected_path = vector_dir.join(format!("{}.{}", &attachment.id, &attachment.extension));

    // Reuse the already-decrypted file on disk if present; otherwise fetch and decrypt it,
    // reusing the same download + decrypt helpers as `download_attachment`.
    let source_path = if expected_path.exists() {
        expected_path
    } else {
        let encrypted_data = net::download(&attachment.url, handle, &attachment.id, None)
            .await
            .map_err(|e| format!("Failed to download attachment: {}", e))?;

        if encrypted_data.len() < 16 {
            return Err(format!(
                "Downloaded file too small ({} bytes). URL may be invalid or expired.",
                encrypted_data.len()
            ));
        }

        let decrypted_path =
            decrypt_and_save_attachment(handle, &encrypted_data, &attachment).await?;

        let file_hash = decrypted_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&attachment_id)
            .to_string();
        let path_str = decrypted_path.to_string_lossy().to_string();
        let sync = {
            let mut state = STATE.lock().await;
            let sync = mark_attachment_downloaded(
                &mut state.chats,
                &npub,
                &msg_id,
                &attachment_id,
                &file_hash,
                &path_str,
            );
            if let Some(ref sync) = sync {
                emit_attachment_download_success(
                    handle,
                    &npub,
                    &msg_id,
                    &attachment_id,
                    &file_hash,
                    None,
                    &sync.message,
                    &sync.chat_id,
                );
            }
            sync
        };
        if let Some(sync) = sync {
            persist_attachment_downloaded(
                handle,
                &sync.chat_id,
                &msg_id,
                &sync.db_attachment_id,
                &path_str,
            );
        }

        decrypted_path
    };

    // Open a native save dialog on the Rust side — the destination path is never
    // trusted from the webview, closing off arbitrary-path writes via IPC.
    use tauri_plugin_dialog::DialogExt;
    let handle_clone = handle.clone();
    let default_name = format!("{}.{}", attachment.id, attachment.extension);
    let dialog_result = tokio::task::spawn_blocking(move || {
        handle_clone
            .dialog()
            .file()
            .set_file_name(&default_name)
            .blocking_save_file()
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?;

    let dest = match dialog_result {
        Some(path) => path
            .as_path()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| "Invalid destination path".to_string())?,
        None => return Ok(String::new()),
    };

    // Create the destination directory if needed, then copy the plaintext file there.
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create destination directory: {}", e))?;
        }
    }

    std::fs::copy(&source_path, &dest)
        .map_err(|e| format!("Failed to copy attachment to destination: {}", e))?;

    Ok(dest.to_string_lossy().to_string())
}
