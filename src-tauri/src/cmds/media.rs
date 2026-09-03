//! Attachment commands: blurhash previews, download, and save-to-disk.

use crate::util;
use crate::{
    calculate_file_hash, crypto, db, net, save_chat_messages, Attachment, ChatType, Message, STATE,
    TAURI_APP,
};
use nostr_sdk::prelude::*;
use tauri::{AppHandle, Emitter, Manager};

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

        // Find the message and attachment in chats
        let mut found_attachment = None;
        for chat in &mut state.chats {
            // For group chats, npub is the group_id; for DMs, it's a participant npub
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
                        // Check that we're not already downloading
                        if attachment.downloading {
                            return false;
                        }

                        // Check if file already exists on disk (downloaded but flag was wrong)
                        let base_directory = if cfg!(target_os = "ios") {
                            tauri::path::BaseDirectory::Document
                        } else {
                            tauri::path::BaseDirectory::Download
                        };

                        if let Ok(vector_dir) = handle.path().resolve("pacto", base_directory) {
                            let file_path = vector_dir
                                .join(format!("{}.{}", &attachment.id, &attachment.extension));
                            if file_path.exists() {
                                // File already exists! Update the state and return success
                                attachment.downloaded = true;
                                attachment.path = file_path.to_string_lossy().to_string();

                                // Emit success event
                                handle
                                    .emit(
                                        "attachment_download_result",
                                        serde_json::json!({
                                            "profile_id": npub,
                                            "msg_id": msg_id,
                                            "id": attachment_id,
                                            "success": true,
                                            "result": file_path.to_string_lossy().to_string()
                                        }),
                                    )
                                    .unwrap();

                                // Also update the database
                                let chat_id_for_db = chat.id().to_string();
                                let msg_id_clone = msg_id.clone();
                                let attachment_id_clone = attachment_id.clone();
                                let path_str = file_path.to_string_lossy().to_string();
                                drop(state); // Release lock before DB call

                                let _ = db::update_attachment_downloaded_status(
                                    handle,
                                    &chat_id_for_db,
                                    &msg_id_clone,
                                    &attachment_id_clone,
                                    true,
                                    &path_str,
                                );

                                return true;
                            }
                        }

                        // Enable the downloading flag to prevent re-calls
                        attachment.downloading = true;
                        found_attachment = Some(attachment.clone());
                        break;
                    }
                }
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
            // Successfully decrypted and saved
            // Extract the hash from the filename (format: {hash}.{extension})
            let file_hash = hash_file_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(&attachment_id)
                .to_string();

            // Update state with successful download
            {
                let mut state = STATE.lock().await;

                // Find and update the attachment
                for chat in &mut state.chats {
                    let is_target_chat = match &chat.chat_type {
                        ChatType::MlsGroup => chat.id == npub,
                        ChatType::DirectMessage => chat.has_participant(&npub),
                    };

                    if is_target_chat {
                        if let Some(message) = chat.messages.iter_mut().find(|m| m.id == msg_id) {
                            if let Some(attachment_index) = message
                                .attachments
                                .iter()
                                .position(|a| a.id == attachment_id)
                            {
                                let attachment = &mut message.attachments[attachment_index];
                                attachment.id = file_hash.clone(); // Update ID from nonce to hash
                                attachment.downloading = false;
                                attachment.downloaded = true;
                                attachment.path = hash_file_path.to_string_lossy().to_string(); // Update to hash-based path
                                break;
                            }
                        }
                    }
                }

                // Emit the finished download with both old and new IDs
                handle
                    .emit(
                        "attachment_download_result",
                        serde_json::json!({
                            "profile_id": npub,
                            "msg_id": msg_id,
                            "old_id": attachment_id,
                            "id": file_hash,
                            "success": true,
                        }),
                    )
                    .unwrap();

                // Persist updated message/attachment metadata to the database
                if let Some(handle) = TAURI_APP.get() {
                    // Find and save only the updated message
                    let updated_chat = state.get_chat(&npub).unwrap();
                    let updated_message = {
                        updated_chat
                            .messages
                            .iter()
                            .find(|m| m.id == msg_id)
                            .cloned()
                    }
                    .unwrap();

                    // Update the frontend state
                    handle
                        .emit(
                            "message_update",
                            serde_json::json!({
                                "old_id": &updated_message.id,
                                "message": updated_message.clone(),
                                "chat_id": updated_chat.id()
                            }),
                        )
                        .unwrap();

                    // Drop the STATE lock before performing async I/O
                    drop(state);

                    let _ = db::save_message(handle.clone(), &npub, &updated_message).await;
                }
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

        // Bring shared state and the DB in sync so the app treats this attachment as downloaded,
        // matching the bookkeeping `download_attachment` performs on success.
        let file_hash = decrypted_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&attachment_id)
            .to_string();
        let updated_message = {
            let mut state = STATE.lock().await;
            let mut updated = None;
            for chat in &mut state.chats {
                let is_target_chat = match &chat.chat_type {
                    ChatType::MlsGroup => chat.id == npub,
                    ChatType::DirectMessage => chat.has_participant(&npub),
                };
                if is_target_chat {
                    if let Some(message) = chat.messages.iter_mut().find(|m| m.id == msg_id) {
                        if let Some(att) = message
                            .attachments
                            .iter_mut()
                            .find(|a| a.id == attachment_id)
                        {
                            att.id = file_hash.clone();
                            att.downloading = false;
                            att.downloaded = true;
                            att.path = decrypted_path.to_string_lossy().to_string();
                        }
                        updated = Some(message.clone());
                    }
                    break;
                }
            }
            updated
        };
        if let Some(message) = updated_message {
            handle
                .emit(
                    "message_update",
                    serde_json::json!({
                        "old_id": &message.id,
                        "message": &message,
                        "chat_id": &npub
                    }),
                )
                .ok();
            let _ = db::save_message(handle.clone(), &npub, &message).await;
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
