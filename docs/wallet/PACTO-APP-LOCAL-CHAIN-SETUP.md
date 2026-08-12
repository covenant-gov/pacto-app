# Wiring the local Docker dev stack into pacto-app

This guide explains how to use the `local` Anvil chain (chain ID `31337`) with the `pacto-dev-env` Docker stack. `local` is a **normal opt-in network available in every build** — you enable and configure it like Sepolia or Arbitrum. The sections below cover the two supported dev workflows, the one dev-only convenience, manual setup, and contract deployment.

## Two supported dev workflows

Both are first-class and do **not** conflict. They differ only in how the frontend is built and which chains are **auto-checked** on a fresh account. Everything else — network availability, the pickers, RPC settings, and the DM-wallet UX — is identical.

| | A. Live relays + Sepolia | B. Docker stack + Anvil |
|---|---|---|
| Typically run with | `pnpm tauri:dev` | production build (`pnpm build` / `pnpm tauri:build`), or `pnpm tauri:dev` |
| `import.meta.env.DEV` | `true` | `false` for a production build; `true` under `tauri:dev` |
| Nostr transport | real/public relays you add | local relay `wss://localhost:7001` (Caddy TLS) |
| Chain under test | Sepolia (plus mainnet/Arbitrum as needed) | Local Anvil `http://localhost:8545` (chain `31337`) |
| Fresh-account enabled chains | **dev:** Sepolia + Local Anvil auto-checked | **prod build:** Arbitrum only → enable Local Anvil manually |
| Needs the `pacto-dev-env` Docker stack | no | yes |

Why they don't collide: **Local Anvil is opt-in in every build and never force-enabled.** If a network's RPC is unreachable, only that row degrades — the DM/Wallet summary shows "Anvil not detected" (or "Couldn't reach {Network}") for it and still loads every other enabled chain. So workflow A can leave Local Anvil auto-checked without a stopped Anvil node breaking Sepolia balances, and workflow B can run Anvil without affecting anyone testing on live relays.

> Note: the wallet panels only work inside the Tauri shell (the `invoke` calls are gated on `isTauri()`). A browser-only `pnpm dev` still exercises relays/UI but won't show on-chain balances.

## The one dev-only convenience: local relay auto-add

In **Vite dev builds** (`import.meta.env.DEV`), the app adds `wss://localhost:7001` as a custom Nostr relay to a newly unlocked account if it is missing — a convenience for workflow B. It does **not** auto-enable the `local` chain or set its RPC; those are manual, opt-in steps (see §3). Existing user changes are never overwritten; the applied marker lives in `sessionStorage` and resets on restart. Source: `src/lib/dev/local-dev-setup.ts`, wired from account create / import / unlock in `src/stores/auth.ts`. If the relay is not running at unlock, it logs a warning and continues.

## How `local` behaves across builds

`Local Anvil` is a normal network in **both** dev and production builds — it appears in the network picker and RPC settings everywhere, and reaches `http://localhost:8545` by default via the curated RPC catalog (`src/lib/wallet/rpc-catalog.ts`). The only dev/prod difference is the default **Enabled chains** set on a fresh account (`defaultWalletEnabledChains()` in `src/lib/wallet/wallet-ui-prefs.ts`): **dev** auto-checks `sepolia` + `local`; **production** auto-checks `arbitrum` only. Users can toggle any chain on or off afterward in either build. The backend `get_wallet_summary` only queries the chains the user has enabled and returns a per-network error instead of failing the whole summary when one RPC is down.


## 1. Start the local services

From the `pacto-app` repo (or wherever `dev-setup` lives):

```bash
cd dev-setup
mkdir -p data/relay
docker compose up -d --build
```

This starts:

- Nostr relay on `wss://localhost:7001` (Caddy TLS)
- Anvil EVM testnet on `http://localhost:8545`

The relay is TLS-only: trust Caddy's local development CA once per machine
before the app will connect —

```bash
caddy trust
```

Verify both endpoints respond:

```bash
curl -s http://localhost:8545 -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
curl -s https://localhost:7001 | head -5
```

## 2. Add the local relay

In the app:

1. Open **Settings** from the navbar tab labeled **Settings**.
2. In the left sidebar, click **Nostr**.
3. Under **Add custom relay**:
   - **Relay URL**: `wss://localhost:7001`
   - **Mode**: `Read & write`
4. Click **Add**.
5. Confirm `wss://localhost:7001` appears under **Connected relays**.

> If the relay is not running when the app starts, messages and profile sync will fail. Start the Docker stack first.

## 3. Enable the local EVM network and set its RPC

Still in **Settings**:

1. In the left sidebar, click **EVM**.
2. Under **Enabled chains**, toggle **Local Anvil** on. Keep at least one other chain on if you want to leave the local network later.
3. Under **RPC endpoints**:
   - **Network** dropdown: select **Local Anvil**.
   - Under **Add RPC**, paste `http://localhost:8545` and click **Add**.
   - Under **Default RPC**, select `http://localhost:8545` from the dropdown.

The app now uses chain ID `31337` and the local RPC for balances, reads, and on-chain actions.

## 4. Import the default Anvil test key

Anvil ships with deterministic, funded accounts. In **Settings → EVM**:

1. Under **EVM accounts**, click **Import private key**.
2. Paste account #0’s private key:

   ```text
   0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
   ```

3. The app imports it as an **Advanced account**. You can use it to send local ETH and to sign direct contract interactions; squad treasury flows still use the derived squad signer.

This key derives address `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`, which holds 10,000 ETH on a fresh Anvil node.

## 5. Deploy contracts and import their addresses automatically

`pacto-gov` contracts are deployed by the `pacto-dev-env` Docker stack's seeding step, not by hand. From the sibling `pacto-dev-env` checkout:

```bash
cd ~/Projects/pacto-dev-env
make seed
```

This deploys the contracts to the local Anvil node and writes the deployment artifact to `data/deployments/31337/full-system.json`.

`make dev-world` (run from either `pacto-app` or `pacto-dev-env`) runs this seed step and launches the app with the artifact's addresses already applied — no manual step is needed for the common case.

To wire the addresses into a dev build you are launching yourself, `eval` the sibling's export lines before starting the app:

```bash
eval "$(cd ~/Projects/pacto-dev-env && make world-env)"
cd ~/src/covenant-gov/pacto-app
make dev-sandbox   # or: pnpm tauri dev -f local-relay-tls
```

`make world-env` reads the deployment artifact and prints one `export` per contract address, each carrying a `_LOCAL` suffix (e.g. `PACTO_NAVE_PIRATA_FACTORY_LOCAL`). The backend's address resolver checks the suffixed override before falling back to the compiled address book, so these variables apply only to the `local` network and never affect Sepolia or mainnet. Nothing needs to be copied into `pacto-protocol-addresses.json`.

If the artifact is missing or its chain id doesn't match the chain you're pointed at, the backend refuses at startup naming what it expected instead of silently resolving to the compiled addresses or a zero address.

## 6. Verify

The exported addresses take effect on the next app launch — no rebuild or manual edit is required. Run the app and test:

- **Settings → Nostr**: `wss://localhost:7001` is connected.
- **Settings → EVM → RPC endpoints**: **Local Anvil** defaults to `http://localhost:8545`.
- **Settings → EVM → EVM accounts**: the imported Anvil account shows a balance.
- Create or open a squad and deploy a Nave Pirata treasury; the factory call should land on the local Anvil node.

## Security warnings

- The private key `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` is public. **Use it only on a local Anvil node.** Never import it into a mainnet wallet, commit it, or share it.
- `http://localhost:8545` is an unencrypted local endpoint; `wss://localhost:7001` is TLS via Caddy's local dev CA (trusted once with `caddy trust`). Do not expose either to a network.
- When Anvil restarts, all state resets. Re-run `make seed` (or `make dev-world`) from `pacto-dev-env` to redeploy the contracts; the next `world-env` eval (or `dev-world` run) picks up the refreshed addresses automatically.

## Files to review when changing local behavior

- `src/lib/dev/local-dev-setup.ts` — dev auto-wiring
- `src/lib/wallet/chains.ts` — frontend chain config (canonical `local` key; see `docs/CHAIN_TERMINOLOGY.md`)
- `src/lib/wallet/assets.ts` — chain groups and asset metadata
- `src/lib/wallet/wallet-ui-prefs.ts` — enabled-chains list
- `src/lib/wallet/rpc-prefs.ts` — RPC preferences
- `src/lib/wallet/rpc-catalog.ts` — curated RPC defaults
- `src/lib/wallet/dm-messages.ts` — DM wallet message network parsing
- `src/lib/wallet/wallet-assets.json` — asset table
- `src-tauri/src/evm/wallet_chain_config.rs` — backend network table
- `src-tauri/src/lib.rs` — relay URL validator
- `src/lib/evm/pacto-protocol-addresses.json` — local contract addresses
