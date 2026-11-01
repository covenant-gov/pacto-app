//! Application-wide configuration constants and the serializable [`AppConfig`]
//! snapshot exposed to the frontend through Tauri IPC.
//!
//! This module is the source of truth for runtime limits and feature flags that
//! both the Rust backend and the Svelte frontend must agree on. See
//! `docs/RUNTIME_CONFIG.md` for the full field table and how to add a new limit.

use serde::Serialize;

/// Maximum length of a squad or channel name.
pub const SQUAD_NAME_MAX_LENGTH: usize = 50;

/// Maximum length of a channel name, enforced in `create_group_chat` (the only
/// caller of that command with a user-typed name; squad root creation always
/// passes the fixed `announcements` constant).
///
/// Independently configurable from squad names; tighter default fits the
/// channel list/header UI better than the squad name cap.
pub const CHANNEL_NAME_MAX_LENGTH: usize = 35;

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

/// An experimental feature users can opt in to from Settings. Display copy lives in the
/// i18n catalogs under `settings.experimental.flags.<key>.name` / `.description`.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeatureFlagDescriptor {
    /// Stable identifier; persisted user overrides are keyed by it, so never rename a live key.
    pub key: &'static str,
    /// State used until the user toggles the flag.
    pub default_enabled: bool,
}

/// Registry of user-toggleable experimental features, in Settings display order.
/// Adding an entry here (plus its i18n copy) is all the Settings UI needs.
pub const FEATURE_FLAGS: &[FeatureFlagDescriptor] = &[FeatureFlagDescriptor {
    key: "advanced_evm_accounts",
    default_enabled: false,
}];

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
    pub feature_flags: &'static [FeatureFlagDescriptor],
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
        feature_flags: FEATURE_FLAGS,
    }
}

/// Tauri command returning the compiled application configuration.
#[tauri::command]
pub async fn get_app_config() -> AppConfig {
    default_app_config()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};

    fn locale_catalog(locale: &str) -> HashMap<String, String> {
        let path = format!(
            "{}/../src/lib/i18n/locales/{locale}/settings.json",
            env!("CARGO_MANIFEST_DIR")
        );
        let raw = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {path}: {e}"));
        serde_json::from_str(&raw).unwrap_or_else(|e| panic!("parse {path}: {e}"))
    }

    #[test]
    fn feature_flag_keys_are_unique_snake_case() {
        let mut seen = HashSet::new();
        for flag in FEATURE_FLAGS {
            assert!(
                seen.insert(flag.key),
                "duplicate feature flag key {}",
                flag.key
            );
            assert!(
                !flag.key.is_empty()
                    && flag
                        .key
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'),
                "feature flag key {} must be snake_case",
                flag.key
            );
        }
    }

    #[test]
    fn every_feature_flag_has_en_and_es_copy() {
        for locale in ["en", "es"] {
            let catalog = locale_catalog(locale);
            for flag in FEATURE_FLAGS {
                for field in ["name", "description"] {
                    let key = format!("settings.experimental.flags.{}.{field}", flag.key);
                    assert!(
                        catalog.get(&key).is_some_and(|v| !v.trim().is_empty()),
                        "missing {locale} i18n key {key}"
                    );
                }
            }
        }
    }

    #[test]
    fn app_config_serializes_feature_flags_in_camel_case() {
        let json = serde_json::to_value(default_app_config()).unwrap();
        let flags = json["featureFlags"].as_array().expect("featureFlags array");
        assert_eq!(flags.len(), FEATURE_FLAGS.len());
        for (json, flag) in flags.iter().zip(FEATURE_FLAGS) {
            assert_eq!(json["key"], flag.key);
            assert_eq!(json["defaultEnabled"], flag.default_enabled);
        }
    }
}
