# RPC issue index (pacto-app)

Tracker map for **EVM JSON-RPC**: errors, 429s, custom/public URLs, Alchemy vs chain RPC, and bundler JSON-RPC.

Normative behavior: [RPC_AND_VIEM_ARCHITECTURE.md](./RPC_AND_VIEM_ARCHITECTURE.md). UserOp fees and bundler hops: [SPONSORED_USEROP_7702.md](./SPONSORED_USEROP_7702.md). GitHub remains source of truth — this file is a snapshot of [covenant-gov/pacto-app issues](https://github.com/covenant-gov/pacto-app/issues) as of 2026-11-05 (209 issues scanned).

## Open — chain RPC errors, rate limits, setting RPCs

| Issue | Topic |
|-------|--------|
| [#489](https://github.com/covenant-gov/pacto-app/issues/489) | Live mutiny vote: Alloy `HTTP error 429 with empty body` on a chain JSON-RPC hop (not Pimlico). Status often shows the public-RPC rate-limit card; check whether vote `rpc_urls` / failover still hits Alchemy CUPS, a shared key, or a public fallback. |
| [#320](https://github.com/covenant-gov/pacto-app/issues/320) | Crew Hats / Privileges should use the squad custom RPC. Saving that RPC does not refetch, so a public-node 429 can stick. Partial: PR [#341](https://github.com/covenant-gov/pacto-app/pull/341). Remaining: refetch on `$squadRpcTick`, point rate-limit copy at Settings, surface Hats RPC errors on Crew. |
| [#228](https://github.com/covenant-gov/pacto-app/issues/228) | Squads publish custom RPC URLs over MLS (`squad_rpc_updated`). Alchemy-style `/v2/<key>` URLs leak credentials to every member. Warn or block before share. |

## Open — adjacent

| Issue | RPC angle |
|-------|-----------|
| [#465](https://github.com/covenant-gov/pacto-app/issues/465) | Operator sponsorship-deposit guide. Mentions RPC/bundler only as UserOp settlement context. |

## Closed — RPC sessions, Settings editor, local chain

| Issue | Topic |
|-------|--------|
| [#340](https://github.com/covenant-gov/pacto-app/issues/340) | Superseded by [pacto-onchain-orchestrator](https://github.com/covenant-gov/pacto-onchain-orchestrator): Foundry unit/fork CI and `MAINNET_RPC` live there, not in pacto-app. |
| [#495](https://github.com/covenant-gov/pacto-app/issues/495) | Username holder refresh: one read provider. RPC failure keeps the last SQLite record (`chain_error`) instead of flipping username state to `error`. |
| [#276](https://github.com/covenant-gov/pacto-app/issues/276) | Settings tab hosts Chain RPC, Pimlico key, `focusSquadSettingsRpcEditor`, `RpcReadErrorCard`, `SquadEndpointsPanel`. |
| [#40](https://github.com/covenant-gov/pacto-app/issues/40) | Wallet Local Anvil at `http://localhost:8545`. Public testnets called out as slow and rate-limited. See [PACTO-APP-LOCAL-CHAIN-SETUP.md](./PACTO-APP-LOCAL-CHAIN-SETUP.md). |
| [#93](https://github.com/covenant-gov/pacto-app/issues/93) | Operator bundler JSON-RPC (`BUNDLER_RPC_URL`), Alchemy vs dedicated bundler app, `eth_sendUserOperation`. |
| [#90](https://github.com/covenant-gov/pacto-app/issues/90) | `evm/` layout refactor, including `wallet_rpc_providers.rs` and `evm/rpc/`. |

## Closed — Alchemy vs Pimlico (bundler JSON-RPC)

Do not restate policy here. Read [SPONSORED_USEROP_7702.md](./SPONSORED_USEROP_7702.md) and [factory-userop-gas-policy.md](../solutions/wallet/factory-userop-gas-policy.md).

| Issue | RPC angle |
|-------|-----------|
| [#455](https://github.com/covenant-gov/pacto-app/issues/455) | Factory UserOp 16M cap. Pimlico estimate/send; Alchemy is not the 4337 fee path. |
| [#452](https://github.com/covenant-gov/pacto-app/issues/452) | BundlerPolicy JSON. Alchemy/public RPC for `eth_call` / balances / receipts only. |
| [#453](https://github.com/covenant-gov/pacto-app/issues/453) | One `evm/userop/` pipeline. Same Pimlico vs Alchemy split. |
| [#454](https://github.com/covenant-gov/pacto-app/issues/454) | Normative 7702 doc + Cursor rule: do not put Alchemy on the 4337 fee path. |
| [#87](https://github.com/covenant-gov/pacto-app/issues/87) | Sponsored gov writes via bundler/UserOp. |
| [#173](https://github.com/covenant-gov/pacto-app/issues/173) | Tor setting: outbound list includes Alloy chain RPC and bundler JSON-RPC. See [TOR_TRANSPORT.md](../privacy/TOR_TRANSPORT.md). |
| [#292](https://github.com/covenant-gov/pacto-app/issues/292) | War-game always uses Sepolia RPCs even if the squad network is not Sepolia. |
| [#377](https://github.com/covenant-gov/pacto-app/issues/377) | Username NFT pin: Pimlico `eth_estimateUserOperationGas` vs L1 `eth_call`. |
| [#316](https://github.com/covenant-gov/pacto-app/issues/316) | War-game sponsor unmix epic; child [#320](https://github.com/covenant-gov/pacto-app/issues/320) is the custom-RPC Hats work. |
| [#122](https://github.com/covenant-gov/pacto-app/issues/122) | Sponsor factory address-book cutover; operator Alchemy/bundler notes. |

## Mention-only (not chain RPC product work)

Keyword hits that are **not** RPC config, 429s, or endpoint selection:

- [#102](https://github.com/covenant-gov/pacto-app/issues/102) — “RPCs are shared truth” vs Nostr gossip ingest.
- [#257](https://github.com/covenant-gov/pacto-app/issues/257) — roster copy; [#228](https://github.com/covenant-gov/pacto-app/issues/228) called out of scope.
- [#319](https://github.com/covenant-gov/pacto-app/issues/319) — `eth_call` replay to decode Mutiny revert selectors.
- [#210](https://github.com/covenant-gov/pacto-app/issues/210) — Commons join-request rate limit (Nostr).
- [#200](https://github.com/covenant-gov/pacto-app/issues/200) — GIF provider URL / `ALCHEMY_*` env prefix.
- [#112](https://github.com/covenant-gov/pacto-app/issues/112) — PIN verification rate-limiting.
- [#463](https://github.com/covenant-gov/pacto-app/issues/463) / [#458](https://github.com/covenant-gov/pacto-app/issues/458) — MLS history failover.
- [#286](https://github.com/covenant-gov/pacto-app/issues/286) — GitHub → GitLab failover.
