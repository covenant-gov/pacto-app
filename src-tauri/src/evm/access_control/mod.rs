//! Nostr-linked squad ACL: roster identity → Hats / SquadAdmin → capabilities.

mod capability;
mod evaluate;
mod identity;
mod write_serialize;

pub use capability::{
    capability_allowed, deny_reason, GovCapability, SquadCapabilitiesDto, CAPABILITY_KEYS,
};
pub use evaluate::{evaluate_squad_capabilities, require_capability};
pub use identity::resolve_acl_roster_address;
pub use write_serialize::with_gov_write_lock;

use tauri::{AppHandle, Runtime};

#[tauri::command]
pub async fn get_squad_capabilities<R: Runtime>(
    app: AppHandle<R>,
    parent_id: String,
) -> Result<SquadCapabilitiesDto, String> {
    evaluate_squad_capabilities(&app, parent_id.trim()).await
}
