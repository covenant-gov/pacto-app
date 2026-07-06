# Wiring the local Docker dev stack into pacto-app

This guide explains how to use the `local` Anvil chain (chain ID `31337`) with the `pacto-dev-env` Docker stack. `local` is a **normal opt-in network available in every build** — you enable and configure it like Sepolia or Arbitrum. The sections below cover the two supported dev workflows, the one dev-only convenience, manual setup, and contract deployment.

## Two supported dev workflows

Both are first-class and do **not** conflict. They differ only in how the frontend is built and which chains are **auto-checked** on a fresh account. Everything else — network availability, the pickers, RPC settings, and the DM-wallet UX — is identical.

| | A. Live relays + Sepolia | B. Docker stack + Anvil |
|---|---|---|
| Typically run with | `pnpm tauri:dev` | production build (`pnpm build` / `pnpm tauri:build`), or `pnpm tauri:dev` |
| `import.meta.env.DEV` | `true` | `false` for a production build; `true` under `tauri:dev` |
| Nostr transport | real/public relays you add | local relay `ws://localhost:7000` |
| Chain under test | Sepolia (plus mainnet/Arbitrum as needed) | Local Anvil `http://localhost:8545` (chain `31337`) |
| Fresh-account enabled chains | **dev:** Sepolia + Local Anvil auto-checked | **prod build:** Arbitrum only → enable Local Anvil manually |
| Needs the `pacto-dev-env` Docker stack | no | yes |

Why they don't collide: **Local Anvil is opt-in in every build and never force-enabled.** If a network's RPC is unreachable, only that row degrades — the DM/Wallet summary shows "Anvil not detected" (or "Couldn't reach {Network}") for it and still loads every other enabled chain. So workflow A can leave Local Anvil auto-checked without a stopped Anvil node breaking Sepolia balances, and workflow B can run Anvil without affecting anyone testing on live relays.

> Note: the wallet panels only work inside the Tauri shell (the `invoke` calls are gated on `isTauri()`). A browser-only `pnpm dev` still exercises relays/UI but won't show on-chain balances.

## The one dev-only convenience: local relay auto-add

In **Vite dev builds** (`import.meta.env.DEV`), the app adds `ws://localhost:7000` as a custom Nostr relay to a newly unlocked account if it is missing — a convenience for workflow B. It does **not** auto-enable the `local` chain or set its RPC; those are manual, opt-in steps (see §3). Existing user changes are never overwritten; the applied marker lives in `sessionStorage` and resets on restart. Source: `src/lib/dev/local-dev-setup.ts`, wired from account create / import / unlock in `src/stores/auth.ts`. If the relay is not running at unlock, it logs a warning and continues.

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

- Nostr relay on `ws://localhost:7000`
- Anvil EVM testnet on `http://localhost:8545`

Verify both endpoints respond:

```bash
curl -s http://localhost:8545 -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
curl -s http://localhost:7000 | head -5
```

## 2. Add the local relay

In the app:

1. Open **Settings** from the navbar tab labeled **Settings**.
2. In the left sidebar, click **Nostr**.
3. Under **Add custom relay**:
   - **Relay URL**: `ws://localhost:7000`
   - **Mode**: `Read & write`
4. Click **Add**.
5. Confirm `ws://localhost:7000` appears under **Connected relays**.

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

This key derives address `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`, which holds 10,000 ETH on a fresh Anvil node. You will use the same key to deploy the pacto-gov contracts in the next step.

## 5. Deploy pacto-gov contracts locally

The app reads Pacto contract addresses from `src/lib/evm/pacto-protocol-addresses.json` at compile time. For the local network those addresses do not exist yet, so you must deploy the contracts and supply the addresses.

From the `pacto-gov` repo:

```bash
cd ~/src/covenant-gov/pacto-gov
forge install
forge build
forge script Deploy --rpc-url http://localhost:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast --chain 31337 -vvvvv
```

After broadcast, Foundry writes the deployment artifact to:

```text
pacto-gov/deployments/31337/full-system.json
```

Copy the addresses into pacto-app’s `src/lib/evm/pacto-protocol-addresses.json` under a new `"local"` network block. The required fields are:

```json
{
  "networks": {
    "local": {
      "chainId": 31337,
      "meta": {
        "deployer": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
      },
      "pactoGov": {
        "navePirataFactory": "<full-system.json navePirataFactory>",
        "navePirataRegistry": "<full-system.json navePirataRegistry>",
        "masterQuartermaster": "<full-system.json masterQuartermaster>",
        "masterMutiny": "<full-system.json masterMutinyModule>",
        "masterTreasuryAuthority": "<full-system.json masterTreasuryAuthority>",
        "masterSquadAdminImpl": "<full-system.json masterSquadAdminImpl>",
        "masterSquadAdminExtImpl": "<full-system.json masterSquadAdminExtImpl>",
        "hats": "<full-system.json hats>",
        "roleHatClonesFactory": "<full-system.json roleHatClonesFactory>",
        "roleHatUpgrader": "<full-system.json roleHatUpgrader>"
      },
      "safe": {
        "proxyFactory": "<full-system.json safeProxyFactory>",
        "singleton": "<full-system.json safeSingleton>",
        "fallbackHandler": "0x017062a1dE2FE6b99BE3d9d37841FeD19F573804"
      }
    }
  }
}
```

For `squadSponsor`, either omit the block if you are not testing sponsorship locally, or deploy `pacto-squad-sponsor` and fill in `factory`, `paymaster`, `entryPoint`, and `navePirataRegistry`.

### Alternative: env overrides for quick experiments

Instead of editing `pacto-protocol-addresses.json`, you can export env vars before running the Tauri app:

```bash
export PACTO_NAVE_PIRATA_FACTORY=0x...
export PACTO_NAV_MASTER_QUARTERMASTER=0x...
export PACTO_NAV_MASTER_MUTINY=0x...
export PACTO_NAV_MASTER_TREASURY_AUTHORITY=0x...
export PACTO_NAV_MASTER_SQUAD_ADMIN=0x...
export PACTO_NAV_MASTER_SQUAD_ADMIN_EXT=0x...
export PACTO_HATS=0x...
export PACTO_ROLE_HAT_CLONES_FACTORY=0x...
export PACTO_ROLE_HAT_UPGRADER=0x...
export PACTO_NAVE_PIRATA_REGISTRY=0x...
```

The Rust backend resolves these at runtime. They are useful for one-off testing, but the JSON change is required for anyone else using the same build.

## 6. Rebuild and verify

After editing `pacto-protocol-addresses.json`:

```bash
cd ~/src/covenant-gov/pacto-app
pnpm check
```

Then run the app and test:

- **Settings → Nostr**: `ws://localhost:7000` is connected.
- **Settings → EVM → RPC endpoints**: **Local Anvil** defaults to `http://localhost:8545`.
- **Settings → EVM → EVM accounts**: the imported Anvil account shows a balance.
- Create or open a squad and deploy a Nave Pirata treasury; the factory call should land on the local Anvil node.

## Security warnings

- The private key `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` is public. **Use it only on a local Anvil node.** Never import it into a mainnet wallet, commit it, or share it.
- `ws://localhost:7000` and `http://localhost:8545` are unencrypted local endpoints. Do not expose them to a network.
- Do not commit your local `pacto-protocol-addresses.json` changes unless the project explicitly asks for them; local contract addresses are not portable across Anvil restarts.
- When Anvil restarts, all state resets. You must redeploy the contracts and update the addresses again.

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
