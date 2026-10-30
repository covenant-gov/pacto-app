mod accounts;
mod ids;
mod messaging;
mod mls;
mod sponsored_fees;
mod squad;

pub use accounts::{
    get_all_profiles, get_dm_peer_evm_address, get_dm_peer_evm_stored, get_evm_address,
    get_evm_pkey, get_pkey, get_seed, get_sql_setting, get_theme, get_username_claim,
    persist_kind0_publish, remove_setting, repair_evm_address_if_needed, set_dm_peer_evm_address,
    set_evm_address, set_evm_pkey, set_pkey, set_profile, set_seed, set_sql_setting,
    set_wallet_signing_evm_address, upsert_username_claim, SlimProfile, UsernameClaimRow,
    UsernameClaimUpsert,
};

pub(crate) use accounts::read_stored_evm_address;

#[allow(unused_imports)]
#[doc(hidden)]
pub use accounts::{
    __cmd__get_dm_peer_evm_address, __cmd__get_evm_address, __cmd__get_evm_pkey, __cmd__get_pkey,
    __cmd__get_seed, __cmd__get_sql_setting, __cmd__get_theme, __cmd__remove_setting,
    __cmd__set_dm_peer_evm_address, __cmd__set_evm_address, __cmd__set_evm_pkey, __cmd__set_pkey,
    __cmd__set_profile, __cmd__set_seed, __cmd__set_sql_setting,
    __tauri_command_name_get_dm_peer_evm_address, __tauri_command_name_get_evm_address,
    __tauri_command_name_get_evm_pkey, __tauri_command_name_get_pkey,
    __tauri_command_name_get_seed, __tauri_command_name_get_sql_setting,
    __tauri_command_name_get_theme, __tauri_command_name_remove_setting,
    __tauri_command_name_set_dm_peer_evm_address, __tauri_command_name_set_evm_address,
    __tauri_command_name_set_evm_pkey, __tauri_command_name_set_pkey,
    __tauri_command_name_set_profile, __tauri_command_name_set_seed,
    __tauri_command_name_set_sql_setting,
};

pub use ids::{
    clear_id_caches, get_chat_id_by_identifier, preload_id_caches, resolve_chat_id_for_message_load,
};

#[allow(unused_imports)]
pub use sponsored_fees::{
    global_sponsored_fee_usage_row_id, insert_global_sponsored_fee_usage,
    insert_global_sponsored_fee_usage_conn, insert_squad_sponsored_fee_usage,
    insert_squad_sponsored_fee_usage_conn, list_global_sponsored_fee_usage,
    list_squad_sponsored_fee_usage, sponsored_fee_usage_row_id, GlobalSponsoredFeeUsageInsert,
    GlobalSponsoredFeeUsageRow, SquadSponsoredFeeUsageInsert, SquadSponsoredFeeUsageRow,
};

#[allow(unused_imports)]
#[doc(hidden)]
pub use sponsored_fees::{
    __cmd__list_global_sponsored_fee_usage, __cmd__list_squad_sponsored_fee_usage,
    __tauri_command_name_list_global_sponsored_fee_usage,
    __tauri_command_name_list_squad_sponsored_fee_usage,
};

#[allow(unused_imports)]
pub use squad::{
    add_parent_treasury_safe, allowlist_row_id, apply_mls_virtual_bucket_side_effects,
    apply_parent_safe_announce, emit_sticker_packs_updated, get_safe, implicit_allowlist_addresses,
    is_allowlisted_contract_target, list_evm_account_squad_bindings, list_parent_treasury_safes,
    list_squad_contract_allowlist, list_squad_infra, list_squad_infra_canonical_refs,
    list_squad_member_evm, list_squad_tracked_tokens, load_sticker_packs,
    maybe_upsert_governance_from_announce, maybe_upsert_sticker_pack_from_announce,
    maybe_upsert_war_game_from_announce, merge_war_game_provider_payloads, pacto_gov_infra_row_id,
    pacto_gov_top_hat_id_for_parent, pacto_gov_treasury_row_id, pacto_gov_wargame_infra_row_id,
    pacto_gov_wargame_payload_for_parent, parent_has_pacto_gov_infra_row, parent_has_sponsor_infra,
    parent_id_for_canonical_infra_ref, persist_pacto_gov_infra, persist_pacto_gov_treasury_safe,
    persist_pacto_gov_wargame_infra, persist_sponsor_infra, persist_squad_admin_infra,
    remove_squad_contract_allowlist, remove_squad_tracked_token,
    replay_automation_side_effects_for_chat, resolve_squad_roster_evm_address, set_safe,
    side_effect_parent_matches_chat, squad_admin_infra_row_id, squad_sponsor_infra_row_id,
    tracked_token_row_id, try_apply_squad_contract_allowlist_announce,
    try_apply_squad_evm_roster_snapshot, try_apply_squad_member_evm_share,
    try_apply_squad_tracked_tokens_announce, upsert_squad_contract_allowlist, upsert_squad_infra,
    upsert_squad_member_evm, upsert_squad_member_evm_account, upsert_squad_tracked_token,
    upsert_sticker_pack_inner, EvmAccountSquadBindingRow, ParentTreasurySafeRow,
    SquadContractAllowlistRow, SquadInfraRow, SquadMemberEvmRow, SquadTrackedTokenRow,
    StickerPackRow,
};

#[allow(unused_imports)]
pub(crate) use squad::{
    apply_verified_roster_bind_cert, get_squad_member_evm_account_id,
    is_author_mls_member_for_chat, is_certified_squad_member_evm_row,
    parse_squad_evm_roster_snapshot_certs, parse_v2_squad_member_evm_share,
    roster_evm_address_for_member, upsert_certified_squad_member_evm, RosterBindCertIngest,
};

#[allow(unused_imports)]
#[doc(hidden)]
pub use squad::{
    __cmd__add_parent_treasury_safe, __cmd__get_safe, __cmd__list_evm_account_squad_bindings,
    __cmd__list_parent_treasury_safes, __cmd__list_squad_contract_allowlist,
    __cmd__list_squad_infra, __cmd__list_squad_infra_canonical_refs, __cmd__list_squad_member_evm,
    __cmd__list_squad_tracked_tokens, __cmd__remove_squad_contract_allowlist,
    __cmd__remove_squad_tracked_token, __cmd__resolve_squad_roster_evm_address, __cmd__set_safe,
    __cmd__upsert_squad_contract_allowlist, __cmd__upsert_squad_infra,
    __cmd__upsert_squad_member_evm, __cmd__upsert_squad_member_evm_account,
    __cmd__upsert_squad_tracked_token, __tauri_command_name_add_parent_treasury_safe,
    __tauri_command_name_get_safe, __tauri_command_name_list_evm_account_squad_bindings,
    __tauri_command_name_list_parent_treasury_safes,
    __tauri_command_name_list_squad_contract_allowlist, __tauri_command_name_list_squad_infra,
    __tauri_command_name_list_squad_infra_canonical_refs,
    __tauri_command_name_list_squad_member_evm, __tauri_command_name_list_squad_tracked_tokens,
    __tauri_command_name_remove_squad_contract_allowlist,
    __tauri_command_name_remove_squad_tracked_token,
    __tauri_command_name_resolve_squad_roster_evm_address, __tauri_command_name_set_safe,
    __tauri_command_name_upsert_squad_contract_allowlist, __tauri_command_name_upsert_squad_infra,
    __tauri_command_name_upsert_squad_member_evm,
    __tauri_command_name_upsert_squad_member_evm_account,
    __tauri_command_name_upsert_squad_tracked_token,
};

#[allow(unused_imports)]
pub use accounts::{
    list_recent_export_attempts, log_sensitive_export, prune_export_log, ExportLogRow,
};

#[allow(unused_imports)]
pub(crate) use accounts::{
    list_recent_export_attempts_on_conn, log_sensitive_export_on_conn, prune_export_log_on_conn,
};

#[allow(unused_imports)]
pub use mls::{
    delete_mls_group, load_mls_device_id, load_mls_event_cursors, load_mls_groups,
    load_mls_keypackages, parent_exists_in_groups, remove_mls_group_pending_welcome,
    save_mls_device_id, save_mls_event_cursors, save_mls_group, save_mls_keypackages,
    set_mls_group_pending_welcomes,
};

#[allow(unused_imports)]
pub(crate) use mls::{clear_discarded_giftwraps_conn, persist_legacy_group_admins_conn};

#[allow(unused_imports)]
pub use messaging::{
    build_file_hash_index, check_and_vacuum_if_needed, delete_chat,
    dm_created_at_at_or_before_cutoff, edit_is_authorized_before_save, event_exists, get_all_chats,
    get_chat_last_messages, get_chat_message_count, get_chat_messages_paginated,
    get_dm_deletion_cutoff, get_dm_sent_received, get_events, get_message_views,
    get_messages_around_id, get_related_events, load_recent_wrapper_ids, message_exists_in_db,
    populate_reply_context, record_discarded_giftwrap, repair_legacy_hex_reaction_npubs, save_chat,
    save_chat_messages, save_event, save_link_preview_metadata, save_message, save_reaction_event,
    saved_edit_is_authorized, update_attachment_downloaded_status, update_wrapper_event_id,
    upsert_dm_deletion_cutoff, vacuum_database, wrapper_event_exists, AttachmentRef, SlimChatDB,
};

#[allow(unused_imports)]
pub(crate) use messaging::{
    delete_chat_conn, get_authorized_message_edits, get_dm_deletion_cutoff_conn,
    upsert_dm_deletion_cutoff_conn,
};

#[cfg(test)]
mod sponsor_preflight_tests;
