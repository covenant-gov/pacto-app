//! Shared helpers for squad group records (events, docs) carried as
//! kind 30078 rumors in a squad's MLS group.

use nostr_sdk::prelude::{NostrSigner, PublicKey};
use nostr_sdk::ToBech32;
use rusqlite::Connection;
use tauri::{AppHandle, Emitter, Runtime};

use crate::message::Message;
use crate::stored_event::event_kind;

pub const SQUAD_EVENT_D_TAG: &str = "pacto_squad_event";
pub const SQUAD_DOC_D_TAG: &str = "pacto_squad_doc";

pub(crate) fn with_conn<R: Runtime, T>(
    handle: &AppHandle<R>,
    f: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let conn = crate::account_manager::get_db_connection(handle)?;
    let res = f(&conn);
    crate::account_manager::return_db_connection(conn);
    res
}

pub(crate) async fn signer_identity() -> Result<(PublicKey, String), String> {
    let client = crate::get_nostr_client()?;
    let signer = client.signer().await.map_err(|e| e.to_string())?;
    let pk = signer.get_public_key().await.map_err(|e| e.to_string())?;
    let npub = pk.to_bech32().map_err(|e| e.to_string())?;
    Ok((pk, npub))
}

/// Announcements-bucket message for a record card.
pub(crate) fn card_message(
    id: String,
    content: String,
    at_ms: u64,
    mine: bool,
    npub: String,
) -> Message {
    Message {
        id,
        content,
        replied_to: String::new(),
        replied_to_content: None,
        replied_to_npub: None,
        replied_to_has_attachment: None,
        preview_metadata: None,
        attachments: Vec::new(),
        reactions: Vec::new(),
        at: at_ms,
        mine,
        pending: false,
        failed: false,
        npub: Some(npub),
        wrapper_event_id: None,
        edited: false,
        edit_history: None,
        rumor_kind: Some(event_kind::APPLICATION_SPECIFIC),
        virtual_bucket: Some("announcements".to_string()),
    }
}

/// Local copy of an announcements card we just sent (peers get it via ingest).
pub(crate) async fn store_local_card<R: Runtime>(
    handle: &AppHandle<R>,
    mls_group_id: &str,
    msg: Message,
) {
    let was_added = {
        let mut state = crate::STATE.lock().await;
        state.add_message_to_chat(mls_group_id, msg.clone())
    };
    if was_added {
        let _ = crate::db::save_message(handle.clone(), mls_group_id, &msg).await;
        let _ = handle.emit(
            "mls_message_new",
            serde_json::json!({ "group_id": mls_group_id, "message": msg }),
        );
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SquadGroupRole {
    pub is_member: bool,
    pub is_admin: bool,
}

/// Membership: participant list (fail closed). Admin: engine `admin_pubkeys` for this MLS group, as npub.
/// Admin also requires membership.
pub async fn group_role<R: Runtime>(
    handle: &AppHandle<R>,
    mls_group_id: &str,
    npub: &str,
) -> SquadGroupRole {
    let Some(ids) = resolve_group_ids(handle, mls_group_id).await else {
        return SquadGroupRole::default();
    };
    let is_member = crate::db::is_author_mls_member_for_chat(handle, &ids.wire_id, npub);
    if !is_member {
        return SquadGroupRole::default();
    }
    let admins = engine_admin_npubs(handle, &ids.engine_id);
    role_from(is_member, &admins, npub)
}

struct GroupIds {
    wire_id: String,
    engine_id: String,
}

/// Map either id alias to the non-evicted group's wire and engine ids.
async fn resolve_group_ids<R: Runtime>(
    handle: &AppHandle<R>,
    mls_group_id: &str,
) -> Option<GroupIds> {
    let id = mls_group_id.trim();
    if id.is_empty() {
        return None;
    }
    let groups = crate::db::load_mls_groups(handle).await.ok()?;
    let meta = groups
        .into_iter()
        .find(|g| g.group_id == id || (!g.engine_group_id.is_empty() && g.engine_group_id == id))?;
    if meta.evicted {
        return None;
    }
    let engine_id = if meta.engine_group_id.is_empty() {
        meta.group_id.clone()
    } else {
        meta.engine_group_id
    };
    Some(GroupIds {
        wire_id: meta.group_id,
        engine_id,
    })
}

/// Sync on purpose: the MDK engine is not `Send` and must not live across an await.
fn engine_admin_npubs<R: Runtime>(handle: &AppHandle<R>, engine_id_hex: &str) -> Vec<String> {
    let Ok(engine_gid) = hex::decode(engine_id_hex) else {
        return Vec::new();
    };
    let Ok(mls) = crate::mls::MlsService::new_persistent(handle) else {
        return Vec::new();
    };
    let Ok(engine) = mls.engine() else {
        return Vec::new();
    };
    let Ok(groups) = engine.get_groups() else {
        return Vec::new();
    };
    admins_of_group(
        groups.iter().map(|g| {
            (
                g.mls_group_id.as_slice(),
                g.admin_pubkeys.iter().filter_map(|pk| pk.to_bech32().ok()),
            )
        }),
        &engine_gid,
    )
}

/// Admin npubs of the group whose engine id is `engine_gid`; empty when absent.
fn admins_of_group<'a, G, P>(groups: G, engine_gid: &[u8]) -> Vec<String>
where
    G: IntoIterator<Item = (&'a [u8], P)>,
    P: IntoIterator<Item = String>,
{
    groups
        .into_iter()
        .find(|(gid, _)| *gid == engine_gid)
        .map(|(_, admins)| admins.into_iter().collect())
        .unwrap_or_default()
}

fn role_from(is_member: bool, admin_npubs: &[String], npub: &str) -> SquadGroupRole {
    let npub = npub.trim();
    let is_admin = is_member && !npub.is_empty() && admin_npubs.iter().any(|a| a == npub);
    SquadGroupRole {
        is_member,
        is_admin,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::author_listed_in_participants;

    fn role(participants: &[&str], admins: &[&str], npub: &str) -> SquadGroupRole {
        let admins: Vec<String> = admins.iter().map(|s| s.to_string()).collect();
        role_from(
            author_listed_in_participants(participants.iter().copied(), npub),
            &admins,
            npub,
        )
    }

    #[test]
    fn member_in_participants_is_not_admin() {
        let r = role(
            &["npub1creator", "npub1member"],
            &["npub1creator"],
            "npub1member",
        );
        assert_eq!(
            r,
            SquadGroupRole {
                is_member: true,
                is_admin: false
            }
        );
    }

    #[test]
    fn creator_in_admin_set_is_admin() {
        let r = role(
            &["npub1creator", "npub1member"],
            &["npub1creator"],
            "npub1creator",
        );
        assert_eq!(
            r,
            SquadGroupRole {
                is_member: true,
                is_admin: true
            }
        );
    }

    #[test]
    fn empty_participants_is_not_member() {
        assert_eq!(
            role(&[], &["npub1creator"], "npub1creator"),
            SquadGroupRole::default()
        );
    }

    #[test]
    fn admin_of_another_group_is_not_admin_here() {
        let here = [1u8; 32];
        let other = [2u8; 32];
        let groups = vec![
            (other.as_slice(), vec!["npub1outsider".to_string()]),
            (here.as_slice(), vec!["npub1creator".to_string()]),
        ];
        let admins = admins_of_group(groups.clone(), &here);
        assert_eq!(admins, vec!["npub1creator".to_string()]);
        assert!(!role_from(true, &admins, "npub1outsider").is_admin);
        assert!(admins_of_group(groups, &[3u8; 32]).is_empty());
    }
}
