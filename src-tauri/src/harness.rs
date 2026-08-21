//! Relay-free seeding harness: builds populated per-account storage through
//! the real ingest path -- `rumor::process_rumor`, a real MLS welcome/message
//! exchange via `mdk_core`, and the `db.rs` persistence layer -- with zero
//! network calls, so it runs in Docker-less, network-less CI. Feature-gated
//! (`relay-free-harness`, non-default) and never linked into the main app
//! binary or a release build; see `src/bin/relay_free_harness.rs` for the
//! thin entry point that drives this module.
//!
//! The DM slice is seeded first (already relay-free by construction), then
//! the squad slice primes a second, ephemeral in-process MLS engine to play
//! the inviter and feeds a real welcome into the sandbox identity's own
//! persistent engine. No wire-byte fixtures are committed anywhere -- every
//! credential and welcome is generated fresh, in-process, on every run.
//!
//! Seeded identities are public fixtures. The harness stamps them sandbox-only
//! (see [`SANDBOX_ONLY_MARKER_FILE`] / [`SANDBOX_ONLY_SETTING_KEY`]) so
//! `dev_login` refuses them while any non-local relay is in the set. Opening a
//! seeded DB in the live app still requires `PACTO_TRUSTED_RELAYS` (local) plus
//! `PACTO_DEV_IDENTITY_SANDBOX_ONLY=1` (or the on-disk stamp). MLS group config
//! embeds a loopback placeholder relay -- never the compiled production set.

use crate::mls::{MlsGroupMetadata, MlsService};
use crate::rumor::{
    process_rumor, ConversationType, RumorContext, RumorEvent, RumorProcessingResult,
};
use crate::{account_manager, db, evm, migration, nostr_tags, Chat, Profile};
use mdk_core::prelude::*;
use mdk_sqlite_storage::{EncryptionConfig, MdkSqliteStorage};
use nostr_sdk::prelude::*;
use sha2::{Digest, Sha256};
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Runtime};

/// Fixed point every seeded rumor's `created_at` counts up from. Deterministic
/// timestamps (never `Timestamp::now()`) mean a second run computes the exact
/// same Nostr event ids as the first, so the flat `events` table's
/// `INSERT OR IGNORE` naturally dedups instead of duplicating history.
const HARNESS_EPOCH_SECS: u64 = 1_735_000_000;

/// Settings key recording harness completion. Present and equal to
/// `SEED_MARKER_VERSION` means "already seeded, do nothing" on a rerun --
/// the harness's primary idempotency guard.
const SEED_MARKER_KEY: &str = "harness_seed_complete";
/// Bumped when seed semantics change (sandbox-only stamp, local-only relays,
/// `squads` catalog row for the seeded squad).
const SEED_MARKER_VERSION: &str = "3";

/// Anvil/Hardhat's well-known public test mnemonic -- already the default
/// local chain this repo's sandboxes point at. A fine default: this identity
/// is a seeding fixture, not a real account, so its key material is public
/// by construction. Prefer `PACTO_DEV_LOGIN_MNEMONIC` over argv; a non-fixture
/// phrase requires `--allow-non-fixture-mnemonic`.
pub const DEFAULT_MNEMONIC: &str = "test test test test test test test test test test test junk";
pub const DEFAULT_PIN: &str = "123456";

/// Loopback placeholder embedded in MLS group / keypackage relay metadata so a
/// relay-free seed never points at production relays. Accepted by
/// `trusted_relays::all_relays_local()`.
const HARNESS_LOCAL_RELAY: &str = "ws://127.0.0.1:1";

/// On-disk stamp under the sandbox root; `dev_login` treats its presence like
/// `PACTO_DEV_IDENTITY_SANDBOX_ONLY=1`.
/// Re-export for callers that already import this module.
pub use crate::test_sandbox::SANDBOX_ONLY_MARKER_FILE;
/// SQL setting mirroring the on-disk stamp for in-DB discoverability.
pub const SANDBOX_ONLY_SETTING_KEY: &str = "dev_identity_sandbox_only";

const DEVICE_ID: &str = "relay-free-harness";
const SQUAD_NAME: &str = "Relay-Free Harness Squad";
const ATTACHMENTS_SKIP_REASON_KEY: &str = "harness_attachments_skip_reason";

/// Inputs the harness derives every identity and secret from.
#[derive(Debug, Clone)]
pub struct HarnessConfig {
    pub mnemonic: String,
    pub pin: String,
    /// Required when `mnemonic` is not [`DEFAULT_MNEMONIC`]. Prevents a real
    /// recovery phrase from being persisted under the throwaway PIN by accident.
    pub allow_non_fixture_mnemonic: bool,
}

impl Default for HarnessConfig {
    fn default() -> Self {
        Self {
            mnemonic: DEFAULT_MNEMONIC.to_string(),
            pin: DEFAULT_PIN.to_string(),
            allow_non_fixture_mnemonic: false,
        }
    }
}

/// Summary of what one `run` did, printed by the binary and useful for tests.
#[derive(Debug, Default)]
pub struct HarnessReport {
    pub npub: String,
    pub already_seeded: bool,
    pub dm_messages_seeded: usize,
    pub squad_group_id: Option<String>,
    pub attachments_skip_reason: String,
}

/// Resolve the sandbox root, refusing to proceed without one under an allowed
/// placement. Presence alone is not enough: the path must resolve under a
/// `test_sandbox` or `test_fixtures` directory component (the same trees
/// `make dev` / `make dev-sandbox` use), so a real OS app-data dir cannot be
/// passed as `--sandbox-root`.
pub fn require_sandbox_root() -> Result<PathBuf, String> {
    let root = crate::test_sandbox::sandbox_root().ok_or_else(|| {
        "PACTO_TEST_SANDBOX_ROOT is not set; the relay-free harness refuses to run without an \
         explicit sandbox root rather than risk touching the real OS data directory."
            .to_string()
    })?;
    validate_sandbox_root_placement(&root)?;
    Ok(root)
}

/// True when `root` has a `test_sandbox` or `test_fixtures` path component.
pub fn sandbox_root_placement_ok(root: &Path) -> bool {
    root.components().any(|c| match c {
        Component::Normal(part) => {
            let s = part.to_string_lossy();
            s == "test_sandbox" || s == "test_fixtures"
        }
        _ => false,
    })
}

fn validate_sandbox_root_placement(root: &Path) -> Result<(), String> {
    if sandbox_root_placement_ok(root) {
        return Ok(());
    }
    Err(format!(
        "sandbox root {} is not under test_sandbox/ or test_fixtures/; refusing to \
         seed outside the repo's sandbox trees (pass a path like \
         <repo>/test_sandbox/... or <repo>/test_fixtures/...)",
        root.display()
    ))
}

/// Local-only relay list for MLS metadata. Never the compiled production set.
fn harness_local_relays() -> Result<Vec<RelayUrl>, String> {
    let url = RelayUrl::parse(HARNESS_LOCAL_RELAY)
        .map_err(|e| format!("harness local relay placeholder: {e}"))?;
    Ok(vec![url])
}

/// Refuse a non-fixture mnemonic unless the operator opted in explicitly.
pub fn validate_mnemonic_policy(config: &HarnessConfig) -> Result<(), String> {
    let phrase = config.mnemonic.trim();
    if phrase == DEFAULT_MNEMONIC {
        return Ok(());
    }
    if config.allow_non_fixture_mnemonic {
        return Ok(());
    }
    Err(
        "non-fixture mnemonic refused: pass --allow-non-fixture-mnemonic (or set \
         PACTO_HARNESS_ALLOW_NON_FIXTURE_MNEMONIC=1) to persist a non-default phrase \
         under the harness PIN. Prefer PACTO_DEV_LOGIN_MNEMONIC over --mnemonic so the \
         phrase never appears on argv."
            .to_string(),
    )
}

fn stamp_sandbox_only_identity<R: Runtime>(
    handle: &AppHandle<R>,
    root: &Path,
) -> Result<(), String> {
    let marker = root.join(SANDBOX_ONLY_MARKER_FILE);
    std::fs::write(
        &marker,
        "sandbox-only fixture identity (KD9/R25). Opening this DB in the live app \
requires PACTO_TRUSTED_RELAYS pointed at local relays and \
PACTO_DEV_IDENTITY_SANDBOX_ONLY=1 (or this marker file).\n",
    )
    .map_err(|e| format!("failed to write {}: {e}", marker.display()))?;
    db::set_sql_setting(
        handle.clone(),
        SANDBOX_ONLY_SETTING_KEY.to_string(),
        "1".to_string(),
    )?;
    Ok(())
}

/// Entry point: seed DMs, a squad, and wallet state under the resolved
/// sandbox root for the identity derived from `config.mnemonic`.
pub async fn run<R: Runtime>(
    handle: &AppHandle<R>,
    config: HarnessConfig,
) -> Result<HarnessReport, String> {
    let root = require_sandbox_root()?;
    validate_mnemonic_policy(&config)?;

    let keys = Keys::from_mnemonic(config.mnemonic.trim(), None)
        .map_err(|e| format!("Invalid harness mnemonic: {e}"))?;
    let npub = keys.public_key().to_bech32().map_err(|e| e.to_string())?;

    bootstrap_account_shell(handle, &npub).await?;

    if let Some(existing) = db::get_sql_setting(handle.clone(), SEED_MARKER_KEY.to_string())? {
        if existing == SEED_MARKER_VERSION {
            println!(
                "[relay-free-harness] {npub} already seeded (marker v{existing}); nothing to do."
            );
            return Ok(HarnessReport {
                npub,
                already_seeded: true,
                ..Default::default()
            });
        }
        return Err(format!(
            "{SEED_MARKER_KEY} is set to unexpected value {existing:?} (expected \
             {SEED_MARKER_VERSION:?}); refusing to reseed over unrecognized state. \
             Wipe the sandbox root (or bump/clear the marker) before reseeding."
        ));
    }

    bootstrap_identity_secrets(handle, &keys, &config).await?;
    stamp_sandbox_only_identity(handle, &root)?;

    let dm_messages_seeded = seed_dm_slice(handle, &keys).await?;
    let squad_group_id = seed_squad_slice(handle, &keys).await?;
    let attachments_skip_reason = seed_attachment_slice(handle).await?;

    db::set_sql_setting(
        handle.clone(),
        SEED_MARKER_KEY.to_string(),
        SEED_MARKER_VERSION.to_string(),
    )?;

    Ok(HarnessReport {
        npub,
        already_seeded: false,
        dm_messages_seeded,
        squad_group_id,
        attachments_skip_reason,
    })
}

/// Deterministic keypair for a synthetic counterparty (DM buddy or squad
/// inviter). These identities exist only inside this process; nothing about
/// them is persisted, so determinism only needs to hold within one run.
fn derive_synthetic_keys(label: &str) -> Keys {
    let mut hasher = Sha256::new();
    hasher.update(b"pacto/relay-free-harness/identity/v1/");
    hasher.update(label.as_bytes());
    let digest: [u8; 32] = hasher.finalize().into();
    let secret =
        SecretKey::from_slice(&digest).expect("sha256 digest is a valid secp256k1 secret key");
    Keys::new(secret)
}

/// Deterministic `EventId` used as a synthetic giftwrap wrapper id for
/// `process_welcome`. The wrapper is never actually published or unwrapped
/// here (there is no relay), so any stable id works; determinism keeps a
/// rerun's (never taken, thanks to the squad-level idempotency guard) engine
/// state reproducible instead of accidental.
fn deterministic_event_id(label: &str) -> EventId {
    let mut hasher = Sha256::new();
    hasher.update(b"pacto/relay-free-harness/wrapper/v1/");
    hasher.update(label.as_bytes());
    let digest: [u8; 32] = hasher.finalize().into();
    EventId::from_slice(&digest).expect("32-byte hash is always a valid EventId")
}

fn build_rumor(
    kind: Kind,
    content: &str,
    tags: Vec<Tag>,
    pubkey: PublicKey,
    at: u64,
) -> UnsignedEvent {
    EventBuilder::new(kind, content)
        .tags(tags)
        .custom_created_at(Timestamp::from_secs(at))
        .build(pubkey)
}

fn to_rumor_event(unsigned: &UnsignedEvent) -> RumorEvent {
    RumorEvent {
        id: unsigned
            .id
            .expect("EventBuilder::build always computes an id"),
        kind: unsigned.kind,
        content: unsigned.content.clone(),
        tags: unsigned.tags.clone(),
        created_at: unsigned.created_at,
        pubkey: unsigned.pubkey,
    }
}

/// Account init + current-account plumbing only -- cheap and idempotent, so
/// it always runs first (even on a rerun) to get a database connection open
/// before the seed-marker check below decides whether there's more to do.
async fn bootstrap_account_shell<R: Runtime>(
    handle: &AppHandle<R>,
    npub: &str,
) -> Result<(), String> {
    account_manager::set_pending_account(npub.to_string())?;
    account_manager::init_profile_database(handle, npub).await?;
    account_manager::set_current_account(npub.to_string())?;
    account_manager::clear_pending_account()?;
    Ok(())
}

/// Real PIN-encrypted credentials persisted the same way `createAccount`/
/// `importAccount` do (mirrors `dev_login::login_full_depth` minus the
/// network parts -- no client, no `connect()`, no keypackage publish), plus
/// wallet state through the existing derivation/storage path.
async fn bootstrap_identity_secrets<R: Runtime>(
    handle: &AppHandle<R>,
    keys: &Keys,
    config: &HarnessConfig,
) -> Result<(), String> {
    let nsec = keys.secret_key().to_bech32().map_err(|e| e.to_string())?;
    let pkey_ciphertext = migration::encrypt_with_password(handle, &nsec, &config.pin).await?;
    db::set_pkey(handle.clone(), pkey_ciphertext).await?;
    db::set_seed(handle.clone(), config.mnemonic.clone()).await?;

    // Wallet state through the existing BIP-44 derivation, persisted the
    // same way real login does; `evm_accounts::ensure_ready` then
    // materializes the `evm_accounts` row a normal boot would lazily create.
    let (evm_private_key, evm_address) =
        evm::derive_eth_bip44_v1_from_mnemonic_phrase(&config.mnemonic, 0)?;
    let evm_ciphertext =
        migration::encrypt_with_password(handle, &evm_private_key, &config.pin).await?;
    db::set_evm_pkey(handle.clone(), evm_ciphertext).await?;
    db::set_evm_address(handle.clone(), evm_address).await?;
    evm::evm_accounts::ensure_ready(handle.clone()).await?;

    // A seeded dev identity's recovery phrase is public by construction; mark
    // backup verified the same way `dev_login` does so nothing gates on it.
    db::set_sql_setting(
        handle.clone(),
        "backup_verified".to_string(),
        "true".to_string(),
    )?;

    Ok(())
}

/// Seed DMs, a reaction, and an edit by constructing rumors and driving
/// `rumor::process_rumor` directly -- that path makes no relay
/// calls -- then persisting through `db.rs` (`save_message`/`save_event`),
/// never a direct table write.
async fn seed_dm_slice<R: Runtime>(handle: &AppHandle<R>, keys: &Keys) -> Result<usize, String> {
    let counterparty = derive_synthetic_keys("dm-counterparty/v1");
    let contact_npub = counterparty
        .public_key()
        .to_bech32()
        .map_err(|e| e.to_string())?;
    let my_pubkey = keys.public_key();

    let mut counterparty_profile = Profile::new();
    counterparty_profile.id = contact_npub.clone();
    counterparty_profile.name = "Harness DM Buddy".to_string();
    db::set_profile(handle.clone(), counterparty_profile).await?;

    // 1) Counterparty greets the sandbox identity.
    let greeting = build_rumor(
        Kind::PrivateDirectMessage,
        "Welcome to your sandbox! I'm your seeded DM buddy.",
        vec![],
        counterparty.public_key(),
        HARNESS_EPOCH_SECS,
    );
    let greeting_ctx = RumorContext {
        sender: counterparty.public_key(),
        is_mine: false,
        conversation_id: contact_npub.clone(),
        conversation_type: ConversationType::DirectMessage,
    };
    persist_dm_text(handle, greeting, greeting_ctx, &contact_npub).await?;

    // 2) Sandbox identity replies.
    let reply = build_rumor(
        Kind::PrivateDirectMessage,
        "Thanks, glad to be here.",
        vec![],
        my_pubkey,
        HARNESS_EPOCH_SECS + 1,
    );
    let reply_ctx = RumorContext {
        sender: my_pubkey,
        is_mine: true,
        conversation_id: contact_npub.clone(),
        conversation_type: ConversationType::DirectMessage,
    };
    let mut reply_msg = persist_dm_text(handle, reply, reply_ctx, &contact_npub).await?;

    // 3) Counterparty reacts to the sandbox identity's reply. Materialized
    // by attaching to the message and re-saving, exactly like
    // `lib.rs::handle_reaction` does (minus the STATE lookup, since the
    // target message is already a local value here).
    let reaction_rumor = build_rumor(
        Kind::Reaction,
        "🎉",
        vec![nostr_tags::e_tag(vec![reply_msg.id.clone()])],
        counterparty.public_key(),
        HARNESS_EPOCH_SECS + 2,
    );
    let reaction_ctx = RumorContext {
        sender: counterparty.public_key(),
        is_mine: false,
        conversation_id: contact_npub.clone(),
        conversation_type: ConversationType::DirectMessage,
    };
    match process_rumor(to_rumor_event(&reaction_rumor), reaction_ctx).await? {
        RumorProcessingResult::Reaction(reaction) => {
            if reply_msg.add_reaction(reaction, None) {
                db::save_message(handle.clone(), &contact_npub, &reply_msg).await?;
            }
        }
        other => return Err(format!("DM slice: expected a Reaction, got {other:?}")),
    }

    // 4) Sandbox identity edits its own reply. Persisted as a standalone
    // edit event referencing the original message id; `get_message_views`
    // materializes it onto the message at read time, matching the real
    // ingest path (`lib.rs::handle_event`'s `RumorProcessingResult::Edit` arm).
    let edit_rumor = build_rumor(
        Kind::from(crate::event_kind::MESSAGE_EDIT),
        "Thanks, glad to be here! (edited)",
        vec![nostr_tags::e_tag(vec![reply_msg.id.clone()])],
        my_pubkey,
        HARNESS_EPOCH_SECS + 3,
    );
    let edit_ctx = RumorContext {
        sender: my_pubkey,
        is_mine: true,
        conversation_id: contact_npub.clone(),
        conversation_type: ConversationType::DirectMessage,
    };
    match process_rumor(to_rumor_event(&edit_rumor), edit_ctx).await? {
        RumorProcessingResult::Edit { mut event, .. } => {
            event.chat_id = db::get_chat_id_by_identifier(handle, &contact_npub)?;
            db::save_event(handle, &event).await?;
        }
        other => return Err(format!("DM slice: expected an Edit, got {other:?}")),
    }

    Ok(2)
}

/// Drive a text-message rumor through `process_rumor` and persist it via
/// `db::save_message`, returning the materialized `Message`.
async fn persist_dm_text<R: Runtime>(
    handle: &AppHandle<R>,
    rumor: UnsignedEvent,
    context: RumorContext,
    contact_npub: &str,
) -> Result<crate::Message, String> {
    match process_rumor(to_rumor_event(&rumor), context).await? {
        RumorProcessingResult::TextMessage(msg) => {
            db::save_message(handle.clone(), contact_npub, &msg).await?;
            Ok(msg)
        }
        other => Err(format!("DM slice: expected a TextMessage, got {other:?}")),
    }
}

/// Default channel rows for a freshly seeded squad -- mirrors
/// `src/lib/squad/hub-channel-rows.ts::defaultChannelRowsForGroupId`: the
/// `announcements` channel *is* the squad root MLS group, plus the virtual
/// `polls` channel routed through that same group.
fn harness_squad_channels(group_id: &str) -> Vec<crate::squad_catalog::SquadChannelRow> {
    vec![
        crate::squad_catalog::SquadChannelRow {
            name: "announcements".to_string(),
            group_id: group_id.to_string(),
            order: 0,
            access: None,
        },
        crate::squad_catalog::SquadChannelRow {
            name: "polls".to_string(),
            group_id: group_id.to_string(),
            order: 1,
            access: None,
        },
    ]
}

/// Upsert the `squads` catalog row the frontend's Squads UI actually reads
/// (`list_squads` -> `hydrateSquadsFromDb`). `mls_groups`/`chats` rows alone
/// leave the seeded squad unreachable through the app -- the Squads store
/// never learns about it without this row.
fn ensure_squad_catalog_row<R: Runtime>(
    handle: &AppHandle<R>,
    group_id: &str,
    name: &str,
) -> Result<(), String> {
    let row = crate::squad_catalog::SquadRow {
        id: group_id.to_string(),
        name: name.to_string(),
        icon_url: None,
        channels: harness_squad_channels(group_id),
        kind: "squad".to_string(),
        paired_squads: None,
        visibility: "private".to_string(),
        commons_tags: None,
        created_at_ms: (HARNESS_EPOCH_SECS as i64) * 1000,
        updated_at_ms: (HARNESS_EPOCH_SECS as i64) * 1000,
    };
    let conn = account_manager::get_db_connection(handle)?;
    let result = crate::squad_catalog::upsert_squad_inner(&conn, &row);
    account_manager::return_db_connection(conn);
    result
}

/// Seed the squad slice. A second, ephemeral in-process MLS engine plays the
/// inviter -- it creates the group against the sandbox identity's real,
/// locally-stored keypackage, produces a real welcome, and the harness feeds
/// that welcome plus two application messages into the sandbox identity's
/// own persistent engine through the normal inbound processing path
/// (`process_message` -> `process_rumor` -> `db::save_message`). No
/// wire-byte fixtures are committed; everything here is generated fresh.
///
/// Guarded independently of the top-level seed marker: `create_group` mints
/// a fresh random MLS group id every call, so a rerun must never reach it
/// once a harness squad already exists in `mls_groups`, or it would silently
/// duplicate history and break idempotency.
async fn seed_squad_slice<R: Runtime>(
    handle: &AppHandle<R>,
    keys: &Keys,
) -> Result<Option<String>, String> {
    if let Some(existing) = db::load_mls_groups(handle)
        .await?
        .into_iter()
        .find(|g| g.name == SQUAD_NAME)
    {
        ensure_squad_catalog_row(handle, &existing.group_id, &existing.name)?;
        return Ok(Some(existing.group_id));
    }

    // Crash after accept_welcome but before save_mls_group leaves the
    // persistent MLS store with a group and no SQL row. Treat that as
    // already-seeded and finish the SQL side -- never mint a second
    // keypackage or call create_group against an engine that already has
    // a group.
    if let Some(group_id) = recover_squad_from_mls_store(handle).await? {
        return Ok(Some(group_id));
    }

    let sandbox_kp_event = generate_and_store_device_keypackage(handle, keys).await?;

    let inviter_keys = derive_synthetic_keys("squad-inviter/v1");
    // Relay-free seed: never embed the compiled production relay set in MLS
    // group config. A loopback placeholder keeps metadata local-only.
    let relays = harness_local_relays()?;
    let group_config = NostrGroupConfigData::new(
        SQUAD_NAME.to_string(),
        "Seeded by the relay-free harness".to_string(),
        None,
        None,
        None,
        relays,
        vec![inviter_keys.public_key()],
    );

    // Inviter engine: ephemeral, in-memory, never touches disk, and is
    // dropped at the end of this scope -- entirely discarded once the
    // welcome and application-message wrappers it produced are captured.
    let (welcome_rumor, app_message_wrappers) = {
        let storage =
            MdkSqliteStorage::new_with_key(":memory:", EncryptionConfig::new([0x51u8; 32]))
                .map_err(|e| format!("inviter MLS storage: {e}"))?;
        let inviter_engine = MDK::new(storage);

        let create_out = inviter_engine
            .create_group(
                &inviter_keys.public_key(),
                vec![sandbox_kp_event],
                group_config,
            )
            .map_err(|e| format!("inviter create_group: {e}"))?;
        let welcome_rumor = create_out
            .welcome_rumors
            .into_iter()
            .next()
            .ok_or_else(|| "squad slice: create_group produced no welcome".to_string())?;
        let group_id = create_out.group.mls_group_id.clone();

        let mut wrappers = Vec::new();
        for (i, content) in [
            "Welcome to the squad!",
            "History seeded by the relay-free harness.",
        ]
        .into_iter()
        .enumerate()
        {
            let rumor = build_rumor(
                Kind::PrivateDirectMessage,
                content,
                vec![],
                inviter_keys.public_key(),
                HARNESS_EPOCH_SECS + 100 + i as u64,
            );
            let wrapper = inviter_engine
                .create_message(&group_id, rumor, None)
                .map_err(|e| format!("inviter create_message: {e}"))?;
            wrappers.push(wrapper);
        }
        (welcome_rumor, wrappers)
    };

    // Sandbox identity: accept the welcome through its own real, persistent,
    // encrypted engine -- the same one a normal boot opens.
    let (nostr_group_id, group_name, welcomer_hex) = {
        let mls =
            MlsService::new_persistent(handle).map_err(|e| format!("sandbox MLS engine: {e}"))?;
        let engine = mls.engine().map_err(|e| e.to_string())?;
        let wrapper_event_id = deterministic_event_id("welcome-wrapper");
        let welcome = engine
            .process_welcome(&wrapper_event_id, &welcome_rumor)
            .map_err(|e| format!("sandbox process_welcome: {e}"))?;
        engine
            .accept_welcome(&welcome)
            .map_err(|e| format!("sandbox accept_welcome: {e}"))?;
        (
            hex::encode(welcome.nostr_group_id),
            welcome.group_name.clone(),
            welcome.welcomer.to_hex(),
        )
    }; // engine dropped here, before any await

    let engine_group_id = {
        let mls = MlsService::new_persistent(handle).map_err(|e| e.to_string())?;
        let engine = mls.engine().map_err(|e| e.to_string())?;
        let groups = engine.get_groups().map_err(|e| e.to_string())?;
        groups
            .iter()
            .find(|g| hex::encode(g.nostr_group_id) == nostr_group_id)
            .map(|g| hex::encode(g.mls_group_id.as_slice()))
            .ok_or_else(|| {
                format!(
                    "squad slice: get_groups() missed nostr_group_id {nostr_group_id} after accept_welcome"
                )
            })?
    };

    let metadata = MlsGroupMetadata {
        group_id: nostr_group_id.clone(),
        engine_group_id,
        creator_pubkey: welcomer_hex,
        name: group_name.clone(),
        avatar_ref: None,
        created_at: HARNESS_EPOCH_SECS,
        updated_at: HARNESS_EPOCH_SECS,
        evicted: false,
        pending_welcomes: Vec::new(),
    };
    db::save_mls_group(handle.clone(), &metadata).await?;

    let sandbox_npub = keys.public_key().to_bech32().map_err(|e| e.to_string())?;
    let inviter_npub = inviter_keys
        .public_key()
        .to_bech32()
        .map_err(|e| e.to_string())?;
    let mut chat = Chat::new_mls_group(nostr_group_id.clone(), vec![sandbox_npub, inviter_npub]);
    ensure_squad_catalog_row(handle, &nostr_group_id, &group_name)?;
    chat.metadata.set_name(group_name);
    db::save_chat(handle.clone(), &chat).await?;

    for wrapper in app_message_wrappers {
        let msg_result = {
            let mls = MlsService::new_persistent(handle).map_err(|e| e.to_string())?;
            let engine = mls.engine().map_err(|e| e.to_string())?;
            engine
                .process_message(&wrapper)
                .map_err(|e| format!("sandbox process_message: {e}"))?
        }; // engine dropped here, before any await

        let MessageProcessingResult::ApplicationMessage(app_msg) = msg_result else {
            return Err(format!(
                "squad slice: expected ApplicationMessage from process_message, got {msg_result:?}"
            ));
        };
        let rumor_event = RumorEvent {
            id: app_msg.id,
            kind: app_msg.kind,
            content: app_msg.content.clone(),
            tags: app_msg.tags.clone(),
            created_at: app_msg.created_at,
            pubkey: app_msg.pubkey,
        };
        let context = RumorContext {
            sender: app_msg.pubkey,
            is_mine: app_msg.pubkey == keys.public_key(),
            conversation_id: nostr_group_id.clone(),
            conversation_type: ConversationType::MlsGroup,
        };
        match process_rumor(rumor_event, context).await? {
            RumorProcessingResult::TextMessage(msg) => {
                db::save_message(handle.clone(), &nostr_group_id, &msg).await?;
            }
            other => {
                return Err(format!(
                    "squad slice: expected TextMessage from process_rumor, got {other:?}"
                ));
            }
        }
    }

    Ok(Some(nostr_group_id))
}

/// If the persistent MLS store already has a group (partial seed), persist the
/// missing `mls_groups` / chat rows and return its nostr group id. Returns
/// `None` when the store is empty and a fresh invite is safe.
async fn recover_squad_from_mls_store<R: Runtime>(
    handle: &AppHandle<R>,
) -> Result<Option<String>, String> {
    let existing = {
        let mls =
            MlsService::new_persistent(handle).map_err(|e| format!("sandbox MLS engine: {e}"))?;
        let engine = mls.engine().map_err(|e| e.to_string())?;
        let groups = engine.get_groups().map_err(|e| e.to_string())?;
        groups.into_iter().next()
    };
    let Some(group) = existing else {
        return Ok(None);
    };

    let nostr_group_id = hex::encode(group.nostr_group_id);
    let engine_group_id = hex::encode(group.mls_group_id.as_slice());
    let group_name = if group.name.trim().is_empty() {
        SQUAD_NAME.to_string()
    } else {
        group.name.clone()
    };
    let metadata = MlsGroupMetadata {
        group_id: nostr_group_id.clone(),
        engine_group_id,
        creator_pubkey: group
            .admin_pubkeys
            .first()
            .map(|pk| pk.to_hex())
            .unwrap_or_default(),
        name: group_name.clone(),
        avatar_ref: None,
        created_at: HARNESS_EPOCH_SECS,
        updated_at: HARNESS_EPOCH_SECS,
        evicted: false,
        pending_welcomes: Vec::new(),
    };
    db::save_mls_group(handle.clone(), &metadata).await?;

    ensure_squad_catalog_row(handle, &nostr_group_id, &group_name)?;
    let mut chat = Chat::new_mls_group(nostr_group_id.clone(), vec![]);
    chat.metadata.set_name(group_name);
    db::save_chat(handle.clone(), &chat).await?;

    println!(
        "[relay-free-harness] recovered partial squad seed from MLS store (group {nostr_group_id})"
    );
    Ok(Some(nostr_group_id))
}

/// The sandbox identity generates its own device KeyPackage through the same
/// persistent, encrypted MLS engine a normal boot uses (`MlsService`,
/// `create_key_package_for_event`) -- no relay publish, unlike
/// `regenerate_device_keypackage`, which this mirrors minus the network
/// parts. Real key material, no committed fixture.
async fn generate_and_store_device_keypackage<R: Runtime>(
    handle: &AppHandle<R>,
    keys: &Keys,
) -> Result<Event, String> {
    let npub = keys.public_key().to_bech32().map_err(|e| e.to_string())?;

    let kp_data = {
        let mls =
            MlsService::new_persistent(handle).map_err(|e| format!("sandbox MLS engine: {e}"))?;
        let engine = mls.engine().map_err(|e| e.to_string())?;
        engine
            .create_key_package_for_event(&keys.public_key(), harness_local_relays()?)
            .map_err(|e| format!("create_key_package_for_event: {e}"))?
    }; // engine dropped here, before any await

    let kp_event = EventBuilder::new(Kind::MlsKeyPackage, kp_data.content)
        .tags(kp_data.tags_443)
        .sign_with_keys(keys)
        .map_err(|e| format!("sign device keypackage: {e}"))?;

    db::save_mls_device_id(handle.clone(), DEVICE_ID).await?;
    let entry = serde_json::json!({
        "owner_pubkey": npub,
        "device_id": DEVICE_ID,
        "keypackage_ref": kp_event.id.to_hex(),
        "fetched_at": HARNESS_EPOCH_SECS,
        "expires_at": 0u64,
    });
    db::save_mls_keypackages(handle.clone(), &[entry]).await?;

    Ok(kp_event)
}

/// File-attachment path resolution genuinely needs a real Tauri app
/// (`app_data_dir`/`app_local_data_dir` outside the sandbox-root override --
/// see `rumor::process_file_attachment`'s `TAURI_APP.get()` use, which a
/// `tauri::test::mock_app` handle can never populate). Rather than produce a
/// broken row, attachments are skipped entirely and the reason is recorded
/// where it can be inspected after the fact.
async fn seed_attachment_slice<R: Runtime>(handle: &AppHandle<R>) -> Result<String, String> {
    let reason = "file-attachment path resolution needs the process-global TAURI_APP handle \
                  (see rumor::process_file_attachment), which the harness's mock app handle can \
                  never populate; attachment content is skipped rather than writing a broken row"
        .to_string();
    db::set_sql_setting(
        handle.clone(),
        ATTACHMENTS_SKIP_REASON_KEY.to_string(),
        reason.clone(),
    )?;
    println!("[relay-free-harness] Skipping attachment content: {reason}");
    Ok(reason)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synthetic_keys_are_deterministic_per_label() {
        let a1 = derive_synthetic_keys("dm-counterparty/v1");
        let a2 = derive_synthetic_keys("dm-counterparty/v1");
        assert_eq!(a1.public_key(), a2.public_key());
    }

    #[test]
    fn synthetic_keys_differ_across_labels() {
        let dm = derive_synthetic_keys("dm-counterparty/v1");
        let squad = derive_synthetic_keys("squad-inviter/v1");
        assert_ne!(dm.public_key(), squad.public_key());
    }

    #[test]
    fn deterministic_event_ids_are_stable_and_distinct() {
        assert_eq!(
            deterministic_event_id("welcome-wrapper"),
            deterministic_event_id("welcome-wrapper")
        );
        assert_ne!(
            deterministic_event_id("welcome-wrapper"),
            deterministic_event_id("something-else")
        );
    }

    #[test]
    fn build_rumor_produces_a_computed_id_at_the_requested_time() {
        let keys = derive_synthetic_keys("test-only/v1");
        let rumor = build_rumor(
            Kind::PrivateDirectMessage,
            "hi",
            vec![],
            keys.public_key(),
            HARNESS_EPOCH_SECS,
        );
        assert!(rumor.id.is_some());
        assert_eq!(rumor.created_at.as_secs(), HARNESS_EPOCH_SECS);
        assert_eq!(rumor.pubkey, keys.public_key());
    }

    #[test]
    fn require_sandbox_root_refuses_when_unset() {
        // Best-effort: only asserts when no other test in this binary has
        // set the var, since PACTO_TEST_SANDBOX_ROOT is process-global.
        if std::env::var("PACTO_TEST_SANDBOX_ROOT").is_err() {
            assert!(require_sandbox_root().is_err());
        }
    }

    #[test]
    fn sandbox_root_placement_requires_known_tree() {
        assert!(sandbox_root_placement_ok(Path::new(
            "/tmp/test_sandbox/relay-free-harness"
        )));
        assert!(sandbox_root_placement_ok(Path::new(
            "/repo/test_fixtures/dev-account"
        )));
        assert!(!sandbox_root_placement_ok(Path::new(
            "/home/user/Library/Application Support/app"
        )));
    }

    #[test]
    fn mnemonic_policy_refuses_non_fixture_without_opt_in() {
        let mut config = HarnessConfig::default();
        assert!(validate_mnemonic_policy(&config).is_ok());
        config.mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".into();
        assert!(validate_mnemonic_policy(&config).is_err());
        config.allow_non_fixture_mnemonic = true;
        assert!(validate_mnemonic_policy(&config).is_ok());
    }
}
