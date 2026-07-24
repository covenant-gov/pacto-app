# Code Review Results

**Scope:** PR 140 (`feat/gov-status`) reviewed against merge-base `00817230b138006e99968abeae314f7eda2939f7` -> PR head `464c0ed02741bb088c9ff4881ed2d8bed39dc29f` (58 files changed, ~2.1k lines).

**Intent:** Add squad-level dual-RPC failover for parent-scoped governance/deploy Tauri commands, and surface pending mutiny and Quartermaster crew add/remove actions on the unified Governance Proposals board alongside treasury proposals.

**Mode:** markdown report-only

**Reviewers:** correctness, project-standards, testing, maintainability, security, performance, api-contract, reliability, adversarial (local fallback), previous-comments, julik-frontend-races
- security -- new RPC override surface, MLS credential sharing, capability checks
- performance -- log scans and N+1 RPC calls in the proposals board loader
- reliability -- provider timeouts, failover, publish success handling
- api-contract -- Tauri command signatures and DTO shape changes
- julik-frontend-races -- Svelte async loading and shared acting guards on the proposals board
- adversarial (local fallback) -- pr-remote scope skipped the cross-model peer
- previous-comments -- verified the only prior comment was a non-actionable Copilot failure message

### Triage Groups

| Group | Findings | Context | Preferred Resolution | Why |
|-------|----------|---------|----------------------|-----|
| RPC failover and security | #1, #2, #7, #8, #10, #16, #19, #21, #28, #29, #37 | The new squad RPC override path introduces SSRF, capability-check inconsistency, and failover wiring gaps across the Rust/TS boundary. | Fix #1 (SSRF) and #10 (capability snapshot wiring) first; then #7 (timeouts) and #8 (credential stripping) before the rest. | These findings share the same override-list data flow; the security boundary and timeout behavior must be correct before optimizing or refactoring. |
| Quartermaster log scanning | #3, #4, #5, #6, #23, #24, #25, #26, #27 | list_quartermaster_pending is new, unguarded, unbounded, and can race in the UI. | Start with #3 (parent guard), then #5 (topic filter + lookback), #6/#7 (timeouts), and finally #4 (N+1) and frontend race guards (#25-#27). | Correctness and access control come before performance and UI polish. |
| Proposals board frontend races | #9, #11 | Mutiny execute and RPC publish lack serialization/success handling. | Land #9 (mutiny acting guard) and #11 (RPC publish await) together. | Both are user-action serialization bugs on the same board. |
| i18n and project standards | #12, #13, #14, #18, #20, #31, #32, #34, #35, #36 | New UI and error text is hardcoded English; console.warn bypasses project logger; localStorage key bypasses persistenceKey helper. | Add keys and replace strings per CLAUDE.md/AGENTS.md i18n rules; switch console.warn to dmWarn; use persistenceKey. | These are mechanical standards cleanups that should not block function but must be fixed before beta. |
| Type and contract safety | #17, #30, #33 | Weak types and missing caller arguments break the new RPC failover contract. | Tighten QuartermasterPendingActionDto.kind (#17), fix removeSquadTrackedToken chain arg (#39), default invalid kinds safely (#30), and wire the version field (#33). | These are small contract fixes that prevent silent misbehavior. |
| Structural maintainability | #15, #22 | ParentDashboard grew past 1k lines and write RPC fallback logic landed in the read module. | Extract Squad RPC section from ParentDashboard (#15) and move RPC fallback helpers out of gov_read.rs (#22). | These are follow-on refactors once the behavior is correct. |

### P0 -- Critical

| # | File | Issue | Reviewer | Confidence |
|---|------|-------|----------|------------|
| 1 | `src-tauri/src/evm/gov_read.rs:12` | Unvalidated RPC URLs allow backend SSRF in Tauri commands | security | 100 |

- **#1** — Every parent-scoped Tauri command now accepts an `rpc_urls` override list from the frontend. The backend `sanitize_rpc_urls` only trims and deduplicates strings, then passes them to `connect_read_provider`, which only checks that the string parses as a URL. No scheme, host, or private-network validation is performed. An attacker who can run JavaScript in the Tauri webview (XSS, malicious plugin, or local script) can invoke any governance command with `rpcUrls` pointing at internal services, cloud metadata endpoints, or arbitrary hosts, causing the Rust backend to issue HTTP requests to those targets. This is a classic SSRF surface introduced by the dual-RPC failover feature. Fix: Add backend validation in `sanitize_rpc_urls` (or a shared helper) that rejects any URL whose scheme is not `http:` or `https:` and, with an exception for the `local` chain's `localhost:8545`, blocks private/reserved IP ranges and link-local hosts. Use `url::Url` to inspect the scheme and host; keep the existing parse check in `connect_read_provider`. Add a test that `rpc_urls_or_default` rejects `file://` and `http://169.254.169.254/...`.
  - Evidence: `src-tauri/src/evm/gov_read.rs:12 -- pub(crate) fn sanitize_rpc_urls(raw: Option<Vec<String>>) -> Vec<String> {`
  - Evidence: `src-tauri/src/evm/gov_read.rs:18-27 -- for url in list { let trimmed = url.trim().to_string(); ... out.push(trimmed); }`

### P1 -- High

| # | File | Issue | Reviewer | Confidence |
|---|------|-------|----------|------------|
| 2 | `src-tauri/src/evm/access_control/evaluate.rs:205` | Capability preflight reads use attacker-controlled RPC override list | security | 100 |
| 3 | `src-tauri/src/evm/quartermaster_ops.rs:224` | New list_quartermaster_pending Tauri command has no parent membership guard | security | 100 |
| 4 | `src-tauri/src/evm/quartermaster_ops.rs:240` | N+1 RPC calls verify each QM candidate after log scan | performance | 100 |
| 5 | `src-tauri/src/evm/rpc/logs.rs:31` | Quartermaster log scan fetches all contract events without topic filtering across a 200k-block default lookback | performance, reliability | 100 |
| 6 | `src-tauri/src/evm/rpc/logs.rs:35` | Chunked eth_getLogs has no per-chunk timeout or inter-chunk delay | reliability | 100 |
| 7 | `src-tauri/src/evm/rpc/provider.rs:21` | RPC provider connection attempts have no timeout | reliability | 100 |
| 8 | `src/components/parent/dashboard/DashboardStatusTab.svelte:256` | Custom RPC URLs with embedded credentials are broadcast to all squad members | adversarial, security | 100 |
| 9 | `src/components/parent/governance/GovProposalsBoard.svelte:112` | Mutiny execute bypasses shared acting guard in board | julik-frontend-races | 100 |
| 10 | `src/components/parent/governance/PactoGovGovernanceShell.svelte:139` | Capability snapshot uses default RPCs when squad RPC is configured | adversarial, api-contract, maintainability | 100 |

- **#2** — `require_capability` (and the ACL snapshot it evaluates) now connects to the same user-supplied `rpc_urls` list that is used for the write path. Any member who can set a squad's primary RPC (or any caller who can inject a custom `rpcUrls` list) can point the capability check at a malicious node. That node can return false hat-wearer data, causing the backend to deny legitimate writes or to allow writes that the app believes are authorized but that the real chain will reject. More importantly, it couples the security-critical ACL read to the same untrusted transport used for the transaction, undermining the preflight's purpose. Fix: Evaluate capabilities against the trusted default/operator/curated RPC list (`wallet_chain_config::rpc_urls_for`) rather than the user override. In `evaluate_squad_capabilities`, use a separate `connect_gov_read_provider(network, None)` for the ACL snapshot, while the caller still passes the override to the transaction/read path. If the override must be used for reads, at least perform capability evaluation with the defaults and use the override only for the subsequent write/read calls.
  - Evidence: `src-tauri/src/evm/access_control/evaluate.rs:205 -- let chain = load_chain_context(app, pid, rpc_urls.clone()).await?;`
  - Evidence: `src-tauri/src/evm/access_control/evaluate.rs:206 -- let (provider, _ctx) = connect_gov_read_provider(chain.network.as_str(), rpc_urls).await?;`
- **#3** — The PR expands the Tauri command surface with `list_quartermaster_pending`, which accepts an arbitrary `network`, `quartermaster` address, and `rpc_urls` list and returns event logs without checking that the caller is a member of the squad that owns the quartermaster or that the address belongs to the parent's infra. While the existing `get_quartermaster_status`/`get_quartermaster_pending` read commands follow the same unauthenticated pattern, this is a new command added by the diff and should not extend the unguarded surface. A malicious frontend or XSS can use it to scan arbitrary contract logs and probe arbitrary RPC endpoints. Fix: Add a `parent_id: String` parameter and call `require_parent_member(&app, pid).await?` at the start of `list_quartermaster_pending`, then validate that the supplied `quartermaster` address matches the quartermaster recorded in the parent's Pacto Gov infra row. If a parent-scoped read without a parent is genuinely required, add a `parent_id` parameter and guard it consistently with other new read commands.
  - Evidence: `src-tauri/src/evm/quartermaster_ops.rs:224 -- pub async fn list_quartermaster_pending<R: Runtime>(`
  - Evidence: `src-tauri/src/evm/quartermaster_ops.rs:225-229 --     _app: AppHandle<R>, network: String, quartermaster: String, from_block: Option<u64>, rpc_urls: Option<Vec<String>>,`
- **#4** — After scanning Quartermaster event logs, list_quartermaster_pending issues a separate pendingCrewAddAt or pendingCrewRemoveAt eth_call for every candidate address. For a squad with many historical add/remove requests, this creates one RPC round-trip per candidate instead of a single batched call, multiplying latency and increasing the chance of partial failures or rate-limiting on the unified proposals board load. Fix: Batch the pending*At verification calls. Either use a multicall contract if the project already depends on one, or fire the pendingCrewAddAt/pendingCrewRemoveAt calls concurrently with futures::future::try_join_all and collect results, reducing the sequential RPC count from O(candidates) to O(1) round-trip.
  - Evidence: `src-tauri/src/evm/quartermaster_ops.rs:240 -- for (kind, addr) in add_addrs.into_iter().map(\|a\| (QmPendingKind::Add, a)).chain(remove_addrs.into_iter().map(\|a\| (QmPendingKind::Remove, a))) {`
  - Evidence: `src-tauri/src/evm/quartermaster_ops.rs:246-259 -- eth_call_decode(&provider, qm, &pendingCrewAddAtCall { _candidate: addr }) / pendingCrewRemoveAtCall { _crew: addr } inside the loop`
- **#5** — get_logs_chunked requests every log for the Quartermaster contract over up to 200,000 blocks (100 chunks of 2,000 blocks) with no topic0 filtering. The default board load calls this without a from_block, so providers return all contract events, not just the six crew lifecycle events, multiplying RPC payload size and decode work. Providers with low getLogs limits or slow response times can time out or rate-limit the unified proposals board. The Filter used by list_quartermaster_pending only constrains address and block range, so it retrieves every event emitted by the Quartermaster contract. On a busy module this multiplies response size, increases the chance of provider response limits or timeouts, and forces the Rust decoder to silently discard unrelated logs. Filtering to the six crew lifecycle event signatures would reduce RPC load and remove the silent-ignore path. Fix: Add topic0 filtering to the log scan so only CrewAddRequested/Cancelled/Executed and CrewRemoveRequested/Cancelled/Executed logs are fetched, and have the frontend pass the Quartermaster deployment block as from_block so the scan starts at the contract's first event instead of walking 200k blocks from the tip.
  - Evidence: `src-tauri/src/evm/rpc/logs.rs:31-34 -- Filter::new().address(address).from_block(start).to_block(end)`
  - Evidence: `src-tauri/src/evm/rpc/logs.rs:14 -- pub const DEFAULT_LOG_LOOKBACK_BLOCKS: u64 = 200_000;`
- **#6** — list_quartermaster_pending scans up to 200,000 blocks in 2,000-block chunks, issuing roughly 100 sequential eth_getLogs calls plus a get_block_number call. Without a timeout on each call, a stalled RPC hangs the command. Without a delay between chunks, a rate-limited provider may return 429 errors or close the connection, turning one slow RPC into a cascading failure for the dashboard's pending-crew loader. Fix: Wrap each provider.get_logs(&filter).await in tokio::time::timeout(Duration::from_secs(15), ...).await and add a short tokio::time::sleep(Duration::from_millis(50)).await between chunks except the last. Also apply a timeout to the provider.get_block_number() call in resolve_lookback_range.
  - Evidence: `src-tauri/src/evm/rpc/logs.rs:35 -- let batch = provider.get_logs(&filter).await.map_err(\|e\| {`
  - Evidence: `src-tauri/src/evm/rpc/logs.rs:57 -- let tip = provider.get_block_number().await.map_err(\|e\| {`
- **#7** — A slow or hung custom squad RPC URL will block the entire parent-scoped Tauri command indefinitely. The UI waits on the invoke, and the backend task holds resources. Since this PR introduces squad-configurable primary and backup RPC URLs, a misconfigured or unreachable endpoint becomes a first-class failure path for all governance/deploy reads and writes. Adding a bounded timeout per URL lets the failover loop fall through to the next candidate instead of hanging forever. Fix: Wrap each ProviderBuilder::new().connect(url_s.as_str()).await in connect_read_provider and connect_signing_provider in tokio::time::timeout(Duration::from_secs(10), ...).await; on timeout, set last_err to a timeout message and continue to the next URL. Duration is already imported from std::time.
  - Evidence: `src-tauri/src/evm/rpc/provider.rs:21 -- match ProviderBuilder::new().connect(url_s.as_str()).await {`
  - Evidence: `src-tauri/src/evm/rpc/provider.rs:43-46 -- match ProviderBuilder::new().wallet(wallet.clone()).connect(url_s.as_str()).await`
- **#8** — The squad RPC share note says endpoints are shared, but the message format carries the exact URL string (including any API key in the path or query) and the parser accepts any http(s) URL. A member can paste an Alchemy/Infura URL with an embedded API key, click Save, and the key is broadcast to every other squad member via MLS and stored in their localStorage. The current warning does not mention that credentials or API keys inside the URL are also shared, so members may leak private RPC credentials without understanding it. The leaked key cannot be revoked from other members' devices without rotating it at the provider. When a member sets a custom primary or backup RPC, `publishSquadRpcUpdated` sends the raw URL string to the squad's `#announcements` MLS channel. If the member pasted a provider URL that embeds an API key in the path (e.g., `https://eth-sepolia.g.alchemy.com/v2/<key>`) or query/userinfo, every squad member receives that credential. The UI does warn that endpoints are shared, but it does not prevent or sanitize the sharing of secrets. The project already has a Rust `redact_rpc_url_for_log` helper, yet the same protection is not applied before the MLS payload is constructed. Fix: Update the warning to explicitly state that URL credentials, API keys, and query tokens are shared with all members and persisted on their devices. Optionally detect URLs containing userinfo or common API-key query patterns and require an extra confirmation before publishing.
  - Evidence: `src/components/parent/dashboard/DashboardStatusTab.svelte:256 -- Squad RPC endpoints are shared with all members. Your Settings default is a private fallback only.`
  - Evidence: `src/lib/squad/squad-rpc-share.ts:34-43 -- formatSquadRpcUpdated embeds rpc1.url and rpc2.url verbatim in the MLS payload`
- **#9** — The unified proposals board disables the Execute button while the shared `acting` flag is true, but only `runTreasuryExecute` and `runCrewExecute` set that flag. When the board dispatches a mutiny execute, `executeForCard` calls `onExecuteMutiny()` directly without checking or setting `acting`. The parent `executeMutinyFromBoard` also has no guard. A user can double-click the mutiny Execute button and submit multiple `mutinyExecute` invokes, which can produce duplicate on-chain transactions and leave the mutiny in an unexpected state. The fix should route mutiny execution through the same `acting` guard used for treasury and crew cards. Fix: Wrap mutiny execution in the board with a helper that checks `acting` and returns only after the parent promise settles, e.g. `async function runMutinyExecute() { if (acting) return; acting = true; try { await onExecuteMutiny(); } finally { acting = false; } }`, then call `runMutinyExecute()` from `executeForCard`.
  - Evidence: `src/components/parent/governance/GovProposalsBoard.svelte:112 -- onExecuteMutiny();`
  - Evidence: `src/components/parent/governance/GovProposalsBoard.svelte:60-77 -- async function runTreasuryExecute(proposalId: string) { if (acting \|\| !execGate.enabled) return; acting = true; ... finally { acting = false; } }`
- **#10** — The governance shell renders CTA enable/disable states from getSquadCapabilities, but it calls the wrapper without the network argument. The wrapper therefore builds rpcUrls from the stored squad RPC config chain (if any) or returns null, falling back to backend default RPCs. The actual governance writes in the same flow are invoked with the squad RPC override list. This means the UI can show the wrong capability state (e.g., Execute enabled when the backend will reject, or disabled when the backend would allow) whenever the squad RPC differs from the operator/curated defaults. The PR intends squad-level dual RPC failover to apply to ACL/capability reads. The getSquadCapabilities wrapper now accepts an optional network so it can resolve squad RPC URLs even when no stored config exists. Three Svelte components still call it with only parentId, so when a squad has no persisted RPC config the capability evaluation falls back to operator/curated defaults instead of the squad's configured primary/backup. This leaves the ACL snapshot on a different RPC path than the governance reads it gates. The PR threads the squad RPC override through nearly every parent-scoped Tauri command, but loadCapabilities calls getSquadCapabilities(pid) without the network argument. That means capability evaluation falls back to the default/operator RPC instead of the squad's custom RPC, creating a split-brain view where the ACL snapshot may see a different chain state than the writes it gates. This undermines the consistency goal of the dual-RPC failover. Fix: Change the call to `getSquadCapabilities(pid, network)` so the wrapper resolves the same squad RPC failover list used for the rest of the governance reads and writes.
  - Evidence: `src/components/parent/governance/PactoGovGovernanceShell.svelte:139 -- const snap = await getSquadCapabilities(pid);`
  - Evidence: `src/lib/governance/api.ts:1152-1159 -- export async function getSquadCapabilities(parentId: string, network?: string \| null): ... rpcUrls: squadRpcUrlsForInvoke(parentId, network)`

### P2 -- Moderate

| # | File | Issue | Reviewer | Confidence |
|---|------|-------|----------|------------|
| 11 | `src/components/parent/dashboard/DashboardStatusTab.svelte:105` | Squad RPC edit UI does not await publish success and allows rapid overlapping MLS publishes | julik-frontend-races, reliability | 100 |
| 12 | `src/components/parent/dashboard/DashboardStatusTab.svelte:205` | New squad RPC UI in DashboardStatusTab uses hardcoded English labels | project-standards | 100 |
| 13 | `src/components/parent/governance/GovProcessCard.svelte:30` | New GovProcessCard component renders hardcoded English user-facing strings | project-standards | 100 |
| 14 | `src/components/parent/governance/GovProposalsBoard.svelte:90` | New Quartermaster toast and empty-state messages in GovProposalsBoard are hardcoded English | project-standards | 100 |
| 15 | `src/components/parent/ParentDashboard.svelte:184` | ParentDashboard.svelte grows past 1k lines with new squad RPC surface | maintainability | 100 |
| 16 | `src/lib/dashboard/parent-dashboard-loaders.ts:103` | Treasury vote-map loader is not wired to squad RPC failover | adversarial | 100 |
| 17 | `src/lib/governance/api.ts:796` | QuartermasterPendingActionDto.kind is typed as string, losing discriminator safety | api-contract, maintainability, correctness | 100 |
| 18 | `src/lib/governance/gov-process.ts:104` | gov-process.ts returns hardcoded English tool labels | project-standards | 100 |
| 19 | `src/lib/squad/squad-rpc.ts:157` | buildSquadInvokeRpcUrls falls back to stored chain and can carry stale URLs across network changes | correctness, maintainability | 100 |
| 20 | `src/lib/squad/squad-rpc.ts:169` | squad-rpc.ts returns hardcoded English user-facing labels and validation errors | project-standards | 100 |
| 21 | `src-tauri/src/evm/gov_read.rs:12` | RPC URL deduplication is duplicated across Rust and TypeScript | maintainability | 75 |
| 22 | `src-tauri/src/evm/gov_read.rs:33` | Write RPC fallback logic lives in the gov_read module | maintainability | 75 |
| 23 | `src-tauri/src/evm/quartermaster_ops.rs:224` | Quartermaster pending log scan can surface stale executable actions after reorgs | adversarial | 75 |
| 24 | `src-tauri/src/evm/rpc/logs.rs:14` | Quartermaster pending log scan uses a fixed lookback that misses old actions | adversarial | 75 |
| 25 | `src/components/parent/governance/PactoGovGovernanceShell.svelte:248` | Async reloadQmPending can write state after unmount | julik-frontend-races | 75 |
| 26 | `src/components/parent/governance/PactoGovGovernanceShell.svelte:250` | Quartermaster pending loader stuck when module clears | julik-frontend-races | 75 |
| 27 | `src/components/parent/governance/PactoGovGovernanceShell.svelte:264` | Refresh button spawns overlapping quartermaster log scans | julik-frontend-races | 75 |
| 28 | `src/components/parent/governance/TreasurySafeModulePanel.svelte:190` | removeSquadTrackedToken callers omit chain, leaving token-removal RPC on default providers | api-contract | 75 |
| 29 | `src/lib/app/mls-structured-refresh.ts:86` | MLS RPC update is applied without sender or bucket validation | adversarial | 75 |
| 30 | `src/lib/governance/gov-process.ts:62` | gov-process silently defaults invalid qmPending kind to crew_add | testing | 75 |

- **#11** — `applyRpcEdit` synchronously calls the parent `onSetSquadRpcPrimary`/`onSetSquadRpcBackup` handler and immediately closes the form. The Save button is only disabled when the URL draft is empty, not while a publish is in flight. The parent handler saves to localStorage and then `void publishSquadRpcUpdated(...)` fire-and-forgets the MLS announcement. A user can double-click Save or reopen the form and save again before the first publish finishes, causing multiple overlapping `sendDmMessage` calls and duplicate `#announcements` RPC update posts. The UI should disable Save and await the publish promise. The handlers that set, clear, or update the squad RPC call publishSquadRpcUpdated with void and never inspect the returned boolean. If the MLS #announcements publish fails (network offline, MLS not ready, rate limited), the local change is saved but other squad members never receive the updated RPC, and the user receives no feedback. This silent failure undermines the shared-RPC feature that the PR is built around. Fix: Make `handleSetSquadRpcPrimary`/`handleSetSquadRpcBackup` return the promise from `publishSquadRpcUpdated`, add a `publishing` boolean in `DashboardStatusTab`, and disable the Save button while `publishing` is true. Only close the form once the returned promise resolves.
  - Evidence: `src/components/parent/dashboard/DashboardStatusTab.svelte:105-112 -- function applyRpcEdit() { ... const err = editingRpc === 'backup' ? onSetSquadRpcBackup(rpcUrlDraft) : onSetSquadRpcPrimary(rpcUrlDraft); ... cancelRpcEdit(); }`
  - Evidence: `src/components/parent/dashboard/DashboardStatusTab.svelte:214 -- <button type="button" class="btn-text" disabled={!rpcUrlDraft.trim()} on:click={applyRpcEdit}>`
- **#12** — The new primary/backup RPC controls in the Status tab expose English-only labels ('RPC', 'Add custom RPC', 'Add backup RPC', 'Use public node', 'Need an RPC provider?', 'Squad RPC endpoints are shared...', etc.) to all users. Since the rest of the file already uses svelte-i18n ($t('governance.status.*')), these new strings violate the project's i18n standard. Fix: Add squad-rpc keys to src/lib/i18n/locales/en/squad.json and es/squad.json, then replace hardcoded labels with $t('squad.rpc.*'), reusing existing governance common keys for Save/Cancel if available.
  - Evidence: `src/components/parent/dashboard/DashboardStatusTab.svelte:205 -- `<span class="meta-label">RPC</span>``
  - Evidence: `src/components/parent/dashboard/DashboardStatusTab.svelte:212 -- `aria-label={editingRpc === 'backup' ? 'Backup squad RPC URL' : 'Primary squad RPC URL'}``
- **#13** — Spanish-speaking users see English labels like 'Proposal #', 'Mutiny #', 'Add crew member', 'Ready to execute', 'Yeas', 'nays', 'Captain approved', etc. in the unified governance board. This directly breaks the project's i18n contract that requires all user-facing strings to be translatable. The component is entirely new, so it should have used $t() from the start, matching the rest of the codebase. Fix: Add governance card keys to src/lib/i18n/locales/en/governance.json and es/governance.json, then replace every hardcoded string in the component with $t('governance.proposals.*') or pass translatable labels from a parent loader, following src/components/announcements/PactoGovDeployedAnnounceBody.svelte.
  - Evidence: `src/components/parent/governance/GovProcessCard.svelte:30 -- `? 'Proposal #${card.proposal.proposalId}'``
  - Evidence: `src/components/parent/governance/GovProcessCard.svelte:34 -- `'Add crew member'``
- **#14** — The new runCrewExecute toasts ('Execute add crew submitted.', 'Execute failed.') and the new empty/mutiny status copy ('No active governance processes.', 'No active mutiny · captain') are surfaced to users without translation. The component logic is in TypeScript, so it should use get(t)('...') from svelte-i18n, matching the project's frontend i18n convention. Fix: Import { t } from 'svelte-i18n' and use get(t)('governance.toast.*') / get(t)('governance.empty.*') for the new strings, adding the keys to both locale governance catalogs.
  - Evidence: `src/components/parent/governance/GovProposalsBoard.svelte:90 -- `showToast('Execute add crew submitted.');``
  - Evidence: `src/components/parent/governance/GovProposalsBoard.svelte:98 -- `showToast('Execute remove crew submitted.');``
- **#15** — The dashboard file was already 1,026 lines before this change and now absorbs the new squad RPC state, reactive block, and three handler functions. Large Svelte files are harder to test, review, and refactor because they mix routing, data loading, network settings, and now RPC configuration. Keeping the file under control reduces the risk that future governance or network changes collide in the same component. Fix: Extract the squad RPC status form into a dedicated SquadRpcStatusSection.svelte component. Move the squadRpcConfig reactive block, the three handleSetSquadRpc* handlers, and the related props out of ParentDashboard so the dashboard only orchestrates data flow.
  - Evidence: `src/components/parent/ParentDashboard.svelte:184 -- let squadRpcConfig: SquadRpcConfig \| null = null;`
  - Evidence: `Base file was 1,026 lines; PR head file is 1,086 lines per wc -l.`
- **#16** — fetchTreasuryProposalVoteMap was not updated to accept parentId, even though the underlying treasuryProposalHasVoted API wrapper and the rest of the dashboard loaders were wired to use squad RPCs. As a result, every vote lookup falls back to backend default RPCs while the proposal list and vote transactions use the squad RPC override. In a squad that relies on a custom RPC, this can produce stale or inconsistent vote status, leading crew members to think they have or haven't voted when the opposite is true on the squad RPC. Fix: Add `parentId?: string \| null` to the loader params and pass it through to `treasuryProposalHasVoted({ ..., parentId: params.parentId })`, matching the other loaders in the same file.
  - Evidence: `src/lib/dashboard/parent-dashboard-loaders.ts:103-108 -- const voted = await treasuryProposalHasVoted({ network: params.network, treasuryAuthority: params.treasuryAuthority, proposalId: p.proposalId, voter: params.voterAddress });`
  - Evidence: `src/lib/governance/api.ts:530-544 -- treasuryProposalHasVoted accepts parentId and passes it to squadRpcUrlsForInvoke`
- **#17** — The backend contract only emits 'add' or 'remove' for Quartermaster pending action kinds. The TypeScript DTO widens the type to 'add' \| 'remove' \| string, which collapses to string and removes compile-time exhaustiveness checking for consumers. Downstream components like GovProcessCard rely on a closed set of crew-pending kinds; a mistyped backend value would not be caught by TypeScript. The kind field is typed as 'add' \| 'remove' \| string in TypeScript and as a plain String in Rust. This defeats exhaustiveness checking and allows invalid values to flow through the unified proposals board, making it easy to introduce a new card kind that the UI switch statements cannot handle. The existing Rust code already has an internal QmPendingKind enum that could be used for the DTO. The kind field is typed as 'add' \| 'remove' \| string, which collapses to string in practice. buildGovProcessCards maps any non-'remove' value to 'crew_add', so a malformed or future kind value would render as an add-crew card with wrong execute semantics instead of being rejected or filtered out. Fix: Change the TypeScript kind field to 'add' \| 'remove' only, matching the Rust DTO contract.
  - Evidence: `src/lib/governance/api.ts:796 -- export interface QuartermasterPendingActionDto {
  kind: 'add' \| 'remove' \| string;
  address: string;
  executableAt: string;
}`
  - Evidence: `src-tauri/src/evm/quartermaster_ops.rs:657-661 -- pub struct QuartermasterPendingActionDto {
    /// `"add"` or `"remove"`.
    pub kind: String,
    pub address: String,
    pub executable_at: String,
}`
- **#18** — govProcessToolLabel returns English strings ('Treasury Authority', 'Mutiny', 'Quartermaster') that are rendered as badges on every governance process card in the unified board. These labels are user-facing and must be translatable per the i18n standard. Fix: Make govProcessToolLabel accept a translator function or return catalog keys instead of raw strings, and add governance tool-label keys to the i18n governance catalog.
  - Evidence: `src/lib/governance/gov-process.ts:104 -- `return 'Treasury Authority';``
  - Evidence: `src/lib/governance/gov-process.ts:106 -- `return 'Mutiny';``
- **#19** — When a member changes the squad network (pre-deploy) or receives an RPC update whose stored chain no longer matches the effective squad network, the custom RPC slot keeps its old URL while effectiveSquadRpcConfig simply relabels it with the new chain. buildSquadInvokeRpcUrls then sends the old-chain URL to parent-scoped Tauri invokes for the new chain, causing connection failures or wrong-chain reads/writes. The UI never clears or revalidates RPC slots on network change. A function named as a pure URL builder reads localStorage via loadSquadRpcConfig when its chain argument is null. This hides a side effect inside URL construction, makes the function harder to unit test in isolation, and couples the invoke-URL path to the storage schema. Callers already know the chain they intend to use, so the fallback is unnecessary and obscures the actual data flow. Fix: In effectiveSquadRpcConfig, when stored.chain !== chain, return factory defaults for the new chain ({ chain, rpc1: defaultPublicSlot(), rpc2: unsetSlot() }) instead of carrying the old URL over. Alternatively, clear the RPC slots in setSquadNetwork whenever the network changes so the next effective config is fresh.
  - Evidence: `src/lib/squad/squad-rpc.ts:157 --         : { chain, rpc1: stored.rpc1, rpc2: stored.rpc2 };`
  - Evidence: `src/lib/squad/squad-rpc.ts:154-157 --     if (stored) {
      return stored.chain === chain
        ? stored
        : { chain, rpc1: stored.rpc1, rpc2: stored.rpc2 };
    }`
- **#20** — formatSquadRpcLabel returns English-only labels ('Not set', 'Public node', 'Custom') that are rendered in the Status tab, and setSquadRpcPrimary/setSquadRpcBackup return English validation errors that are displayed in rpcFormError. Because these are returned from plain TypeScript helpers, they bypass the svelte-i18n pipeline and break Spanish localization. Fix: Either pass the t function into formatSquadRpcLabel and the setters, or move label/error generation into the Svelte component where $t() is available, and add the keys to src/lib/i18n/locales/{en,es}/squad.json.
  - Evidence: `src/lib/squad/squad-rpc.ts:169 -- `if (!slot) return { ok: false, error: 'Enter a valid http(s) RPC URL.' };``
  - Evidence: `src/lib/squad/squad-rpc.ts:195 -- `return { ok: false, error: 'Set a custom primary RPC before adding a backup.' };``
- **#21** — Both sanitize_rpc_urls in Rust and resolveSquadRpcUrls in TypeScript implement the same trim, lowercase, and seen-set deduplication algorithm. If the project later changes deduplication rules (e.g., case-sensitivity, order preservation, or empty handling), both implementations must be updated in lockstep, creating a maintenance trap and a likely source of subtle drift between the UI-rendered RPC list and the list actually sent to Tauri. Fix: Make the Rust sanitizer the canonical boundary for the override list: remove the seen deduplication loop from resolveSquadRpcUrls and let it return the raw expanded slot URLs, relying on sanitize_rpc_urls in Rust to deduplicate. Keep the user-default distinctness check in buildSquadInvokeRpcUrls so the private fallback is never duplicated.
  - Evidence: `src-tauri/src/evm/gov_read.rs:12-30 -- pub(crate) fn sanitize_rpc_urls ...`
  - Evidence: `src/lib/squad/squad-rpc.ts:250-262 -- export function resolveSquadRpcUrls ...`
- **#22** — rpc_urls_or_default is consumed by both read providers and write paths (e.g., gov_module_write, safe_deploy, squad_admin_write). The module is named and documented as read-only governance context, so placing the shared write-fallback URL resolver there is a wrong-layer placement. It makes the dependency graph confusing and increases the chance that future write-only RPC changes touch a read module. Fix: Move sanitize_rpc_urls and rpc_urls_or_default to src-tauri/src/evm/rpc/config.rs (or wallet_chain_config.rs), and import them from there in both read and write modules. Keep gov_read.rs focused on network resolution and provider connection.
  - Evidence: `src-tauri/src/evm/gov_read.rs:33 -- pub fn rpc_urls_or_default(...)`
  - Evidence: `The function is imported by gov_module_write.rs, nave_pirata_deploy.rs, safe_deploy.rs, squad_admin_deploy.rs, squad_admin_write.rs, and several others for writes.`
- **#23** — list_quartermaster_pending discovers pending add/remove actions from event logs and then verifies them with the pendingCrewAddAt/pendingCrewRemoveAt views. Both the log scan and the verification call use the same provider, so if that provider is on a stale fork or a reorg that removed an Executed event, the verification can still return a non-zero value. The frontend then shows an 'Execute' button for an action that is no longer pending, and the user will waste gas or get a confusing transaction failure when the write reaches the canonical chain. Fix: Cross-check the pendingCrewAddAt/RemoveAt result against the next URL in the squad RPC failover list, or require a small confirmation depth before treating a log-derived pending action as executable. Alternatively, fetch the tip from the write provider and compare it to the log-scan provider before displaying the action.
  - Evidence: `src-tauri/src/evm/quartermaster_ops.rs:224-236 -- pub async fn list_quartermaster_pending(...) { ... let (provider, _ctx) = connect_gov_read_provider(network.as_str(), rpc_urls).await?; let (from, to) = resolve_lookback_range(&provider, from_block, DEFAULT_LOG_LOOKBACK_BLOCKS).await?; let logs = get_logs_chunked(&provider, qm, from, to, DEFAULT_LOG_CHUNK_BLOCKS).await?; ... }`
  - Evidence: `src-tauri/src/evm/quartermaster_ops.rs:245-261 -- executable_at is read from the same provider for each address discovered from the logs`
- **#24** — The log scan defaults to 200,000 blocks. If a squad has been active longer than that and a crew add/remove request was made before the window, the event will never be discovered, so the pending action will never appear on the proposals board even though pendingCrewAddAt would return a non-zero value. The function accepts a from_block argument, but the frontend never passes it, so the fixed window is always used. Fix: Resolve the Quartermaster deployment block from the stored Pacto Gov deployment and pass it as from_block, or persist the last scanned block per parent and resume from there on subsequent loads.
  - Evidence: `src-tauri/src/evm/rpc/logs.rs:14 -- pub const DEFAULT_LOG_LOOKBACK_BLOCKS: u64 = 200_000;`
  - Evidence: `src-tauri/src/evm/quartermaster_ops.rs:224-235 -- list_quartermaster_pending calls resolve_lookback_range with from_block: None, so it always uses the default lookback`
- **#25** — `reloadQmPending` is a new async function that assigns to component variables (`qmPending`, `qmPendingLoading`, `qmPendingError`) after an `await`. The project uses Svelte 5, yet there is no unmount cleanup to stop the pending promise from completing and writing state. If the user navigates away while the log scan is in flight, the callback will mutate the component state after teardown, which can trigger Svelte 5 runtime warnings. The existing `isSupersededLoaderKey` guard only protects against parentId/network changes, not unmount. Track a `mounted` flag or pass an `AbortSignal` and return early before the assignments when the component is no longer mounted. Fix: Track a `mounted` boolean via `onMount`/`onDestroy` and check it before setting `qmPending*` in `reloadQmPending`; alternatively pass an `AbortSignal` to `fetchQuartermasterPendingActions` and abort on destroy.
  - Evidence: `src/components/parent/governance/PactoGovGovernanceShell.svelte:248 -- async function reloadQmPending() {`
  - Evidence: `src/components/parent/governance/PactoGovGovernanceShell.svelte:257-261 -- await fetchQuartermasterPendingActions(...); qmPendingLoading = false; qmPending = result.pending; qmPendingError = result.error;`
- **#26** — `reloadQmPending` sets `qmPendingLoading = true` before awaiting the log scan, but the early-return path for an empty quartermaster address clears `qmPending` and `qmPendingError` without resetting `qmPendingLoading`. If a previous fetch was in flight and the quartermaster prop clears concurrently, the loading flag can remain true and the unified proposals board will keep showing the loading spinner indefinitely. Add the missing loading reset in the early return branch. Fix: Set `qmPendingLoading = false;` inside the `if (!quartermaster)` block before returning.
  - Evidence: `src/components/parent/governance/PactoGovGovernanceShell.svelte:250-253 -- if (!quartermaster) { qmPending = []; qmPendingError = ''; return; }`
  - Evidence: `src/components/parent/governance/PactoGovGovernanceShell.svelte:256 -- qmPendingLoading = qmPending.length === 0;`
- **#27** — `refreshAllProposals` is wired to the Refresh button and calls `reloadMutiny(true)`, `reloadQm(true)`, and `reloadQmPending()` as fire-and-forget. While `reloadMutiny` and `reloadQm` use the shared `fetchGovModuleReadCached` inflight map to deduplicate, `reloadQmPending` has no such guard. Rapid clicks on the Refresh button can therefore start multiple parallel `list_quartermaster_pending` log scans, increasing RPC load and creating a race to set `qmPending`/`qmPendingError` with whichever call finishes last. Add an `inflight` promise or a component-level refreshing guard to serialize or ignore overlapping pending log scans. Fix: Add an `inflight` promise map for pending log scans in `reloadQmPending`, similar to `fetchGovModuleReadCached`, or add a `refreshing` boolean and return early from `refreshAllProposals` while a refresh is already in progress.
  - Evidence: `src/components/parent/governance/PactoGovGovernanceShell.svelte:264-268 -- function refreshAllProposals() { onRefreshProposals(); void reloadMutiny(true); void reloadQm(true); void reloadQmPending(); }`
  - Evidence: `src/components/parent/governance/PactoGovGovernanceShell.svelte:248-262 -- async function reloadQmPending() { ... const result = await fetchQuartermasterPendingActions(...); ... }`
- **#28** — Tracked-token mutations now support squad RPC failover via an optional chain argument. The TreasurySafeModulePanel remove paths call removeSquadTrackedToken with only parentId and id, so the invoke falls back to default/operator RPCs even when the squad has a custom primary configured. This is inconsistent with upsertSquadTrackedToken, which already passes chain and therefore resolves squad RPC URLs. Fix: Pass row.chain (or the relevant chain string) as the third argument to removeSquadTrackedToken in both call sites.
  - Evidence: `src/lib/governance/squad-tracked-tokens.ts:78-86 -- export async function removeSquadTrackedToken(
  parentId: string,
  id: string,
  chain?: string \| null,
): Promise<void> {
  await invoke('remove_squad_tracked_token', {
    parentId: parentId.trim(),
    id: id.trim(),
    rpcUrls: squadRpcUrlsForInvoke(parentId, chain),
  });
}`
  - Evidence: `src/components/parent/governance/TreasurySafeModulePanel.svelte:190 -- await removeSquadTrackedToken(parentId.trim(), row.id);`
- **#29** — onMlsStructuredMessage applies any received squad_rpc_updated payload whose parent_id matches the group, regardless of which member sent it or which virtual bucket the message was posted to. A malicious squad member can therefore override the RPC configuration used by other members' governance reads and writes by posting a crafted message. The handler also ignores the pacto_virtual_bucket field, so the update can be triggered from a message in the inbox or any other bucket, not only the intended announcements channel. This is a cross-layer trust assumption: the product warns the setter that the endpoint is shared, but receivers get no confirmation or indication that the URL changed. Fix: Require the RPC update to come from a member with the captain hat or an explicit capability, and ensure it is only accepted when the message's virtual bucket is 'announcements'. Consider persisting the sender npub with the saved config so the UI can show who changed the RPC.
  - Evidence: `src/lib/app/mls-structured-refresh.ts:86-91 -- const rpcUpdate = parseSquadRpcUpdated(raw); if (rpcUpdate && rpcUpdate.parent_id === gid) { const me = get(currentUser)?.npub?.trim(); if (me) { applySquadRpcUpdated(rpcUpdate, me); } }`
  - Evidence: `src/lib/squad/squad-rpc-share.ts:47-72 -- parseSquadRpcUpdated only checks type, payload shape, and chain; it does not validate sender or bucket`
- **#30** — Any malformed or future kind value from the backend becomes a crew_add card. This could mislabel a remove action as an add in the unified proposals feed, and the fallback is neither logged nor tested. Fix: Either narrow QuartermasterPendingActionDto.kind to 'add' \| 'remove' at the type level, or add a test that asserts an unrecognized kind is skipped rather than coerced to crew_add.
  - Evidence: `src/lib/governance/gov-process.ts:62 -- const kind: CrewPendingKind = row.kind === 'remove' ? 'crew_remove' : 'crew_add';`
  - Evidence: `src/lib/governance/api.ts:808 -- export interface QuartermasterPendingActionDto { kind: 'add' \| 'remove' \| string; ... }`

### P3 -- Low

| # | File | Issue | Reviewer | Confidence |
|---|------|-------|----------|------------|
| 31 | `src/components/parent/governance/GovProposalReadCard.svelte:1` | Obsolete GovProposalReadCard component remains after replacement | project-standards | 100 |
| 32 | `src/lib/governance/governance-privilege.ts:142` | New gateQuartermasterExecute returns hardcoded English disabled reason | project-standards | 100 |
| 33 | `src/lib/squad/squad-rpc-share.ts:61` | squad_rpc_updated parser ignores the version field | adversarial | 100 |
| 34 | `src/lib/squad/squad-rpc-share.ts:98` | squad-rpc-share.ts uses console.warn instead of project debug logger | project-standards | 100 |
| 35 | `src/lib/squad/squad-rpc.ts:30` | New SQUAD_RPC_PREFIX localStorage key bypasses persistenceKey helper | project-standards | 100 |
| 36 | `src/lib/squad/squad-state-sync.ts:257` | squad-state-sync.ts adds console.warn for RPC republish failure | project-standards | 100 |
| 37 | `src/lib/squad/squad-rpc.ts:255` | RPC URL deduplication is case-insensitive and may drop semantically distinct URLs | adversarial | 75 |

- **#31** — GovProposalsBoard.svelte now renders the unified board with the new GovProcessCard.svelte, and git grep finds no remaining imports of GovProposalReadCard. CLAUDE.md's greenfield posture says to delete obsolete paths rather than leave unused code. Keeping the old component adds maintenance surface and invites future drift. Fix: Delete src/components/parent/governance/GovProposalReadCard.svelte after confirming no dynamic imports, tests, or build tooling reference it.
  - Evidence: `src/components/parent/governance/GovProposalReadCard.svelte:1 -- `<script lang="ts">``
  - Evidence: `git grep found no remaining imports of GovProposalReadCard in src/ at refs/review/pr-head`
- **#32** — gateQuartermasterExecute returns English disabled reasons ('Quartermaster locked while mutiny is active.', 'Link a squad EVM address to sign.') that are shown to users as button/tooltip explanations. The project already internationalizes CTA gate reasons in other components, so new gates should follow the same pattern. Fix: Return catalog keys (e.g., reason: 'governance.gate.quartermasterMutinyLocked') and resolve them with $t() in the consuming component, or refactor the gate helpers to accept/return translated strings consistently.
  - Evidence: `src/lib/governance/governance-privilege.ts:142 -- `return { enabled: false, reason: 'Quartermaster locked while mutiny is active.' };``
  - Evidence: `src/lib/governance/governance-privilege.ts:147 -- `if (!p.myAddress) return { enabled: false, reason: 'Link a squad EVM address to sign.' };``
- **#33** — formatSquadRpcUpdated includes a version field, but parseSquadRpcUpdated never reads it. A future version of the payload with a different rpc slot shape will be misinterpreted by old clients, and old or replayed version-1 messages are indistinguishable from newer versions. This breaks forward compatibility and makes it harder to evolve the protocol safely. Fix: Reject payloads whose version is not SQUAD_RPC_UPDATED_VERSION before parsing the slots. Older clients will then ignore future versions instead of misapplying them.
  - Evidence: `src/lib/squad/squad-rpc-share.ts:34-35 -- formatSquadRpcUpdated includes version: SQUAD_RPC_UPDATED_VERSION`
  - Evidence: `src/lib/squad/squad-rpc-share.ts:47-72 -- parseSquadRpcUpdated checks root.type and payload fields but never reads root.version`
- **#34** — The project standard requires debug logging to use dmLog/dmError (and the module also exports dmWarn) from src/lib/utils/dm-debug.ts. Using console.warn directly bypasses the DEV guard and the [DM] prefix, making logs inconsistent with the rest of the app. Fix: Replace `console.warn('[squad-rpc] publish failed', e)` with `dmWarn('[squad-rpc] publish failed', e)`.
  - Evidence: `src/lib/squad/squad-rpc-share.ts:98 -- `console.warn('[squad-rpc] publish failed', e);``
- **#35** — CLAUDE.md requires any new localStorage key to be npub-scoped via persistenceKey(prefix). The new squad RPC module manually builds `${SQUAD_RPC_PREFIX}_${accountNpub}`, matching the existing squad-network.ts pattern but not the mandated helper. This makes the scoping convention inconsistent with the rest of the app. Fix: Use persistenceKey(SQUAD_RPC_PREFIX) for key generation (note it uses the current persisted npub) or introduce a persistenceKeyForNpub(prefix, npub) helper if callers must pass an explicit npub. Align squad-network.ts the same way.
  - Evidence: `src/lib/squad/squad-rpc.ts:30 -- `return '${SQUAD_RPC_PREFIX}_${accountNpub}';``
  - Evidence: `src/lib/squad/squad-rpc.ts:15 -- `export const SQUAD_RPC_PREFIX = 'pacto_squad_rpc_v1';``
- **#36** — The new RPC republish failure handler uses console.warn directly, violating the project's debug logging convention. Other republish failure paths in the same file also use console.warn, but this PR adds a new instance rather than moving to dmWarn. Fix: Replace the new console.warn with `dmWarn('[squad-state-sync] rpc republish failed', e)`.
  - Evidence: `src/lib/squad/squad-state-sync.ts:257 -- `console.warn('[squad-state-sync] rpc republish failed', e);``
- **#37** — resolveSquadRpcUrls and the backend sanitize_rpc_urls deduplicate by trimming and lowercasing the entire URL. Some RPC providers use case-sensitive API keys in query strings or paths. If a squad member pastes two URLs that differ only in case-sensitive key characters, the deduplication will silently drop one, potentially removing the intended backup endpoint. Fix: Dedupe by the exact URL string after trimming, or at most normalize the scheme and host case-insensitively while preserving the path and query string exactly.
  - Evidence: `src/lib/squad/squad-rpc.ts:255 -- const key = url.trim().toLowerCase(); if (!key \|\| seen.has(key)) continue;`
  - Evidence: `src-tauri/src/evm/gov_read.rs:14-30 -- sanitize_rpc_urls uses key = trimmed.to_lowercase(); and deduplicates with it`

### Actionable Findings

| # | File | Issue | Route | Notes |
|---|------|-------|-------|-------|
| 1 | `src-tauri/src/evm/gov_read.rs:12` | Unvalidated RPC URLs allow backend SSRF in Tauri commands | gated_auto -> downstream-resolver | validation-degraded (validator infrastructure failure); requires verification |
| 2 | `src-tauri/src/evm/access_control/evaluate.rs:205` | Capability preflight reads use attacker-controlled RPC override list | gated_auto -> downstream-resolver | validation-degraded (validator infrastructure failure); requires verification |
| 3 | `src-tauri/src/evm/quartermaster_ops.rs:224` | New list_quartermaster_pending Tauri command has no parent membership guard | gated_auto -> downstream-resolver | validation-degraded (validator infrastructure failure); requires verification |
| 4 | `src-tauri/src/evm/quartermaster_ops.rs:240` | N+1 RPC calls verify each QM candidate after log scan | manual -> downstream-resolver | validation-degraded (validator infrastructure failure); requires verification |
| 5 | `src-tauri/src/evm/rpc/logs.rs:31` | Quartermaster log scan fetches all contract events without topic filtering across a 200k-block default lookback | manual -> downstream-resolver | validation-degraded (validator infrastructure failure); requires verification |
| 6 | `src-tauri/src/evm/rpc/logs.rs:35` | Chunked eth_getLogs has no per-chunk timeout or inter-chunk delay | manual -> downstream-resolver | validation-degraded (validator infrastructure failure); requires verification |
| 7 | `src-tauri/src/evm/rpc/provider.rs:21` | RPC provider connection attempts have no timeout | manual -> downstream-resolver | validation-degraded (validator infrastructure failure); requires verification |
| 8 | `src/components/parent/dashboard/DashboardStatusTab.svelte:256` | Custom RPC URLs with embedded credentials are broadcast to all squad members | gated_auto -> downstream-resolver | validation-degraded (validator infrastructure failure); requires verification |
| 9 | `src/components/parent/governance/GovProposalsBoard.svelte:112` | Mutiny execute bypasses shared acting guard in board | manual -> downstream-resolver | validation-degraded (validator infrastructure failure); requires verification |
| 10 | `src/components/parent/governance/PactoGovGovernanceShell.svelte:139` | Capability snapshot uses default RPCs when squad RPC is configured | gated_auto -> downstream-resolver | validation-degraded (validator infrastructure failure); requires verification |
| 11 | `src/components/parent/dashboard/DashboardStatusTab.svelte:105` | Squad RPC edit UI does not await publish success and allows rapid overlapping MLS publishes | manual -> downstream-resolver | requires verification |
| 12 | `src/components/parent/dashboard/DashboardStatusTab.svelte:205` | New squad RPC UI in DashboardStatusTab uses hardcoded English labels | manual -> downstream-resolver | requires verification |
| 13 | `src/components/parent/governance/GovProcessCard.svelte:30` | New GovProcessCard component renders hardcoded English user-facing strings | manual -> downstream-resolver | requires verification |
| 14 | `src/components/parent/governance/GovProposalsBoard.svelte:90` | New Quartermaster toast and empty-state messages in GovProposalsBoard are hardcoded English | manual -> downstream-resolver | requires verification |
| 15 | `src/components/parent/ParentDashboard.svelte:184` | ParentDashboard.svelte grows past 1k lines with new squad RPC surface | manual -> downstream-resolver | requires verification |
| 16 | `src/lib/dashboard/parent-dashboard-loaders.ts:103` | Treasury vote-map loader is not wired to squad RPC failover | gated_auto -> downstream-resolver | requires verification |
| 17 | `src/lib/governance/api.ts:796` | QuartermasterPendingActionDto.kind is typed as string, losing discriminator safety | gated_auto -> downstream-resolver |  |
| 18 | `src/lib/governance/gov-process.ts:104` | gov-process.ts returns hardcoded English tool labels | manual -> downstream-resolver | requires verification |
| 19 | `src/lib/squad/squad-rpc.ts:157` | buildSquadInvokeRpcUrls falls back to stored chain and can carry stale URLs across network changes | manual -> downstream-resolver | requires verification |
| 20 | `src/lib/squad/squad-rpc.ts:169` | squad-rpc.ts returns hardcoded English user-facing labels and validation errors | manual -> downstream-resolver | requires verification |
| 21 | `src-tauri/src/evm/gov_read.rs:12` | RPC URL deduplication is duplicated across Rust and TypeScript | manual -> downstream-resolver | requires verification |
| 22 | `src-tauri/src/evm/gov_read.rs:33` | Write RPC fallback logic lives in the gov_read module | manual -> downstream-resolver | requires verification |
| 25 | `src/components/parent/governance/PactoGovGovernanceShell.svelte:248` | Async reloadQmPending can write state after unmount | manual -> downstream-resolver | requires verification |
| 26 | `src/components/parent/governance/PactoGovGovernanceShell.svelte:250` | Quartermaster pending loader stuck when module clears | gated_auto -> downstream-resolver | requires verification |
| 27 | `src/components/parent/governance/PactoGovGovernanceShell.svelte:264` | Refresh button spawns overlapping quartermaster log scans | manual -> downstream-resolver | requires verification |
| 28 | `src/components/parent/governance/TreasurySafeModulePanel.svelte:190` | removeSquadTrackedToken callers omit chain, leaving token-removal RPC on default providers | manual -> downstream-resolver | requires verification |
| 30 | `src/lib/governance/gov-process.ts:62` | gov-process silently defaults invalid qmPending kind to crew_add | manual -> downstream-resolver | requires verification |
| 31 | `src/components/parent/governance/GovProposalReadCard.svelte:1` | Obsolete GovProposalReadCard component remains after replacement | manual -> downstream-resolver | requires verification |
| 32 | `src/lib/governance/governance-privilege.ts:142` | New gateQuartermasterExecute returns hardcoded English disabled reason | manual -> downstream-resolver | requires verification |
| 34 | `src/lib/squad/squad-rpc-share.ts:98` | squad-rpc-share.ts uses console.warn instead of project debug logger | gated_auto -> downstream-resolver |  |
| 35 | `src/lib/squad/squad-rpc.ts:30` | New SQUAD_RPC_PREFIX localStorage key bypasses persistenceKey helper | manual -> downstream-resolver | requires verification |
| 36 | `src/lib/squad/squad-state-sync.ts:257` | squad-state-sync.ts adds console.warn for RPC republish failure | gated_auto -> downstream-resolver |  |

### Decision Gates / Advisory

| # | File | Issue | Route | Notes |
|---|------|-------|-------|-------|
| 23 | `src-tauri/src/evm/quartermaster_ops.rs:224` | Quartermaster pending log scan can surface stale executable actions after reorgs | manual -> human | Cross-check the pendingCrewAddAt/RemoveAt result against the next URL in the squad RPC failover list, or require a small confirmation depth before treating a log-derived pending action as executable. Alternatively, fetch the tip from the write provider and compare it to the log-scan provider before displaying the action. |
| 24 | `src-tauri/src/evm/rpc/logs.rs:14` | Quartermaster pending log scan uses a fixed lookback that misses old actions | manual -> human | Resolve the Quartermaster deployment block from the stored Pacto Gov deployment and pass it as from_block, or persist the last scanned block per parent and resume from there on subsequent loads. |
| 29 | `src/lib/app/mls-structured-refresh.ts:86` | MLS RPC update is applied without sender or bucket validation | manual -> human | Require the RPC update to come from a member with the captain hat or an explicit capability, and ensure it is only accepted when the message's virtual bucket is 'announcements'. Consider persisting the sender npub with the saved config so the UI can show who changed the RPC. |
| 33 | `src/lib/squad/squad-rpc-share.ts:61` | squad_rpc_updated parser ignores the version field | advisory -> downstream-resolver | Reject payloads whose version is not SQUAD_RPC_UPDATED_VERSION before parsing the slots. Older clients will then ignore future versions instead of misapplying them. |
| 37 | `src/lib/squad/squad-rpc.ts:255` | RPC URL deduplication is case-insensitive and may drop semantically distinct URLs | advisory -> downstream-resolver | Dedupe by the exact URL string after trimming, or at most normalize the scheme and host case-insensitively while preserving the path and query string exactly. |

### Pre-existing Issues

None identified in this review.

### Residual Risks

- Quartermaster log scan fetches all contract logs without topic filtering; on a busy contract this is slower and more RPC-heavy than necessary.
- mutinyMode in PactoGovGovernanceShell can briefly be false while mutinyStatus is still loading, so the QM execute gate may be momentarily enabled during an active mutiny.
- reloadQmPending has no cache or in-flight deduplication, so rapid refreshes can spawn overlapping 200k-block log scans.
- sanitize_rpc_urls lowercases URLs for deduplication, which could collapse case-sensitive RPC paths that are semantically distinct.
- No integration test exercises the full RPC-1 → RPC-2 → Settings default failover path end-to-end.
- The PR introduces many new user-facing English strings across components and utility functions. Fixing them consistently requires adding keys to both en and es locale files and ensuring dynamic interpolation works for values like proposal IDs, addresses, and counts.
- squad-network.ts already uses manual `${prefix}_${npub}` storage keys instead of persistenceKey. Aligning squad-rpc.ts (and squad-network.ts) with the mandated helper may require a small storage migration if existing persisted state must be preserved.
- src/lib/messaging/structured-content-notice.ts adds a hardcoded English notice for squad_rpc_updated, continuing the file's existing i18n-noncompliant pattern.
- The RPC failover wiring depends on the currentUser Svelte store and localStorage; many wrapper tests do not stub these, so the actual rpcUrls values are environment-dependent and the tests pass vacuously.
- The unified proposals feed UI components (GovProposalsBoard.svelte and GovProcessCard.svelte) are not covered by any automated tests; regressions in execute gating, card rendering, or mutiny/quartermaster display will only be caught manually.
- The Rust provider failover behavior (connect_gov_read_provider retrying the URL list) is not exercised; only the sanitize and override-selection helpers are unit tested.
- The new gateQuartermasterExecute privilege path is added but not tested in governance-privilege.test.ts, so mutiny-mode locking of quartermaster execute could regress silently.
- The DEFAULT_LOG_LOOKBACK_BLOCKS = 200,000 constant in list_quartermaster_pending may miss pending crew actions on long-lived chains where the Quartermaster was deployed earlier than the lookback window.
- RPC log pruning by squad-chosen providers can cause list_quartermaster_pending to miss lifecycle events and return an inconsistent pending set.
- effectiveSquadRpcConfig returns non-persisted create-squad defaults; a member on a new device or after localStorage clear may use a different default RPC until the squad_rpc_updated announcement is received.
- The new rpcUrls parameter is threaded through many command signatures; any future call site that forgets to pass it will silently fall back to operator defaults, fragmenting the failover path.
- Even with scheme validation, SSRF to internal HTTP services on the user's machine or local network remains possible; a robust fix would use an explicit allowlist or restrict the local chain to localhost only.
- Any squad member can set a shared primary RPC that logs all squad read traffic or returns false state, creating a trust dependency that the UI warning alone cannot mitigate.
- The local Settings default RPC is never shared via MLS, but it is still passed to the backend as a fallback; a compromised account or local script can use it to exfiltrate transaction or signed-transaction data.
- MLS membership proves group membership but not device trust; a compromised member account can push arbitrary RPC URLs to the rest of the squad.
- RPC failover in connect_read_provider is sequential and has no per-URL timeout; long squad RPC lists plus a slow primary can extend governance command latency before falling back to a working URL.
- collect_qm_pending_candidates_from_logs tries to decode every fetched log against six event types because no topic filter is applied; this is secondary to the log-volume issue but adds decode overhead per returned log.
- The get_logs_chunked chunks are awaited sequentially, so a 200k-block scan incurs 100 sequential RPC round-trips even though the chunks are independent.
- Custom squad RPC URLs (including any embedded API keys) are announced over MLS #announcements to all current members; this is intentional and documented, but it makes the squad RPC credentials as confidential as the group itself.
- sanitize_rpc_urls in src-tauri/src/evm/gov_read.rs deduplicates case-insensitively on the full URL string, which can collapse two distinct RPC endpoints whose paths differ only in case.
- list_quartermaster_pending sorts executable_at as a decimal string lexicographically; this is numerically equivalent only while all values share the same digit count (true until ~2286).
- Any squad member can publish a custom RPC URL via MLS with no sender verification; a malicious or broken URL can be propagated to all members and become the primary endpoint, causing a shared outage or enabling phishing.
- The 200,000-block default lookback may exceed the history window of some public RPC providers, causing list_quartermaster_pending to fail on those nodes even when the chain has the events.
- There is no observability into RPC failover decisions (which URL succeeded, which failed, latency), so operators cannot diagnose why a squad governance command hangs or falls back to a public node.
- get_logs_chunked does not specifically handle HTTP 429 rate-limit responses with exponential backoff; it surfaces the error as a generic GET_LOGS failure, which may hide transient rate-limiting from users.
- The unified proposals board mixes treasury, mutiny, and quartermaster actions under the same 'Execute' button; a confused user could click the wrong card, although the backend capability check should reject an unauthorized action.
- A malicious squad member who sets the squad RPC can observe traffic from other members or cause reads/writes to go to a malicious endpoint, because the frontend builds the RPC override list and the backend does not validate the URLs against an allowlist.
- The fixed 2000-block chunk size for eth_getLogs over 200,000 blocks means up to 100 sequential RPC calls per load; a slow or rate-limited provider can make the pending-crew list appear to hang.
- RPC failover ordering may be surprising: a custom backup slot is only tried after the primary slot's full default_public expansion (operator + curated public URLs), which is documented but easy to miss when debugging a failing primary.
- Only prior review comment is a non-actionable Copilot failure message ('Copilot encountered an error and was unable to review this pull request. You can try again by re-requesting a review.'); no explicit requested changes are outstanding.
- Concurrent `reloadMutiny`, `reloadQm`, and `reloadQmPending` calls in `refreshAllProposals` can briefly show inconsistent board state if the parent treasury proposals refresh completes at a different time than the module reads.
- The `mutinyMode` prop is derived from two independently-loading sources (`qmStatus` and `mutinyStatus`) and may briefly enable or disable Quartermaster execute CTAs while one source is stale.
- MLS-applied `applySquadRpcUpdated` can overwrite local RPC edits if a peer publishes while the current user is typing an RPC URL.
- Mutiny refresh can leave the loading spinner off while a stale cache is refreshed

### Testing Gaps

- expect.any(Array) assertions for rpcUrls provide false confidence
- squad-rpc-invoke.ts has no test coverage
- list_quartermaster_pending async command lacks integration test
- squad-rpc-share publish and apply behavior not tested
- expandSquadRpcSlot default_public path is untested
- buildSquadInvokeRpcUrls misses dual-RPC failover ordering cases
- squad_rpc_updated MLS sync paths are not exercised
- new logs.rs chunked helpers have no tests
- sanitize_rpc_urls edge-case branches are untested

### Coverage

- Reviewers: 11 personas dispatched; all returned usable artifacts.
- Cross-model adversarial pass: skipped because scope is `pr-remote` (the peer reviews the local working tree, which is not the PR head). The local `adversarial-reviewer` covered the lens.
- Validation: attempted a single batch for all 10 P0/P1 findings; the validator subagent failed with a billing-cycle usage limit. All P0/P1 findings are kept as **validation-degraded**.
- Suppressed: 0 primary findings suppressed after merge/demotion (one deeply-nested-ternary P3 was moved to residual_risks).
- Testing-only coverage findings: moved 9 items to Testing Gaps.
- Residual risks: 39 observations noted.

---

> **Verdict:** Not ready
>
> **Reasoning:** One P0 SSRF vulnerability and 9 P1 high-impact issues must be fixed before merge. Additional 20 P2 and 7 P3 items remain for follow-up.
>
> **Fix order:**
> 1. P0 SSRF — validate RPC URL scheme/host in `src-tauri/src/evm/gov_read.rs` (#1)
> 2. P1 security — guard `list_quartermaster_pending` with parent membership (#3), strip credentials from shared squad RPC payload (#8), and use trusted RPCs for capability checks (#2)
> 3. P1 capability/timeout wiring — pass network to `getSquadCapabilities` (#10), add provider and log-scan timeouts (#6, #7)
> 4. P1 proposals board races — add mutiny acting guard (#9) and await RPC publish success (#11)
> 5. P1 performance — topic-filter and bound the Quartermaster log scan (#5), batch pending*At verification (#4)
> 6. P2/P3 — address type safety, i18n, remove tracked-token chain arg, and structural refactors