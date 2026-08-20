//! Serialize concurrent governance writes per roster signer address.

use alloy::primitives::Address;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

static GOV_WRITE_LOCKS: Lazy<Mutex<HashMap<String, std::sync::Arc<AsyncMutex<()>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Hold a per-signer-EOA lock for the duration of a gov / Squad Admin write.
pub async fn with_gov_write_lock(signer_address: Address) -> OwnedMutexGuard<()> {
    let key = format!("{signer_address:#x}");
    let lock = {
        let mut map = GOV_WRITE_LOCKS.lock().expect("gov write lock map");
        map.entry(key)
            .or_insert_with(|| std::sync::Arc::new(AsyncMutex::new(())))
            .clone()
    };
    lock.lock_owned().await
}

/// One or two signer locks, acquired in address order to avoid deadlock.
pub struct GovWriteLockSet {
    _first: OwnedMutexGuard<()>,
    _second: Option<OwnedMutexGuard<()>>,
}

pub async fn with_gov_write_locks(a: Address, b: Address) -> GovWriteLockSet {
    if a == b {
        return GovWriteLockSet {
            _first: with_gov_write_lock(a).await,
            _second: None,
        };
    }
    let (lo, hi) = if a < b { (a, b) } else { (b, a) };
    GovWriteLockSet {
        _first: with_gov_write_lock(lo).await,
        _second: Some(with_gov_write_lock(hi).await),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::Address;

    #[tokio::test]
    async fn same_address_takes_one_lock() {
        let a = Address::repeat_byte(0x11);
        let g = with_gov_write_locks(a, a).await;
        assert!(g._second.is_none());
    }

    #[tokio::test]
    async fn distinct_addresses_take_two_locks() {
        let a = Address::repeat_byte(0x11);
        let b = Address::repeat_byte(0x22);
        let g = with_gov_write_locks(a, b).await;
        assert!(g._second.is_some());
    }
}
