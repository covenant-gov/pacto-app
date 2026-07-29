use serde::{Deserialize, Serialize};
use tauri::Emitter;
use crate::Message;
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Chat {
    pub id: String,
    pub chat_type: ChatType,
    pub participants: Vec<String>, // List of npubs
    pub messages: Vec<Message>,
    pub last_read: String,
    pub created_at: u64,
    pub metadata: ChatMetadata,
    pub notification_level: NotificationLevel,
    /// Typing participants for group chats (npub -> expires_at timestamp)
    /// Memory-only, never persisted to disk
    #[serde(skip)]
    pub typing_participants: HashMap<String, u64>,
}

impl Chat {
    pub fn new(id: String, chat_type: ChatType, participants: Vec<String>) -> Self {
        Self {
            id,
            chat_type,
            participants,
            messages: Vec::new(),
            last_read: String::new(),
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            metadata: ChatMetadata::new(),
            notification_level: NotificationLevel::default(),
            typing_participants: HashMap::new(),
        }
    }

    /// Create a new DM chat with another user
    pub fn new_dm(their_npub: String) -> Self {
        Self::new(their_npub.clone(), ChatType::DirectMessage, vec![their_npub])
    }

    /// Create a new MLS group chat
    pub fn new_mls_group(group_id: String, participants: Vec<String>) -> Self {
        Self::new(group_id, ChatType::MlsGroup, participants)
    }

    /// Get the last message timestamp
    pub fn last_message_time(&self) -> Option<u64> {
        self.messages.last().map(|msg| msg.at)
    }

    /// Get a mutable message by ID
    pub fn get_message_mut(&mut self, id: &str) -> Option<&mut Message> {
        self.messages.iter_mut().find(|msg| msg.id == id)
    }

    /// Set the Last Received message as the "Last Read" message
    pub fn set_as_read(&mut self) -> bool {
        // Ensure we have at least one message received from others
        for msg in self.messages.iter().rev() {
            if !msg.mine {
                // Found the most recent message from others
                self.last_read = msg.id.clone();
                return true;
            }
        }
        
        // No messages from others, can't mark anything as read
        false
    }

    /// Add a Message to this Chat
    /// 
    /// This method internally checks for and avoids duplicate messages.
    pub fn internal_add_message(&mut self, message: Message) -> bool {
        // Make sure we don't add the same message twice
        if self.messages.iter().any(|m| m.id == message.id) {
            // Message is already known by the state
            return false;
        }

        // Fast path for common cases: newest or oldest messages
        if self.messages.is_empty() {
            // First message
            self.messages.push(message);
        } else if message.at >= self.messages.last().unwrap().at {
            // Common case 1: Latest message (append to end)
            self.messages.push(message);
        } else if message.at <= self.messages.first().unwrap().at {
            // Common case 2: Oldest message (insert at beginning)
            self.messages.insert(0, message);
        } else {
            // Less common case: Message belongs somewhere in the middle
            self.messages.insert(
                self.messages.binary_search_by(|m| m.at.cmp(&message.at)).unwrap_or_else(|idx| idx),
                message
            );
        }
        true
    }

    /// Update reply context for any messages in this chat that reference `original.id`.
    /// Returns the updated messages so callers can emit UI updates.
    /// For DM chats, `is_original_mine` is used to derive the author's npub because DM
    /// messages do not store the sender's npub directly.
    pub fn update_replies_to_message(
        &mut self,
        original: &Message,
        is_original_mine: bool,
    ) -> Vec<Message> {
        let npub = if self.chat_type == ChatType::DirectMessage {
            if is_original_mine {
                crate::account_manager::get_current_account().ok()
            } else {
                self.participants.first().cloned()
            }
        } else {
            original.npub.clone()
        };

        let mut updated = Vec::new();
        for msg in self.messages.iter_mut() {
            if msg.replied_to == original.id && msg.replied_to_content.is_none() {
                msg.replied_to_content = Some(original.content.clone());
                msg.replied_to_npub = npub.clone();
                msg.replied_to_has_attachment = Some(!original.attachments.is_empty());
                updated.push(msg.clone());
            }
        }
        updated
    }

    /// Add a Reaction - if it was not already added
    pub fn add_reaction(&mut self, reaction: crate::Reaction, message_id: &str) -> bool {
        // Find the message
        if let Some(msg) = self.get_message_mut(message_id) {
            // Make sure we don't add the same reaction twice
            if !msg.reactions.iter().any(|r| r.id == reaction.id) {
                msg.reactions.push(reaction);
                true
            } else {
                // Reaction was already added previously
                false
            }
        } else {
            false
        }
    }

    /// Get other participant for DM chats
    pub fn get_other_participant(&self, my_npub: &str) -> Option<String> {
        match self.chat_type {
            ChatType::DirectMessage => {
                self.participants.iter()
                    .find(|&p| p != my_npub)
                    .cloned()
            }
            ChatType::MlsGroup => None, // Groups don't have a single "other" participant
        }
    }

    /// Check if this is a DM with a specific user
    pub fn is_dm_with(&self, npub: &str) -> bool {
        matches!(self.chat_type, ChatType::DirectMessage) && self.participants.contains(&npub.to_string())
    }

    /// Check if this is an MLS group
    pub fn is_mls_group(&self) -> bool {
        matches!(self.chat_type, ChatType::MlsGroup)
    }

    /// Check if user is a participant in this chat
    pub fn has_participant(&self, npub: &str) -> bool {
        self.participants.contains(&npub.to_string())
    }

    /// Get active typers (non-expired) for group chats
    /// Returns a list of npubs that are currently typing
    pub fn get_active_typers(&self) -> Vec<String> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        self.typing_participants
            .iter()
            .filter(|(_, &expires_at)| expires_at > now)
            .map(|(npub, _)| npub.clone())
            .collect()
    }

    /// Update typing state for a participant in a group chat
    /// Automatically cleans up expired entries
    pub fn update_typing_participant(&mut self, npub: String, expires_at: u64) {
        // Add or update the typing participant
        self.typing_participants.insert(npub, expires_at);
        
        // Clean up expired entries
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        self.typing_participants.retain(|_, &mut exp| exp > now);
    }

    // Getter methods for private fields
    pub fn id(&self) -> &String {
        &self.id
    }

    pub fn chat_type(&self) -> &ChatType {
        &self.chat_type
    }

    pub fn participants(&self) -> &Vec<String> {
        &self.participants
    }

    pub fn last_read(&self) -> &String {
        &self.last_read
    }

    pub fn created_at(&self) -> u64 {
        self.created_at
    }

    pub fn metadata(&self) -> &ChatMetadata {
        &self.metadata
    }

    pub fn notification_level(&self) -> NotificationLevel {
        self.notification_level
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum ChatType {
    DirectMessage,
    MlsGroup,
    // Future types can be added here
}

impl ChatType {
    /// Convert ChatType to integer for database storage
    /// 0 = DirectMessage, 1 = MlsGroup
    pub fn to_i32(&self) -> i32 {
        match self {
            ChatType::DirectMessage => 0,
            ChatType::MlsGroup => 1,
        }
    }
    
    /// Convert integer from database to ChatType
    pub fn from_i32(value: i32) -> Self {
        match value {
            1 => ChatType::MlsGroup,
            _ => ChatType::DirectMessage, // Default to DM for safety
        }
    }
}

/// Per-chat notification level (R4). Defaults to Mentions for existing and
/// newly created chats alike (R10) — the column default alone delivers this,
/// with no carry-over from the old `muted` boolean (KTD5).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum NotificationLevel {
    All,
    #[default]
    Mentions,
    Nothing,
}

impl NotificationLevel {
    /// Column representation. Kept out of the derive so the DB and wire
    /// formats can diverge later without one governing the other.
    pub fn as_db_str(&self) -> &'static str {
        match self {
            NotificationLevel::All => "all",
            NotificationLevel::Mentions => "mentions",
            NotificationLevel::Nothing => "nothing",
        }
    }

    /// Permissive parse: an unrecognized stored value reads back as the
    /// default rather than failing the row.
    pub fn from_db_str(value: &str) -> Self {
        match value {
            "all" => NotificationLevel::All,
            "nothing" => NotificationLevel::Nothing,
            _ => NotificationLevel::Mentions,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct ChatMetadata {
    pub custom_fields: HashMap<String, String>, // For extensibility
}

impl ChatMetadata {
    pub fn new() -> Self {
        Self {
            custom_fields: HashMap::new(),
        }
    }

    /// Set the group name in custom_fields
    pub fn set_name(&mut self, name: String) {
        self.custom_fields.insert("name".to_string(), name);
    }

    /// Get the group name from custom_fields
    pub fn get_name(&self) -> Option<&str> {
        self.custom_fields.get("name").map(|s| s.as_str())
    }

    /// Set the member count in custom_fields
    pub fn set_member_count(&mut self, count: usize) {
        self.custom_fields.insert("member_count".to_string(), count.to_string());
    }

    /// Get the member count from custom_fields
    pub fn get_member_count(&self) -> Option<usize> {
        self.custom_fields.get("member_count").and_then(|s| s.parse().ok())
    }
}

//// Marks a specific message as read for a chat.
/// Behavior:
///  - If message_id is Some(id): set chat.last_read = id.
///  - Else: call chat.set_as_read() to pick the last non-mine message.
///  - Persist the chat (outside the STATE lock) and update unread counter on success.
#[tauri::command]
pub async fn mark_as_read(chat_id: String, message_id: Option<String>) -> bool {
    // Apply the read change regardless of window focus; frontend intent is authoritative
    let handle = crate::TAURI_APP.get().unwrap();

    // Apply the read change to the specified chat
    let (result, chat_id_for_save) = {
        let mut state = crate::STATE.lock().await;
        let mut result = false;
        let mut chat_id_for_save: Option<String> = None;

        if let Some(chat) = state.chats.iter_mut().find(|c| c.id == chat_id) {
            if let Some(msg_id) = &message_id {
                // Explicit message -> set that as last_read
                chat.last_read = msg_id.clone();
                result = true;
                chat_id_for_save = Some(chat.id.clone());
            } else {
                // No explicit message -> fall back to set_as_read behaviour
                result = chat.set_as_read();
                if result {
                    chat_id_for_save = Some(chat.id.clone());
                }
            }
        }

        (result, chat_id_for_save)
    };

    // Update the unread counter and save to DB if the marking was successful
    if result {
        // Update the badge count
        crate::update_unread_counter(handle.clone()).await;
        crate::catch_up::resolve_chat_message_entries_for_handle(handle, &chat_id).await;

        // Save the updated chat to the DB
        if let Some(chat_id) = chat_id_for_save {
            // Get the updated chat to save its metadata (including last_read)
            let updated_chat = {
                let state = crate::STATE.lock().await;
                state.get_chat(&chat_id).cloned()
            };

            // Save to DB
            if let Some(chat) = updated_chat {
                let _ = crate::db::save_chat(handle.clone(), &chat).await;
            }
        }
    }

    result
}

/// Payload for `chat_notification_level_changed`. Deliberately excludes the rest of the
/// chat (messages, participants) — every listener only needs the id and the new level.
#[derive(Serialize, Clone)]
struct NotificationLevelChangedPayload {
    chat_id: String,
    notification_level: NotificationLevel,
}

/// Sets a chat's notification level (R4/R5/R6). Mirrors `toggle_blocked`'s end-to-end
/// shape: mutate state, persist through `save_chat`, emit an event every listening surface
/// can pick up, then refresh badges synchronously. A level change flips U2's
/// badge-contribution predicate for this chat immediately (R17), so calling the debounced
/// arrival path here would leave a stale badge for the debounce window.
#[tauri::command]
pub async fn set_notification_level(chat_id: String, level: NotificationLevel) -> bool {
    let handle = crate::TAURI_APP.get().unwrap();

    let updated = {
        let mut state = crate::STATE.lock().await;
        match state.chats.iter_mut().find(|c| c.id == chat_id) {
            Some(chat) => {
                chat.notification_level = level;
                chat.clone()
            }
            None => return false,
        }
    };

    let _ = crate::db::save_chat(handle.clone(), &updated).await;

    let _ = handle.emit(
        "chat_notification_level_changed",
        &NotificationLevelChangedPayload {
            chat_id: updated.id.clone(),
            notification_level: level,
        },
    );

    // Immediate (non-debounced) recompute so badges move in the same interaction (R17).
    crate::update_unread_counter(handle.clone()).await;

    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Message;

    fn text_message(id: &str, content: &str) -> Message {
        Message {
            id: id.to_string(),
            content: content.to_string(),
            at: 1,
            ..Default::default()
        }
    }

    fn reply_message(id: &str, content: &str, replied_to: &str) -> Message {
        Message {
            id: id.to_string(),
            content: content.to_string(),
            replied_to: replied_to.to_string(),
            at: 2,
            ..Default::default()
        }
    }

    #[test]
    fn update_replies_fills_missing_reply_context() {
        let mut chat = Chat::new_dm("npub1original".to_string());
        let original = text_message("orig-id", "original message");
        let reply = reply_message("reply-id", "reply message", "orig-id");
        chat.internal_add_message(reply);
        chat.internal_add_message(original.clone());

        let updated = chat.update_replies_to_message(&original, false);

        assert_eq!(updated.len(), 1);
        assert_eq!(updated[0].id, "reply-id");
        assert_eq!(updated[0].replied_to_content.as_deref(), Some("original message"));
        assert_eq!(updated[0].replied_to_npub.as_deref(), Some("npub1original"));
        let reply_in_chat = chat.messages.iter().find(|m| m.id == "reply-id").unwrap();
        assert_eq!(reply_in_chat.replied_to_content.as_deref(), Some("original message"));
        assert_eq!(reply_in_chat.replied_to_npub.as_deref(), Some("npub1original"));
    }

    #[test]
    fn update_replies_uses_current_account_for_own_messages() {
        // For a DM, when the original message is ours, the method looks up the current
        // account. In a test environment there is no current account, so the npub falls
        // back to None, but the content is still filled.
        let mut chat = Chat::new_dm("npub1original".to_string());
        let original = text_message("orig-id", "original message");
        let reply = reply_message("reply-id", "reply message", "orig-id");
        chat.internal_add_message(reply);
        chat.internal_add_message(original.clone());

        let updated = chat.update_replies_to_message(&original, true);

        assert_eq!(updated.len(), 1);
        assert_eq!(updated[0].replied_to_content.as_deref(), Some("original message"));
        let reply_in_chat = chat.messages.iter().find(|m| m.id == "reply-id").unwrap();
        assert_eq!(reply_in_chat.replied_to_content.as_deref(), Some("original message"));
    }

    #[test]
    fn update_replies_skips_messages_with_existing_context() {
        let mut chat = Chat::new_dm("npub1original".to_string());
        let original = text_message("orig-id", "new original");
        let reply = Message {
            id: "reply-id".to_string(),
            content: "reply".to_string(),
            replied_to: "orig-id".to_string(),
            replied_to_content: Some("old original".to_string()),
            at: 2,
            ..Default::default()
        };
        chat.internal_add_message(reply);
        chat.internal_add_message(original.clone());

        let updated = chat.update_replies_to_message(&original, false);

        assert!(updated.is_empty());
        let reply_in_chat = chat.messages.iter().find(|m| m.id == "reply-id").unwrap();
        assert_eq!(reply_in_chat.replied_to_content.as_deref(), Some("old original"));
    }

    #[test]
    fn update_replies_only_affects_messages_referencing_original() {
        let mut chat = Chat::new_dm("npub1original".to_string());
        let original = text_message("orig-id", "original");
        let unrelated = reply_message("unrelated-id", "unrelated", "other-id");
        let reply = reply_message("reply-id", "reply", "orig-id");
        chat.internal_add_message(unrelated);
        chat.internal_add_message(reply);
        chat.internal_add_message(original.clone());

        let updated = chat.update_replies_to_message(&original, false);

        assert_eq!(updated.len(), 1);
        assert_eq!(updated[0].id, "reply-id");
        assert_eq!(updated[0].replied_to_npub.as_deref(), Some("npub1original"));
        let unrelated_in_chat = chat.messages.iter().find(|m| m.id == "unrelated-id").unwrap();
        assert!(unrelated_in_chat.replied_to_content.is_none());
    }

    #[test]
    fn update_replies_updates_multiple_replies() {
        let mut chat = Chat::new_dm("npub1original".to_string());
        let original = text_message("orig-id", "original");
        let reply1 = reply_message("reply-1", "first", "orig-id");
        let reply2 = reply_message("reply-2", "second", "orig-id");
        chat.internal_add_message(reply1);
        chat.internal_add_message(reply2);
        chat.internal_add_message(original.clone());

        let updated = chat.update_replies_to_message(&original, false);

        assert_eq!(updated.len(), 2);
    }

    #[test]
    fn update_replies_uses_message_npub_for_group_chats() {
        let mut chat = Chat::new("group-1".to_string(), ChatType::MlsGroup, vec![]);
        let original = Message {
            id: "orig-id".to_string(),
            content: "original".to_string(),
            npub: Some("npub1sender".to_string()),
            at: 1,
            ..Default::default()
        };
        let reply = reply_message("reply-id", "reply", "orig-id");
        chat.internal_add_message(reply);
        chat.internal_add_message(original.clone());

        let updated = chat.update_replies_to_message(&original, false);

        assert_eq!(updated.len(), 1);
        assert_eq!(updated[0].replied_to_npub.as_deref(), Some("npub1sender"));
    }

    #[test]
    fn new_chat_defaults_to_mentions() {
        let chat = Chat::new_dm("npub1peer".to_string());
        assert_eq!(chat.notification_level(), NotificationLevel::Mentions);
    }

    #[test]
    fn notification_level_db_round_trip_for_all_three_levels() {
        for level in [NotificationLevel::All, NotificationLevel::Mentions, NotificationLevel::Nothing] {
            let db_str = level.as_db_str();
            assert_eq!(NotificationLevel::from_db_str(db_str), level);
        }
    }

    #[test]
    fn unrecognized_notification_level_string_reads_back_as_mentions() {
        assert_eq!(NotificationLevel::from_db_str("bogus"), NotificationLevel::Mentions);
        assert_eq!(NotificationLevel::from_db_str(""), NotificationLevel::Mentions);
    }

    /// Exercises the exact persistence path `set_notification_level` uses once it finds the
    /// chat in `STATE`: mutate `notification_level`, `save_chat`, then read it back as a fresh
    /// load would after a restart. The command itself resolves its `AppHandle` from the
    /// process-global `TAURI_APP` (bound to the real `Wry` runtime), which no test can populate
    /// with `tauri::test::mock_app()`'s `MockRuntime` handle — but `save_chat`/`get_all_chats`
    /// are the same generic-runtime calls the command makes, so this covers the persistence
    /// contract the command depends on.
    #[tokio::test]
    async fn set_notification_level_persists_and_round_trips_on_read() {
        let test_npub = "npub1notiflevelroundtriptest";
        crate::account_manager::set_current_account(test_npub.to_string()).unwrap();
        crate::account_manager::close_db_connection();

        let app = tauri::test::mock_app();

        let profile_dir = crate::account_manager::get_profile_directory(app.handle(), test_npub).unwrap();
        let _ = std::fs::remove_dir_all(&profile_dir);

        let db_path = crate::account_manager::get_database_path(app.handle(), test_npub).unwrap();
        let mut conn = rusqlite::Connection::open(&db_path).unwrap();
        crate::migrations::run_migrations(&mut conn).unwrap();
        crate::account_manager::return_db_connection(conn);

        let chat_id = "npub1notiflevelroundtrippeer";
        let mut chat = Chat::new_dm(chat_id.to_string());
        assert_eq!(chat.notification_level, NotificationLevel::Mentions);

        chat.notification_level = NotificationLevel::Nothing;
        crate::db::save_chat(app.handle().clone(), &chat).await.unwrap();

        let reloaded = crate::db::get_all_chats(app.handle())
            .await
            .unwrap()
            .into_iter()
            .find(|c| c.id == chat_id)
            .expect("saved chat should read back from a fresh query");
        assert_eq!(reloaded.notification_level, NotificationLevel::Nothing);

        // Raising it again round-trips too, not just the initial non-default write.
        chat.notification_level = NotificationLevel::All;
        crate::db::save_chat(app.handle().clone(), &chat).await.unwrap();
        let reloaded_again = crate::db::get_all_chats(app.handle())
            .await
            .unwrap()
            .into_iter()
            .find(|c| c.id == chat_id)
            .expect("saved chat should read back from a fresh query");
        assert_eq!(reloaded_again.notification_level, NotificationLevel::All);

        crate::account_manager::close_db_connection();
    }
}