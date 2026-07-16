//! Serialize concurrent governance writes per roster signer address.

use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

static GOV_WRITE_LOCKS: Lazy<Mutex<HashMap<String, std::sync::Arc<AsyncMutex<()>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Hold a per-address lock for the duration of a gov / Squad Admin write.
pub async fn with_gov_write_lock(roster_key: &str) -> OwnedMutexGuard<()> {
    let key = roster_key.trim().to_ascii_lowercase();
    let lock = {
        let mut map = GOV_WRITE_LOCKS.lock().expect("gov write lock map");
        map.entry(key)
            .or_insert_with(|| std::sync::Arc::new(AsyncMutex::new(())))
            .clone()
    };
    lock.lock_owned().await
}
