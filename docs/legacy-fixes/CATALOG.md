# Legacy fixes — removal catalog

Review before **public v1**. Remove from code when alpha/dev cohort no longer needs the path.

| ID | Summary | Code / entry points | Note |
|----|---------|---------------------|------|
| LF-002 | WalletBar **Tokens** dropdown prefs in localStorage (`pacto_wallet_bar_token_filter` / older JSON visibility); migrate to `pacto_wallet_watched_erc20_v1_*` | `legacyModeToRows`; `loadWatchedErc20Rows` in `watched-tokens.ts` | [LF-002-wallet-bar-token-filter-migration.md](./LF-002-wallet-bar-token-filter-migration.md) |
| LF-001 | Wrong EVM `evm_address` stored (hashed `0x04` prefix); auto-repair from decrypted EVM key | `db::repair_evm_address_if_needed`; `db::get_evm_address`; `get_wallet_summary` | [LF-001-evm-address-repair.md](./LF-001-evm-address-repair.md) |

_Add new rows above this line._
