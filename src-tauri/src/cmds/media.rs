//! Attachment commands: blurhash previews, download, and save-to-disk.

use crate::util;
use crate::{
    calculate_file_hash, crypto, db, net, save_chat_messages, Attachment, Chat, ChatType, Message,
    STATE, TAURI_APP,
};
use nostr_sdk::prelude::*;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

/// Smallest possible AES-GCM payload (the auth tag); anything shorter is not a real blob.
const MIN_ENCRYPTED_ATTACHMENT_LEN: usize = 16;
const NO_DECRYPTION_KEY_DOWNLOAD: &str =
    "This attachment has no decryption key and cannot be downloaded here.";
const CORRUPTED_ATTACHMENT_REMOVED: &str = "Corrupted attachment removed. Please re-send the file.";

fn is_target_chat(chat: &Chat, npub: &str) -> bool {
    match &chat.chat_type {
        ChatType::MlsGroup | ChatType::PublicChannel => chat.id == npub,
        ChatType::DirectMessage => chat.has_participant(npub),
    }
}

/// Remote-plaintext marker: empty key/nonce means the attachment carries a provider URL.
fn is_remote_plaintext(attachment: &Attachment) -> bool {
    attachment.key.is_empty() || attachment.nonce.is_empty()
}

fn is_decryption_failure(error: &str) -> bool {
    error.contains("aead") || error.contains("decrypt")
}

pub(crate) fn attachments_dir<R: tauri::Runtime>(handle: &AppHandle<R>) -> Result<PathBuf, String> {
    let base_directory = if cfg!(target_os = "ios") {
        tauri::path::BaseDirectory::Document
    } else {
        tauri::path::BaseDirectory::Download
    };
    handle
        .path()
        .resolve("pacto", base_directory)
        .map_err(|e| format!("Failed to resolve download directory: {}", e))
}

fn existing_attachment_path(dir: &Path, id: &str, extension: &str) -> Option<String> {
    let path = dir.join(format!("{}.{}", id, extension));
    path.exists().then(|| path.to_string_lossy().into_owned())
}

struct AttachmentLocation<'a> {
    chat_id: String,
    message: &'a mut Message,
    index: usize,
}

fn locate_attachment<'a>(
    chats: &'a mut [Chat],
    npub: &str,
    msg_id: &str,
    attachment_id: &str,
) -> Option<AttachmentLocation<'a>> {
    for chat in chats {
        if !is_target_chat(chat, npub) {
            continue;
        }
        let chat_id = chat.id().clone();
        let Some(message) = chat.messages.iter_mut().find(|m| m.id == msg_id) else {
            continue;
        };
        let Some(index) = message
            .attachments
            .iter()
            .position(|a| a.id == attachment_id)
        else {
            continue;
        };
        return Some(AttachmentLocation {
            chat_id,
            message,
            index,
        });
    }
    None
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
    let AttachmentLocation {
        chat_id,
        message,
        index,
    } = locate_attachment(chats, npub, msg_id, lookup_id)?;
    let attachment = &mut message.attachments[index];
    attachment.id = new_id.to_string();
    attachment.downloading = false;
    attachment.downloaded = true;
    attachment.path = path.to_string();
    Some(DownloadedAttachmentSync {
        chat_id,
        db_attachment_id: lookup_id.to_string(),
        message: message.clone(),
    })
}

/// Clears the in-flight flag after a failed download so the user can retry.
fn fail_attachment_download(chats: &mut [Chat], npub: &str, msg_id: &str, attachment_id: &str) {
    if let Some(loc) = locate_attachment(chats, npub, msg_id, attachment_id) {
        let attachment = &mut loc.message.attachments[loc.index];
        attachment.downloading = false;
        attachment.downloaded = false;
    }
}

/// Drops an undecryptable attachment; returns the chat id and updated message to persist.
fn remove_attachment(
    chats: &mut [Chat],
    npub: &str,
    msg_id: &str,
    attachment_id: &str,
) -> Option<(String, Message)> {
    let loc = locate_attachment(chats, npub, msg_id, attachment_id)?;
    loc.message.attachments.remove(loc.index);
    Some((loc.chat_id, loc.message.clone()))
}

enum DownloadPlan {
    /// Another call is already fetching this attachment.
    InProgress,
    /// The decrypted file is already at the cache path.
    OnDisk(String),
    /// Needs a fetch; the in-flight flag is now set.
    Fetch(Box<Attachment>),
    Missing,
}

fn plan_download(
    chats: &mut [Chat],
    npub: &str,
    msg_id: &str,
    attachment_id: &str,
    dir: &Path,
) -> DownloadPlan {
    let Some(loc) = locate_attachment(chats, npub, msg_id, attachment_id) else {
        return DownloadPlan::Missing;
    };
    let attachment = &mut loc.message.attachments[loc.index];
    if attachment.downloading {
        return DownloadPlan::InProgress;
    }
    if let Some(path) = existing_attachment_path(dir, &attachment.id, &attachment.extension) {
        return DownloadPlan::OnDisk(path);
    }
    attachment.downloading = true;
    DownloadPlan::Fetch(Box::new(attachment.clone()))
}

fn emit_message_update<R: tauri::Runtime>(handle: &AppHandle<R>, message: &Message, chat_id: &str) {
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
    msg_id: &str,
    attachment_id: &str,
    path: &str,
) {
    if let Err(error) = db::set_attachment_downloaded(handle, msg_id, attachment_id, path) {
        eprintln!(
            "Failed to persist downloaded attachment {} of message {}: {}",
            attachment_id, msg_id, error
        );
    }
}

/// Success path shared by every download: update memory, notify the UI, persist.
async fn finish_attachment_download<R: tauri::Runtime>(
    handle: &AppHandle<R>,
    npub: &str,
    msg_id: &str,
    lookup_id: &str,
    new_id: &str,
    path: &str,
) -> Result<(), String> {
    let sync = {
        let mut state = STATE.lock().await;
        let sync =
            mark_attachment_downloaded(&mut state.chats, npub, msg_id, lookup_id, new_id, path);
        if let Some(sync) = &sync {
            emit_message_update(handle, &sync.message, &sync.chat_id);
        }
        sync
    };
    let sync =
        sync.ok_or_else(|| format!("Attachment not found: {} in message {}", lookup_id, msg_id))?;
    persist_attachment_downloaded(handle, msg_id, &sync.db_attachment_id, path);
    Ok(())
}

/// Fetches the encrypted blob and writes the decrypted file to the attachments dir.
async fn fetch_and_decrypt<R: tauri::Runtime>(
    handle: &AppHandle<R>,
    attachment: &Attachment,
) -> Result<PathBuf, String> {
    let encrypted_data = net::download(&attachment.url, handle, &attachment.id, None)
        .await
        .map_err(|e| format!("Failed to download attachment: {}", e))?;
    if encrypted_data.len() < MIN_ENCRYPTED_ATTACHMENT_LEN {
        return Err(format!(
            "Downloaded file too small ({} bytes). URL may be invalid or expired.",
            encrypted_data.len()
        ));
    }
    decrypt_and_save_attachment(handle, &encrypted_data, attachment).await
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

    let dir = attachments_dir(handle)?;

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

    fn with_attachment(mut chat: Chat, msg_id: &str, attachment_id: &str) -> Chat {
        chat.messages.push(Message {
            id: msg_id.to_string(),
            attachments: vec![sample_attachment(attachment_id)],
            ..Message::default()
        });
        chat
    }

    fn dm_with_attachment(peer: &str, msg_id: &str, attachment_id: &str) -> Chat {
        with_attachment(Chat::new_dm(peer.to_string()), msg_id, attachment_id)
    }

    fn mls_with_attachment(group_id: &str, msg_id: &str, attachment_id: &str) -> Chat {
        with_attachment(
            Chat::new_mls_group(group_id.to_string(), vec!["npub1member".to_string()]),
            msg_id,
            attachment_id,
        )
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
    fn marks_downloaded_in_an_mls_group_chat() {
        let mut chats = vec![mls_with_attachment("group1", "m1", "a1")];
        let sync =
            mark_attachment_downloaded(&mut chats, "group1", "m1", "a1", "a1", "/tmp/a1.png")
                .expect("group attachment should be found");
        assert_eq!(sync.chat_id, "group1");
        assert!(chats[0].messages[0].attachments[0].downloaded);
    }

    #[test]
    fn mls_chat_is_matched_by_group_id_not_participant() {
        let mut chats = vec![mls_with_attachment("group1", "m1", "a1")];
        assert!(
            mark_attachment_downloaded(&mut chats, "npub1member", "m1", "a1", "a1", "/x").is_none()
        );
    }

    #[test]
    fn returns_none_when_attachment_is_missing() {
        let mut chats = vec![dm_with_attachment("npub1peer", "m1", "nonce")];
        assert!(
            mark_attachment_downloaded(&mut chats, "npub1peer", "m1", "other", "hash", "/x")
                .is_none()
        );
    }

    #[test]
    fn returns_none_for_another_chat_or_message() {
        let mut chats = vec![dm_with_attachment("npub1peer", "m1", "nonce")];
        assert!(
            mark_attachment_downloaded(&mut chats, "npub1other", "m1", "nonce", "h", "/x")
                .is_none()
        );
        assert!(
            mark_attachment_downloaded(&mut chats, "npub1peer", "m2", "nonce", "h", "/x").is_none()
        );
        assert!(chats[0].messages[0].attachments[0].downloading);
    }

    #[test]
    fn failed_download_clears_flags_and_keeps_id_and_path() {
        let mut chats = vec![dm_with_attachment("npub1peer", "m1", "nonce")];
        chats[0].messages[0].attachments[0].downloaded = true;
        fail_attachment_download(&mut chats, "npub1peer", "m1", "nonce");
        let att = &chats[0].messages[0].attachments[0];
        assert!(!att.downloading);
        assert!(!att.downloaded);
        assert_eq!(att.id, "nonce");
        assert!(att.path.is_empty());
    }

    #[test]
    fn removes_only_the_corrupted_attachment() {
        let mut chats = vec![dm_with_attachment("npub1peer", "m1", "bad")];
        chats[0].messages[0]
            .attachments
            .push(sample_attachment("good"));
        let (chat_id, message) =
            remove_attachment(&mut chats, "npub1peer", "m1", "bad").expect("removed");
        assert_eq!(chat_id, "npub1peer");
        assert_eq!(message.attachments.len(), 1);
        assert_eq!(message.attachments[0].id, "good");
        assert!(remove_attachment(&mut chats, "npub1peer", "m1", "bad").is_none());
    }

    #[test]
    fn existing_attachment_path_checks_the_cache_dir() {
        let dir = std::env::temp_dir().join(format!("pacto-media-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("hash.png");
        std::fs::write(&file, b"png").unwrap();

        assert_eq!(
            existing_attachment_path(&dir, "hash", "png"),
            Some(file.to_string_lossy().into_owned())
        );
        assert_eq!(existing_attachment_path(&dir, "hash", "jpg"), None);
        assert_eq!(existing_attachment_path(&dir, "other", "png"), None);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn plan_fetches_and_flags_in_flight_when_not_on_disk() {
        let dir = std::env::temp_dir().join("pacto-media-test-empty-dir");
        let mut chats = vec![dm_with_attachment("npub1peer", "m1", "nonce")];
        chats[0].messages[0].attachments[0].downloading = false;

        let plan = plan_download(&mut chats, "npub1peer", "m1", "nonce", &dir);
        assert!(matches!(plan, DownloadPlan::Fetch(a) if a.id == "nonce"));
        assert!(chats[0].messages[0].attachments[0].downloading);

        let again = plan_download(&mut chats, "npub1peer", "m1", "nonce", &dir);
        assert!(matches!(again, DownloadPlan::InProgress));
    }

    #[test]
    fn plan_reports_missing_attachment() {
        let dir = std::env::temp_dir().join("pacto-media-test-empty-dir");
        let mut chats = vec![dm_with_attachment("npub1peer", "m1", "nonce")];
        let plan = plan_download(&mut chats, "npub1peer", "m1", "nope", &dir);
        assert!(matches!(plan, DownloadPlan::Missing));
    }

    #[test]
    fn plan_short_circuits_when_file_is_on_disk() {
        let dir = std::env::temp_dir().join(format!("pacto-media-plan-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("nonce.png"), b"png").unwrap();
        let mut chats = vec![dm_with_attachment("npub1peer", "m1", "nonce")];
        chats[0].messages[0].attachments[0].downloading = false;

        let plan = plan_download(&mut chats, "npub1peer", "m1", "nonce", &dir);
        assert!(matches!(plan, DownloadPlan::OnDisk(_)));
        assert!(!chats[0].messages[0].attachments[0].downloading);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn decryption_failures_are_recognised_by_message() {
        assert!(is_decryption_failure("aead::Error"));
        assert!(is_decryption_failure("failed to decrypt payload"));
        assert!(!is_decryption_failure("Failed to write file: disk full"));
        assert!(!is_decryption_failure(
            "Failed to download attachment: timeout"
        ));
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
                ChatType::MlsGroup | ChatType::PublicChannel => chat.id == npub,
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

/// Resolves once the attachment is on disk (also when it already was, or another call is
/// fetching it); rejects with a user-facing reason. Success reaches the UI as `message_update`.
#[tauri::command]
pub(crate) async fn download_attachment(
    npub: String,
    msg_id: String,
    attachment_id: String,
) -> Result<(), String> {
    let handle = TAURI_APP.get().ok_or("App handle not available")?;
    let dir = attachments_dir(handle)?;

    let plan = {
        let mut state = STATE.lock().await;
        plan_download(&mut state.chats, &npub, &msg_id, &attachment_id, &dir)
    };
    let attachment = match plan {
        DownloadPlan::InProgress => return Ok(()),
        DownloadPlan::Missing => {
            return Err(format!(
                "Attachment not found: {} in message {}",
                attachment_id, msg_id
            ))
        }
        DownloadPlan::OnDisk(path) => {
            return finish_attachment_download(
                handle,
                &npub,
                &msg_id,
                &attachment_id,
                &attachment_id,
                &path,
            )
            .await
        }
        DownloadPlan::Fetch(attachment) => attachment,
    };

    // Remote-plaintext attachment (e.g. a Klipy GIF): never a general-purpose fetch
    // primitive. Rendering one goes through its own allowlisted command
    // (`klipy_fetch_media`); this path refuses rather than fetching an
    // attacker-supplied URL on the user's behalf.
    if is_remote_plaintext(&attachment) {
        let mut state = STATE.lock().await;
        fail_attachment_download(&mut state.chats, &npub, &msg_id, &attachment_id);
        return Err(NO_DECRYPTION_KEY_DOWNLOAD.to_string());
    }

    let _ = handle.emit(
        "attachment_download_progress",
        serde_json::json!({ "id": &attachment.id, "progress": 0 }),
    );

    match fetch_and_decrypt(handle, &attachment).await {
        Ok(path) => {
            let file_hash = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(&attachment_id)
                .to_string();
            finish_attachment_download(
                handle,
                &npub,
                &msg_id,
                &attachment_id,
                &file_hash,
                &path.to_string_lossy(),
            )
            .await
        }
        Err(error) => {
            let corrupted = is_decryption_failure(&error);
            if corrupted {
                eprintln!(
                    "Decryption failed for attachment {}: corrupted keys/data mismatch",
                    attachment_id
                );
            }
            let removed = {
                let mut state = STATE.lock().await;
                fail_attachment_download(&mut state.chats, &npub, &msg_id, &attachment_id);
                if corrupted {
                    remove_attachment(&mut state.chats, &npub, &msg_id, &attachment_id)
                } else {
                    None
                }
            };
            if let Some((chat_id, message)) = removed {
                if let Err(e) = save_chat_messages(handle.clone(), &chat_id, &[message]).await {
                    eprintln!("Failed to persist removal of corrupted attachment: {}", e);
                }
            }
            Err(if corrupted {
                CORRUPTED_ATTACHMENT_REMOVED.to_string()
            } else {
                error
            })
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

    let attachment = {
        let state = STATE.lock().await;
        state
            .chats
            .iter()
            .find(|chat| is_target_chat(chat, &npub))
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

    // "Save as…" is never offered for remote-plaintext attachments: Klipy's terms
    // forbid retaining its media on disk.
    if is_remote_plaintext(&attachment) {
        return Err("This attachment has no decryption key and cannot be saved".to_string());
    }

    let dir = attachments_dir(handle)?;
    let source_path = match existing_attachment_path(&dir, &attachment.id, &attachment.extension) {
        Some(path) => PathBuf::from(path),
        None => {
            let decrypted_path = fetch_and_decrypt(handle, &attachment).await?;
            let file_hash = decrypted_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(&attachment_id)
                .to_string();
            // The message may have gone away mid-download; the file is still saved.
            let _ = finish_attachment_download(
                handle,
                &npub,
                &msg_id,
                &attachment_id,
                &file_hash,
                &decrypted_path.to_string_lossy(),
            )
            .await;
            decrypted_path
        }
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
