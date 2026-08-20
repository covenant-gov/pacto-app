//! Nostr-linked squad ACL: roster identity → Hats / SquadAdmin → capabilities.

mod capability;
mod evaluate;
mod identity;
mod write_serialize;

pub use capability::{GovCapability, SquadCapabilitiesDto};
pub use evaluate::{evaluate_squad_capabilities, require_capability};
pub use write_serialize::{with_gov_write_lock, with_gov_write_locks};

use tauri::{AppHandle, Runtime};

#[tauri::command]
pub async fn get_squad_capabilities<R: Runtime>(
    app: AppHandle<R>,
    parent_id: String,
    rpc_urls: Option<Vec<String>>,
) -> Result<SquadCapabilitiesDto, String> {
    evaluate_squad_capabilities(&app, parent_id.trim(), rpc_urls).await
}
