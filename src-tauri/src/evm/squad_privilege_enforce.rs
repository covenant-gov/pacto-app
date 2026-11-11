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
    let hit = cache.lock().ok().and_then(|c| c.get(&key, Instant::now()));
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
    privilege_from_cached_read(&EXEC_STATE_CACHE, key, action.flag_bit(), async {
        let (provider, _ctx) = connect_gov_read_provider(admin.chain.as_str(), None).await?;
        read_executor_state(&provider, admin.proxy, exec).await
    })
    .await
}

/// A failed read is `Undecided`; a successful one is `Allowed` or `Denied` for `needed`.
fn member_privilege_from_state(state: Result<ExecState, String>, needed: u16) -> MemberPrivilege {
    match state {
        Ok(state) => match state.decision(needed) {
            ExecDecision::Allow => MemberPrivilege::Allowed,
            ExecDecision::Paused | ExecDecision::Deny => MemberPrivilege::Denied,
        },
        Err(_) => MemberPrivilege::Undecided,
    }
}

async fn privilege_from_cached_read<F>(
    cache: &Mutex<ExecStateCache>,
    key: ExecStateKey,
    needed: u16,
    read: F,
) -> MemberPrivilege
where
    F: Future<Output = Result<ExecState, String>>,
{
    member_privilege_from_state(cached_or_read(cache, key, read).await, needed)
}

/// Fails closed: `Denied` returns `denied_code`, `Undecided` returns a read error.
fn privilege_gate_result(privilege: MemberPrivilege, denied_code: &str) -> Result<(), String> {
    match privilege {
        MemberPrivilege::Allowed => Ok(()),
        MemberPrivilege::Denied => Err(denied_code.to_string()),
        MemberPrivilege::Undecided => Err(wallet_err_json(
            "SQUAD_ADMIN_READ",
            "Squad Admin privilege could not be read",
            None,
        )),
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
    privilege_gate_result(
        member_has_squad_privilege(app, parent_id, member_npub, action).await,
        denied_code,
    )
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
        assert_eq!(
            cache.get(&exec_state_key("sepolia", addr(1), addr(3)), t0),
            None
        );
        assert_eq!(
            cache.get(&exec_state_key("mainnet", addr(1), addr(2)), t0),
            None
        );
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

    fn paused_state() -> ExecState {
        ExecState {
            paused: true,
            full: false,
            known_flags: 0,
        }
    }

    fn full_state() -> ExecState {
        ExecState {
            paused: false,
            full: true,
            known_flags: 0,
        }
    }

    #[test]
    fn member_privilege_from_state_maps_every_outcome() {
        let need = FLAG_CREATE_EVENT;
        let allowed = |s| member_privilege_from_state(Ok(s), need);
        assert_eq!(allowed(state(FLAG_CREATE_EVENT)), MemberPrivilege::Allowed);
        assert_eq!(allowed(full_state()), MemberPrivilege::Allowed);
        assert_eq!(allowed(state(FLAG_ADD_DOC)), MemberPrivilege::Denied);
        assert_eq!(allowed(state(0)), MemberPrivilege::Denied);
        assert_eq!(allowed(paused_state()), MemberPrivilege::Denied);
        assert_eq!(
            member_privilege_from_state(Err("rpc down".into()), need),
            MemberPrivilege::Undecided
        );
    }

    #[test]
    fn privilege_gate_result_fails_closed_with_distinct_errors() {
        assert_eq!(
            privilege_gate_result(MemberPrivilege::Allowed, "denied"),
            Ok(())
        );
        assert_eq!(
            privilege_gate_result(MemberPrivilege::Denied, "squad_event_create_restricted"),
            Err("squad_event_create_restricted".to_string())
        );
        let undecided = privilege_gate_result(MemberPrivilege::Undecided, "denied").unwrap_err();
        assert!(
            undecided.contains("\"code\":\"SQUAD_ADMIN_READ\""),
            "{undecided}"
        );
    }

    #[tokio::test]
    async fn one_cached_read_serves_both_actions() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let cache = Mutex::new(ExecStateCache::default());
        let key = exec_state_key("sepolia", addr(3), addr(4));
        let reads = AtomicUsize::new(0);
        let read = || async {
            reads.fetch_add(1, Ordering::SeqCst);
            Ok(state(FLAG_CREATE_EVENT))
        };

        let event =
            privilege_from_cached_read(&cache, key.clone(), FLAG_CREATE_EVENT, read()).await;
        let doc = privilege_from_cached_read(&cache, key, FLAG_ADD_DOC, async {
            Err("must not read".to_string())
        })
        .await;

        assert_eq!(event, MemberPrivilege::Allowed);
        assert_eq!(doc, MemberPrivilege::Denied);
        assert_eq!(reads.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn failed_read_is_undecided_and_leaves_cache_empty() {
        let cache = Mutex::new(ExecStateCache::default());
        let key = exec_state_key("sepolia", addr(5), addr(6));
        let out = privilege_from_cached_read(&cache, key, FLAG_ADD_DOC, async {
            Err("rpc down".to_string())
        })
        .await;
        assert_eq!(out, MemberPrivilege::Undecided);
        assert!(cache.lock().unwrap().entries.is_empty());
    }

    #[test]
    fn public_invalidate_clears_the_shared_cache_for_that_proxy() {
        let proxy = addr(0xA1);
        let other_proxy = addr(0xA2);
        let key = exec_state_key("sepolia", proxy, addr(0xB1));
        let other = exec_state_key("sepolia", other_proxy, addr(0xB1));
        {
            let mut cache = EXEC_STATE_CACHE.lock().unwrap();
            cache.put(key.clone(), state(1), Instant::now());
            cache.put(other.clone(), state(1), Instant::now());
        }
        invalidate_exec_state_cache("SEPOLIA", proxy);
        let cache = EXEC_STATE_CACHE.lock().unwrap();
        assert_eq!(cache.get(&key, Instant::now()), None);
        assert_eq!(cache.get(&other, Instant::now()), Some(state(1)));
    }

    /// The role-write path invalidates with the wallet network key; ingest keys on the stored chain.
    #[test]
    fn write_and_ingest_keys_agree_for_every_network() {
        for net in super::super::wallet_chain_config::wallet_networks() {
            assert_eq!(net.key, net.key.trim().to_lowercase(), "{}", net.key);
            assert_eq!(
                exec_state_key(&net.key, addr(1), addr(2)),
                exec_state_key(&net.key.to_uppercase(), addr(1), addr(2)),
                "{}",
                net.key
            );
        }
    }

    #[tokio::test]
    async fn empty_parent_id_is_denied() {
        let app = tauri::test::mock_app();
        let out = member_has_squad_privilege(
            app.handle(),
            "  ",
            "npub1anyone",
            SquadPrivilegeAction::CreateEvent,
        )
        .await;
        assert_eq!(out, MemberPrivilege::Denied);
    }

    mod member_address {
        use super::*;
        use crate::squad_record_privilege::test_support::{bind_self, certify_peer_share, setup};

        const SELF: &str = "npub1privenforceself";
        const PEER: &str = "npub1privenforcepeer";
        const SELF_ADDR: &str = "0x2222222222222222222222222222222222222222";
        const PEER_ADDR: &str = "0x3333333333333333333333333333333333333333";

        fn resolve(
            app: &tauri::App<tauri::test::MockRuntime>,
            parent: &str,
            npub: &str,
        ) -> Result<Option<Address>, String> {
            executor_address_for_member(app.handle(), parent, npub)
        }

        #[test]
        fn blank_npub_has_no_address() {
            let app = setup(SELF);
            assert_eq!(resolve(&app, "p-blank", "  "), Ok(None));
        }

        #[test]
        fn current_account_uses_its_squad_binding() {
            let app = setup(SELF);
            bind_self(app.handle(), "p-self", SELF, SELF_ADDR);
            assert_eq!(
                resolve(&app, "p-self", SELF),
                Ok(Some(parse_address(SELF_ADDR).unwrap()))
            );
        }

        #[test]
        fn current_account_without_binding_falls_back_to_its_certified_share() {
            let app = setup(SELF);
            certify_peer_share(app.handle(), "p-self-share", SELF, SELF_ADDR);
            assert_eq!(
                resolve(&app, "p-self-share", SELF),
                Ok(Some(parse_address(SELF_ADDR).unwrap()))
            );
        }

        #[test]
        fn peer_uses_its_certified_share() {
            let app = setup(SELF);
            certify_peer_share(app.handle(), "p-peer", PEER, PEER_ADDR);
            assert_eq!(
                resolve(&app, "p-peer", PEER),
                Ok(Some(parse_address(PEER_ADDR).unwrap()))
            );
        }

        #[test]
        fn peer_ignores_the_viewers_own_binding() {
            let app = setup(SELF);
            bind_self(app.handle(), "p-peer-other", SELF, SELF_ADDR);
            assert_eq!(resolve(&app, "p-peer-other", PEER), Ok(None));
        }

        #[test]
        fn peer_without_a_share_is_unresolved() {
            let app = setup(SELF);
            assert_eq!(resolve(&app, "p-none", PEER), Ok(None));
        }

        #[test]
        fn uncertified_share_is_not_trusted() {
            let app = setup(SELF);
            crate::squad_records::with_conn(app.handle(), |c| {
                c.execute(
                    "INSERT INTO squad_member_evm (parent_id, member_npub, evm_address, updated_at_ms)
                     VALUES ('p-uncert', ?1, ?2, 1)",
                    rusqlite::params![PEER, PEER_ADDR],
                )
                .map(|_| ())
                .map_err(|e| e.to_string())
            })
            .unwrap();
            assert_eq!(resolve(&app, "p-uncert", PEER), Ok(None));
        }

        #[test]
        fn share_scoped_to_another_parent_is_not_used() {
            let app = setup(SELF);
            certify_peer_share(app.handle(), "p-other-parent", PEER, PEER_ADDR);
            assert_eq!(resolve(&app, "p-this-parent", PEER), Ok(None));
        }

        #[test]
        fn empty_address_is_unresolved() {
            let app = setup(SELF);
            certify_peer_share(app.handle(), "p-empty", PEER, "  ");
            assert_eq!(resolve(&app, "p-empty", PEER), Ok(None));
        }

        #[test]
        fn malformed_address_is_an_invalid_executor_error() {
            let app = setup(SELF);
            certify_peer_share(app.handle(), "p-bad", PEER, "not-an-address");
            let err = resolve(&app, "p-bad", PEER).unwrap_err();
            assert!(err.contains("\"code\":\"INVALID_EXECUTOR\""), "{err}");
        }

        #[tokio::test]
        async fn unbound_peer_on_an_active_squad_is_undecided_not_denied() {
            let app = setup(SELF);
            crate::squad_record_privilege::test_support::activate_squad_admin(
                app.handle(),
                "p-undecided",
                "0x1111111111111111111111111111111111111111",
            );
            let out = member_has_squad_privilege(
                app.handle(),
                "p-undecided",
                PEER,
                SquadPrivilegeAction::AddDoc,
            )
            .await;
            assert_eq!(out, MemberPrivilege::Undecided);
        }

        #[tokio::test]
        async fn malformed_share_on_an_active_squad_is_undecided() {
            let app = setup(SELF);
            crate::squad_record_privilege::test_support::activate_squad_admin(
                app.handle(),
                "p-bad-share",
                "0x1111111111111111111111111111111111111111",
            );
            certify_peer_share(app.handle(), "p-bad-share", PEER, "garbage");
            let out = member_has_squad_privilege(
                app.handle(),
                "p-bad-share",
                PEER,
                SquadPrivilegeAction::CreateEvent,
            )
            .await;
            assert_eq!(out, MemberPrivilege::Undecided);
        }

        #[tokio::test]
        async fn inactive_squad_admin_allows_without_any_binding() {
            let app = setup(SELF);
            let out = member_has_squad_privilege(
                app.handle(),
                "p-inactive",
                PEER,
                SquadPrivilegeAction::CreateEvent,
            )
            .await;
            assert_eq!(out, MemberPrivilege::Allowed);
        }
    }

    mod read_state {
        use super::*;
        use alloy::primitives::Bytes;
        use alloy::providers::ProviderBuilder;
        use alloy::transports::mock::Asserter;

        fn word(value: usize) -> Bytes {
            Bytes::from(U256::from(value).to_be_bytes::<32>().to_vec())
        }

        fn flag_role(name: &str, flags: u16) -> B256 {
            super::super::super::privilege_role_id::encode_privilege_role_id(name, flags).unwrap()
        }

        fn read(asserter: &Asserter) -> impl Provider {
            ProviderBuilder::new().connect_mocked_client(asserter.clone())
        }

        async fn run(asserter: &Asserter) -> Result<ExecState, String> {
            read_executor_state(&read(asserter), addr(1), addr(2)).await
        }

        #[tokio::test]
        async fn paused_short_circuits_before_any_other_read() {
            let asserter = Asserter::new();
            asserter.push_success(&word(1));
            assert_eq!(run(&asserter).await, Ok(paused_state()));
        }

        #[tokio::test]
        async fn full_permission_short_circuits_before_the_catalog() {
            let asserter = Asserter::new();
            asserter.push_success(&word(0));
            asserter.push_success(&word(1));
            assert_eq!(run(&asserter).await, Ok(full_state()));
        }

        #[tokio::test]
        async fn catalog_ors_enabled_known_flags_and_ignores_the_rest() {
            let mut reserved = flag_role("X", FLAG_INVITE_ACCEPT).0;
            reserved[31] |= 0x80;
            let roles = [
                flag_role("Ev", FLAG_CREATE_EVENT),
                B256::from(reserved),
                flag_role("Doc", FLAG_ADD_DOC),
                B256::ZERO,
            ];
            let enabled = [true, true, false, true];

            let asserter = Asserter::new();
            asserter.push_success(&word(0));
            asserter.push_success(&word(0));
            asserter.push_success(&word(roles.len()));
            for role in roles {
                asserter.push_success(&Bytes::from(role.0.to_vec()));
            }
            for on in enabled {
                asserter.push_success(&word(usize::from(on)));
            }

            let got = run(&asserter).await.unwrap();
            assert_eq!(
                got,
                state(FLAG_CREATE_EVENT | FLAG_INVITE_ACCEPT),
                "disabled and undecodable roles must not contribute"
            );
        }

        #[tokio::test]
        async fn rpc_failure_maps_to_squad_admin_read() {
            let asserter = Asserter::new();
            asserter.push_failure_msg("upstream down");
            let err = run(&asserter).await.unwrap_err();
            assert!(err.contains("\"code\":\"SQUAD_ADMIN_READ\""), "{err}");
        }

        #[tokio::test]
        async fn failure_mid_catalog_is_an_error_not_a_partial_state() {
            let asserter = Asserter::new();
            asserter.push_success(&word(0));
            asserter.push_success(&word(0));
            asserter.push_success(&word(1));
            asserter.push_success(&Bytes::from(flag_role("Ev", FLAG_CREATE_EVENT).0.to_vec()));
            asserter.push_failure_msg("upstream down");
            assert!(run(&asserter).await.is_err());
        }
    }
}
