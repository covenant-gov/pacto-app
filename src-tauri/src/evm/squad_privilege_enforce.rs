//! Arrival/publish-time SquadAdmin packed-role checks for MLS/Commons actions.

use alloy::primitives::{Address, B256, U256};
use alloy::providers::Provider;
use once_cell::sync::Lazy;
use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Runtime};

use super::access_control::resolve_acl_roster_address;
use super::contracts::pacto_gov::read_bindings::ISquadAdminBase::{
    hasExecutorRoleCall, isExecutorFullPermissionCall, isExecutorPausedCall, roleAtCall,
    roleCountCall,
};
use super::gov_read::connect_gov_read_provider;
use super::privilege_role_id::{
    decode_privilege_role_id, FLAG_ADD_DOC, FLAG_BROADCAST, FLAG_CREATE_CHANNEL, FLAG_CREATE_EVENT,
    FLAG_INVITE_ACCEPT, FLAG_MANAGE_NETWORK, PRIVILEGE_KNOWN_ACTION_MASK,
};
use super::rpc::{call::eth_call_decode, parse_address, wallet_err_json};
use crate::account_manager;
use crate::db;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SquadPrivilegeAction {
    InviteAccept,
    /// Reserved for future Rust publish gates (TS already enforces).
    #[allow(dead_code)]
    CreateChannel,
    #[allow(dead_code)]
    Broadcast,
    #[allow(dead_code)]
    ManageNetwork,
    CreateEvent,
    AddDoc,
}

impl SquadPrivilegeAction {
    fn flag_bit(self) -> u16 {
        match self {
            Self::InviteAccept => FLAG_INVITE_ACCEPT,
            Self::CreateChannel => FLAG_CREATE_CHANNEL,
            Self::Broadcast => FLAG_BROADCAST,
            Self::ManageNetwork => FLAG_MANAGE_NETWORK,
            Self::CreateEvent => FLAG_CREATE_EVENT,
            Self::AddDoc => FLAG_ADD_DOC,
        }
    }
}

enum ExecDecision {
    Allow,
    Paused,
    Deny,
}

/// Pause wins; then FULL or any needed flag allows.
fn decide(paused: bool, full: bool, known: u16, needed: u16) -> ExecDecision {
    if paused {
        ExecDecision::Paused
    } else if full || known & needed != 0 {
        ExecDecision::Allow
    } else {
        ExecDecision::Deny
    }
}

/// Receive-side outcome. `Undecided` means the chain was not consulted successfully
/// (RPC failure or no roster binding yet), so the caller must not drop the record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemberPrivilege {
    Allowed,
    Denied,
    Undecided,
}

struct ResolvedAdmin {
    proxy: Address,
    chain: String,
}

fn resolve_squad_admin_proxy_from_infra<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
) -> Result<Option<ResolvedAdmin>, String> {
    let rows = db::list_squad_infra(app.clone(), parent_id.to_string())?;
    // Prefer dedicated squad_admin, then pacto_gov payload, then wargame.
    if let Some(row) = rows.iter().find(|r| r.infra_type == "squad_admin") {
        if let Some(proxy) = proxy_from_squad_admin_row(row) {
            return Ok(Some(ResolvedAdmin {
                proxy,
                chain: row.chain.clone(),
            }));
        }
    }
    if let Some(row) = rows.iter().find(|r| r.infra_type == "pacto_gov") {
        if let Some(proxy) = proxy_from_pacto_gov_payload(row) {
            return Ok(Some(ResolvedAdmin {
                proxy,
                chain: row.chain.clone(),
            }));
        }
    }
    if let Some(row) = rows.iter().find(|r| r.infra_type == "pacto_gov_wargame") {
        if let Some(proxy) = proxy_from_pacto_gov_payload(row) {
            return Ok(Some(ResolvedAdmin {
                proxy,
                chain: row.chain.clone(),
            }));
        }
    }
    Ok(None)
}

fn proxy_from_squad_admin_row(row: &db::SquadInfraRow) -> Option<Address> {
    if let Some(raw) = row.provider_payload.as_deref() {
        if let Ok(v) = serde_json::from_str::<Value>(raw) {
            if let Some(p) = v
                .get("squadAdminProxy")
                .and_then(|x| x.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                return parse_address(p).ok();
            }
        }
    }
    parse_address(row.canonical_ref.trim()).ok()
}

fn proxy_from_pacto_gov_payload(row: &db::SquadInfraRow) -> Option<Address> {
    let raw = row.provider_payload.as_deref()?;
    let v: Value = serde_json::from_str(raw).ok()?;
    let p = v
        .get("squadAdminProxy")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    parse_address(p).ok()
}

async fn read_catalog_role_ids<P: Provider>(
    provider: &P,
    admin: Address,
) -> Result<Vec<B256>, String> {
    let count: U256 = eth_call_decode(provider, admin, &roleCountCall {})
        .await
        .map_err(|e| wallet_err_json("SQUAD_ADMIN_READ", e, None))?;
    let n = usize::try_from(count).unwrap_or(usize::MAX).min(256);
    let mut roles = Vec::with_capacity(n);
    for i in 0..n {
        let role: B256 = eth_call_decode(
            provider,
            admin,
            &roleAtCall {
                _index: U256::from(i),
            },
        )
        .await
        .map_err(|e| wallet_err_json("SQUAD_ADMIN_READ", e, None))?;
        roles.push(role);
    }
    Ok(roles)
}

/// On-chain privilege state of one executor; action-independent so it can be shared and cached.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ExecState {
    paused: bool,
    full: bool,
    known_flags: u16,
}

impl ExecState {
    fn decision(self, needed: u16) -> ExecDecision {
        decide(self.paused, self.full, self.known_flags, needed)
    }
}

async fn read_executor_state<P: Provider>(
    provider: &P,
    admin: Address,
    exec: Address,
) -> Result<ExecState, String> {
    let paused: bool = eth_call_decode(provider, admin, &isExecutorPausedCall { _executor: exec })
        .await
        .map_err(|e| wallet_err_json("SQUAD_ADMIN_READ", e, None))?;
    if paused {
        return Ok(ExecState {
            paused: true,
            full: false,
            known_flags: 0,
        });
    }
    let full: bool = eth_call_decode(
        provider,
        admin,
        &isExecutorFullPermissionCall { _executor: exec },
    )
    .await
    .map_err(|e| wallet_err_json("SQUAD_ADMIN_READ", e, None))?;
    if full {
        return Ok(ExecState {
            paused: false,
            full: true,
            known_flags: 0,
        });
    }
    let catalog = read_catalog_role_ids(provider, admin).await?;
    let mut known = 0u16;
    for role in catalog {
        let enabled: bool = eth_call_decode(
            provider,
            admin,
            &hasExecutorRoleCall {
                _executor: exec,
                _role: role,
            },
        )
        .await
        .map_err(|e| wallet_err_json("SQUAD_ADMIN_READ", e, None))?;
        if !enabled {
            continue;
        }
        if let Ok(decoded) = decode_privilege_role_id(role) {
            known |= decoded.known_flags & PRIVILEGE_KNOWN_ACTION_MASK;
        }
    }
    Ok(ExecState {
        paused: false,
        full: false,
        known_flags: known,
    })
}

/// How long an ingest-side read is reused; a revoked role can pass ingest for up to this long.
const EXEC_STATE_TTL: Duration = Duration::from_secs(30);

/// `(chain key, squad admin proxy, executor)`.
type ExecStateKey = (String, Address, Address);

fn exec_state_key(chain: &str, proxy: Address, exec: Address) -> ExecStateKey {
    (chain.trim().to_lowercase(), proxy, exec)
}

#[derive(Default)]
struct ExecStateCache {
    entries: HashMap<ExecStateKey, (ExecState, Instant)>,
}

impl ExecStateCache {
    fn get(&self, key: &ExecStateKey, now: Instant) -> Option<ExecState> {
        let (state, at) = self.entries.get(key)?;
        (now.saturating_duration_since(*at) < EXEC_STATE_TTL).then_some(*state)
    }

    fn put(&mut self, key: ExecStateKey, state: ExecState, now: Instant) {
        self.entries
            .retain(|_, (_, at)| now.saturating_duration_since(*at) < EXEC_STATE_TTL);
        self.entries.insert(key, (state, now));
    }

    fn invalidate(&mut self, chain: &str, proxy: Address) {
        let chain = chain.trim().to_lowercase();
        self.entries
            .retain(|(c, p, _), _| !(*c == chain && *p == proxy));
    }
}

static EXEC_STATE_CACHE: Lazy<Mutex<ExecStateCache>> =
    Lazy::new(|| Mutex::new(ExecStateCache::default()));

/// Fresh cache hit, else `read`; only successful reads are stored.
async fn cached_or_read<F>(
    cache: &Mutex<ExecStateCache>,
    key: ExecStateKey,
    read: F,
) -> Result<ExecState, String>
where
    F: Future<Output = Result<ExecState, String>>,
{
    let hit = cache
        .lock()
        .ok()
        .and_then(|c| c.get(&key, Instant::now()));
    if let Some(state) = hit {
        return Ok(state);
    }
    let state = read.await?;
    if let Ok(mut c) = cache.lock() {
        c.put(key, state, Instant::now());
    }
    Ok(state)
}

/// Drop cached executor state for one SquadAdmin proxy after a local role write.
pub fn invalidate_exec_state_cache(chain: &str, proxy: Address) {
    if let Ok(mut cache) = EXEC_STATE_CACHE.lock() {
        cache.invalidate(chain, proxy);
    }
}

/// Roster address for `member_npub`: current account uses the squad binding, peers use the certified share.
fn executor_address_for_member<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
    member_npub: &str,
) -> Result<Option<Address>, String> {
    let npub = member_npub.trim();
    if npub.is_empty() {
        return Ok(None);
    }
    if account_manager::get_current_account().ok().as_deref() == Some(npub) {
        if let Ok(addr) = resolve_acl_roster_address(app, parent_id) {
            return Ok(Some(addr));
        }
    }
    let rows = db::list_squad_member_evm(app.clone(), parent_id.to_string(), None)?;
    let Some(row) = rows.into_iter().find(|r| r.member_npub.trim() == npub) else {
        return Ok(None);
    };
    let raw = row.evm_address.trim();
    if raw.is_empty() {
        return Ok(None);
    }
    parse_address(raw)
        .map(Some)
        .map_err(|e| wallet_err_json("INVALID_EXECUTOR", e, None))
}

/// `Allowed` when SquadAdmin is inactive or the member holds the flag.
/// `Denied` when active and paused or missing the flag.
/// `Undecided` on RPC/read failure or when the member has no roster binding yet.
pub async fn member_has_squad_privilege<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
    member_npub: &str,
    action: SquadPrivilegeAction,
) -> MemberPrivilege {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return MemberPrivilege::Denied;
    }
    let admin = match resolve_squad_admin_proxy_from_infra(app, pid) {
        Ok(Some(admin)) => admin,
        Ok(None) => return MemberPrivilege::Allowed,
        Err(_) => return MemberPrivilege::Undecided,
    };
    let exec = match executor_address_for_member(app, pid, member_npub) {
        Ok(Some(exec)) => exec,
        Ok(None) | Err(_) => return MemberPrivilege::Undecided,
    };
    let key = exec_state_key(admin.chain.as_str(), admin.proxy, exec);
    let state = cached_or_read(&EXEC_STATE_CACHE, key, async {
        let (provider, _ctx) = connect_gov_read_provider(admin.chain.as_str(), None).await?;
        read_executor_state(&provider, admin.proxy, exec).await
    })
    .await;
    let Ok(state) = state else {
        return MemberPrivilege::Undecided;
    };
    match state.decision(action.flag_bit()) {
        ExecDecision::Allow => MemberPrivilege::Allowed,
        ExecDecision::Paused | ExecDecision::Deny => MemberPrivilege::Denied,
    }
}

/// Send-side check for `member_npub`: fails closed on `Denied` (`denied_code`) and on `Undecided`.
pub async fn require_member_squad_privilege<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
    member_npub: &str,
    action: SquadPrivilegeAction,
    denied_code: &str,
) -> Result<(), String> {
    match member_has_squad_privilege(app, parent_id, member_npub, action).await {
        MemberPrivilege::Allowed => Ok(()),
        MemberPrivilege::Denied => Err(denied_code.to_string()),
        MemberPrivilege::Undecided => Err(wallet_err_json(
            "SQUAD_ADMIN_READ",
            "Squad Admin privilege could not be read",
            None,
        )),
    }
}

/// Require current user's packed privilege for `action` on `parent_id`.
/// No SquadAdmin infra → allow. Unbound / RPC / pause / missing flag → deny.
pub async fn require_current_user_squad_privilege<R: Runtime>(
    app: &AppHandle<R>,
    parent_id: &str,
    action: SquadPrivilegeAction,
) -> Result<(), String> {
    let pid = parent_id.trim();
    if pid.is_empty() {
        return Err(wallet_err_json(
            "PRIVILEGE_DENIED",
            "parentId is required for privilege checks",
            None,
        ));
    }
    let Some(admin) = resolve_squad_admin_proxy_from_infra(app, pid)? else {
        return Ok(());
    };
    let exec = resolve_acl_roster_address(app, pid)?;
    let (provider, _ctx) = connect_gov_read_provider(admin.chain.as_str(), None).await?;
    let state = read_executor_state(&provider, admin.proxy, exec).await?;
    match state.decision(action.flag_bit()) {
        ExecDecision::Allow => Ok(()),
        ExecDecision::Paused => Err(wallet_err_json(
            "PRIVILEGE_PAUSED",
            "Squad Admin executor is paused",
            None,
        )),
        ExecDecision::Deny => Err(wallet_err_json(
            "PRIVILEGE_DENIED",
            "Missing Squad Admin privilege for this action",
            None,
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn is(d: ExecDecision, want: &str) -> bool {
        matches!(
            (d, want),
            (ExecDecision::Allow, "allow")
                | (ExecDecision::Paused, "paused")
                | (ExecDecision::Deny, "deny")
        )
    }

    #[test]
    fn decide_truth_table() {
        let need = FLAG_CREATE_EVENT;
        assert!(is(decide(true, true, need, need), "paused"));
        assert!(is(decide(false, true, 0, need), "allow"));
        assert!(is(decide(false, false, need, need), "allow"));
        assert!(is(decide(false, false, FLAG_ADD_DOC, need), "deny"));
        assert!(is(decide(false, false, 0, need), "deny"));
    }

    fn addr(byte: u8) -> Address {
        Address::repeat_byte(byte)
    }

    fn state(known_flags: u16) -> ExecState {
        ExecState {
            paused: false,
            full: false,
            known_flags,
        }
    }

    #[test]
    fn cache_hits_until_ttl_then_misses() {
        let mut cache = ExecStateCache::default();
        let key = exec_state_key("Sepolia", addr(1), addr(2));
        let t0 = Instant::now();
        assert_eq!(cache.get(&key, t0), None);

        cache.put(key.clone(), state(FLAG_CREATE_EVENT), t0);
        assert_eq!(
            cache.get(&key, t0 + EXEC_STATE_TTL - Duration::from_millis(1)),
            Some(state(FLAG_CREATE_EVENT))
        );
        assert_eq!(cache.get(&key, t0 + EXEC_STATE_TTL), None);
    }

    #[test]
    fn cache_key_ignores_chain_case_and_separates_executors() {
        let mut cache = ExecStateCache::default();
        let t0 = Instant::now();
        cache.put(exec_state_key("sepolia", addr(1), addr(2)), state(1), t0);
        assert_eq!(
            cache.get(&exec_state_key(" SEPOLIA ", addr(1), addr(2)), t0),
            Some(state(1))
        );
        assert_eq!(cache.get(&exec_state_key("sepolia", addr(1), addr(3)), t0), None);
        assert_eq!(cache.get(&exec_state_key("mainnet", addr(1), addr(2)), t0), None);
    }

    #[test]
    fn invalidate_drops_only_the_matching_proxy() {
        let mut cache = ExecStateCache::default();
        let t0 = Instant::now();
        let a = exec_state_key("sepolia", addr(1), addr(2));
        let b = exec_state_key("sepolia", addr(1), addr(3));
        let other = exec_state_key("sepolia", addr(9), addr(2));
        for key in [&a, &b, &other] {
            cache.put(key.clone(), state(1), t0);
        }
        cache.invalidate("Sepolia", addr(1));
        assert_eq!(cache.get(&a, t0), None);
        assert_eq!(cache.get(&b, t0), None);
        assert_eq!(cache.get(&other, t0), Some(state(1)));
    }

    #[test]
    fn put_prunes_expired_entries() {
        let mut cache = ExecStateCache::default();
        let t0 = Instant::now();
        cache.put(exec_state_key("sepolia", addr(1), addr(2)), state(1), t0);
        cache.put(
            exec_state_key("sepolia", addr(1), addr(3)),
            state(1),
            t0 + EXEC_STATE_TTL + Duration::from_secs(1),
        );
        assert_eq!(cache.entries.len(), 1);
    }

    #[test]
    fn one_cached_state_serves_every_action() {
        let s = state(FLAG_CREATE_EVENT);
        assert!(is(s.decision(FLAG_CREATE_EVENT), "allow"));
        assert!(is(s.decision(FLAG_ADD_DOC), "deny"));
    }

    #[tokio::test]
    async fn failed_read_is_not_cached_and_success_is() {
        let cache = Mutex::new(ExecStateCache::default());
        let key = exec_state_key("sepolia", addr(1), addr(2));

        let err = cached_or_read(&cache, key.clone(), async { Err("rpc down".to_string()) }).await;
        assert_eq!(err, Err("rpc down".to_string()));
        assert!(cache.lock().unwrap().entries.is_empty());

        let ok = cached_or_read(&cache, key.clone(), async { Ok(state(FLAG_ADD_DOC)) }).await;
        assert_eq!(ok, Ok(state(FLAG_ADD_DOC)));

        // A fresh hit short-circuits: this reader would fail if it ran.
        let hit = cached_or_read(&cache, key, async { Err("must not read".to_string()) }).await;
        assert_eq!(hit, Ok(state(FLAG_ADD_DOC)));
    }
}
