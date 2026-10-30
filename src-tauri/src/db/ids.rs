use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, Runtime};

/// In-memory cache for chat_identifier → integer ID mappings
/// This avoids database lookups on every message operation
pub(super) static CHAT_ID_CACHE: Lazy<Arc<RwLock<HashMap<String, i64>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

/// In-memory cache for npub → integer ID mappings
/// This avoids database lookups on every message operation
static USER_ID_CACHE: Lazy<Arc<RwLock<HashMap<String, i64>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

/// Helper function to get or create integer chat ID from identifier
/// Uses in-memory cache for maximum speed, only hits DB on cache miss
pub(super) fn get_or_create_chat_id<R: Runtime>(
    handle: &AppHandle<R>,
    chat_identifier: &str,
) -> Result<i64, String> {
    // Check cache first (fast path - no DB access)
    {
        let cache = CHAT_ID_CACHE.read().unwrap();
        if let Some(&id) = cache.get(chat_identifier) {
            return Ok(id);
        }
    }

    // Cache miss - check database
    let conn = crate::account_manager::get_db_connection(handle)?;

    // Try to get existing ID from database
    let existing_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM chats WHERE chat_identifier = ?1",
            rusqlite::params![chat_identifier],
            |row| row.get(0),
        )
        .ok();

    let id = if let Some(id) = existing_id {
        id
    } else {
        // Create new chat entry with minimal data
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        // Determine chat type and participants based on chat_identifier format
        // DM chats have npub as identifier, MLS groups have hex group ID
        let (chat_type, participants_json) = if chat_identifier.starts_with("npub1") {
            // DM chat: participant is the other party (the chat_identifier itself)
            (0, format!("[\"{}\"]", chat_identifier))
        } else {
            // MLS group: participants managed separately, start with empty
            (1, "[]".to_string())
        };

        conn.execute(
            "INSERT INTO chats (chat_identifier, chat_type, participants, last_read, created_at, metadata)
             VALUES (?1, ?2, ?3, '', ?4, '{}')",
            rusqlite::params![chat_identifier, chat_type, participants_json, now as i64],
        ).map_err(|e| format!("Failed to create chat: {}", e))?;

        // Get the auto-generated ID
        conn.last_insert_rowid()
    };

    // Return connection to pool
    crate::account_manager::return_db_connection(conn);

    // Update cache with the ID (write to both DB and cache)
    {
        let mut cache = CHAT_ID_CACHE.write().unwrap();
        cache.insert(chat_identifier.to_string(), id);
    }

    Ok(id)
}

/// Virtual channel ids (UI-only, no MLS history row until first real message elsewhere).
fn is_pseudo_chat_identifier(id: &str) -> bool {
    id == "__dashboard__"
}

/// Resolve `chats.id` for loading message history. MLS groups get a DB row on demand so a brand-new
/// channel does not error before the first persisted message. DMs (`npub1`) and pseudo channels stay lookup-only.
pub fn resolve_chat_id_for_message_load<R: Runtime>(
    handle: &AppHandle<R>,
    chat_identifier: &str,
) -> Result<i64, String> {
    if chat_identifier.starts_with("npub1") || is_pseudo_chat_identifier(chat_identifier) {
        get_chat_id_by_identifier(handle, chat_identifier)
    } else {
        get_or_create_chat_id(handle, chat_identifier)
    }
}

/// Helper function to get integer chat ID from identifier (lookup only, no creation)
/// Returns an error if the chat doesn't exist
pub fn get_chat_id_by_identifier<R: Runtime>(
    handle: &AppHandle<R>,
    chat_identifier: &str,
) -> Result<i64, String> {
    // Check cache first (fast path - no DB access)
    {
        let cache = CHAT_ID_CACHE.read().unwrap();
        if let Some(&id) = cache.get(chat_identifier) {
            return Ok(id);
        }
    }

    // Cache miss - check database
    let conn = crate::account_manager::get_db_connection(handle)?;

    let id: i64 = conn
        .query_row(
            "SELECT id FROM chats WHERE chat_identifier = ?1",
            rusqlite::params![chat_identifier],
            |row| row.get(0),
        )
        .map_err(|_| format!("Chat not found: {}", chat_identifier))?;

    crate::account_manager::return_db_connection(conn);

    // Update cache
    {
        let mut cache = CHAT_ID_CACHE.write().unwrap();
        cache.insert(chat_identifier.to_string(), id);
    }

    Ok(id)
}

/// Helper function to get or create integer user ID from npub
/// Uses in-memory cache for maximum speed, only hits DB on cache miss
pub(super) fn get_or_create_user_id<R: Runtime>(
    handle: &AppHandle<R>,
    npub: &str,
) -> Result<Option<i64>, String> {
    // If npub is empty, return None (for messages without author)
    if npub.is_empty() {
        return Ok(None);
    }

    // Check cache first (fast path - no DB access)
    {
        let cache = USER_ID_CACHE.read().unwrap();
        if let Some(&id) = cache.get(npub) {
            return Ok(Some(id));
        }
    }

    // Cache miss - check database
    let conn = crate::account_manager::get_db_connection(handle)?;

    // Try to get existing ID from database
    let existing_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM profiles WHERE npub = ?1",
            rusqlite::params![npub],
            |row| row.get(0),
        )
        .ok();

    let id = if let Some(id) = existing_id {
        id
    } else {
        // Create new profile entry with minimal data (just the npub)
        conn.execute(
            "INSERT INTO profiles (npub, name, display_name) VALUES (?1, '', '')",
            rusqlite::params![npub],
        )
        .map_err(|e| format!("Failed to create profile stub: {}", e))?;

        // Get the auto-generated ID
        conn.last_insert_rowid()
    };

    // Return connection to pool
    crate::account_manager::return_db_connection(conn);

    // Update cache with the ID (write to both DB and cache)
    {
        let mut cache = USER_ID_CACHE.write().unwrap();
        cache.insert(npub.to_string(), id);
    }

    Ok(Some(id))
}

/// Preload all ID mappings into memory cache on app startup
/// This ensures all subsequent lookups are instant (no DB access)
pub async fn preload_id_caches<R: Runtime>(handle: &AppHandle<R>) -> Result<(), String> {
    let _npub = match crate::account_manager::get_current_account() {
        Ok(n) => n,
        Err(_) => return Ok(()), // No account selected, skip
    };

    let conn = crate::account_manager::get_db_connection(handle)?;

    // Load all chat ID mappings
    {
        let mut stmt = conn
            .prepare("SELECT chat_identifier, id FROM chats")
            .map_err(|e| format!("Failed to prepare chat query: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| format!("Failed to query chats: {}", e))?;

        let mut cache = CHAT_ID_CACHE.write().unwrap();
        cache.clear();

        for row in rows {
            let (identifier, id) = row.map_err(|e| format!("Failed to read chat row: {}", e))?;
            cache.insert(identifier, id);
        }
    }

    // Load all user ID mappings
    {
        let mut stmt = conn
            .prepare("SELECT npub, id FROM profiles")
            .map_err(|e| format!("Failed to prepare profile query: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| format!("Failed to query profiles: {}", e))?;

        let mut cache = USER_ID_CACHE.write().unwrap();
        cache.clear();

        for row in rows {
            let (npub, id) = row.map_err(|e| format!("Failed to read profile row: {}", e))?;
            cache.insert(npub, id);
        }
    }

    // Return connection to pool
    crate::account_manager::return_db_connection(conn);

    Ok(())
}

/// Clear ID caches (useful when switching accounts)
pub fn clear_id_caches() {
    CHAT_ID_CACHE.write().unwrap().clear();
    USER_ID_CACHE.write().unwrap().clear();
}

