//! Application-wide configuration constants and the serializable [`AppConfig`]
//! snapshot exposed to the frontend through Tauri IPC.
//!
//! This module is the source of truth for runtime limits and feature flags that
//! both the Rust backend and the Svelte frontend must agree on. The frontend
//! fetches these values via [`get_app_config`] and validates them with Zod.

use serde::Serialize;

/// Maximum length of a squad or channel name.
pub const SQUAD_NAME_MAX_LENGTH: usize = 50;

/// Maximum length of a channel name.
///
/// Channels are created inside squads, so this is the same cap as squad names
/// for v1.
pub const CHANNEL_NAME_MAX_LENGTH: usize = 50;

/// Maximum number of author-selectable Commons tags on a squad or broadcast.
pub const COMMONS_MAX_TAGS: usize = 3;

/// Maximum number of owners/signers on a Safe deployed through the treasury flow.
pub const DEPLOY_SAFE_MAX_SIGNERS: usize = 10;

/// Maximum length of a role label in squad governance.
pub const ROLE_LABEL_MAX_LENGTH: usize = 32;

/// Maximum length of a wallet/account label.
pub const WALLET_ACCOUNT_LABEL_MAX_LENGTH: usize = 64;

/// Maximum length of a custom token symbol.
pub const CUSTOM_TOKEN_SYMBOL_MAX_LENGTH: usize = 16;

/// Number of PIN digits used for account unlock and key encryption.
pub const PIN_DIGIT_COUNT: u8 = 6;

/// Whether analytics/telemetry collection is enabled in this build.
/// Currently disabled by default; included as a proof-of-concept feature flag.
pub const ANALYTICS_ENABLED: bool = false;

/// Compile-time guard: PIN must be at least 4 digits to prevent dangerously low entropy.
/// If `PIN_DIGIT_COUNT` is ever changed from the v1 default of 6, this assertion must keep holding.
const _: () = assert!(PIN_DIGIT_COUNT >= 4, "PIN_DIGIT_COUNT must be at least 4");

/// Backend-owned application configuration snapshot.
///
/// All fields are derived from compiled constants so the frontend can adapt
/// validation and UX without hardcoding its own assumptions.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub squad_name_max_length: usize,
    pub channel_name_max_length: usize,
    pub commons_max_tags: usize,
    pub deploy_safe_max_signers: usize,
    pub role_label_max_length: usize,
    pub wallet_account_label_max_length: usize,
    pub custom_token_symbol_max_length: usize,
    pub pin_digit_count: u8,
    pub analytics_enabled: bool,
}

/// Returns the default application configuration snapshot.
pub fn default_app_config() -> AppConfig {
    AppConfig {
        squad_name_max_length: SQUAD_NAME_MAX_LENGTH,
        channel_name_max_length: CHANNEL_NAME_MAX_LENGTH,
        commons_max_tags: COMMONS_MAX_TAGS,
        deploy_safe_max_signers: DEPLOY_SAFE_MAX_SIGNERS,
        role_label_max_length: ROLE_LABEL_MAX_LENGTH,
        wallet_account_label_max_length: WALLET_ACCOUNT_LABEL_MAX_LENGTH,
        custom_token_symbol_max_length: CUSTOM_TOKEN_SYMBOL_MAX_LENGTH,
        pin_digit_count: PIN_DIGIT_COUNT,
        analytics_enabled: ANALYTICS_ENABLED,
    }
}

/// Tauri command returning the compiled application configuration.
#[tauri::command]
pub async fn get_app_config() -> AppConfig {
    default_app_config()
}
