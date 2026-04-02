# Aztec Key Derivation Research

**Date**: 2026-04-02  
**Task**: Phase 0 - Same-Seed Feasibility Investigation  
**Target**: Aztec Testnet v4.1.0-rc.2

---

## Executive Summary

**Conclusion**: The same BIP-39 seed phrase CAN be used for both EVM and Aztec wallets, but with a modified approach:

1. **EVM**: Derive secp256k1 private key via BIP-44 (`m/44'/60'/0'/0/i`) — existing implementation
2. **Aztec Signing**: Use the SAME secp256k1 private key for `EcdsaKAccountContract` — same curve, compatible
3. **Aztec Privacy Keys**: Derive a separate Grumpkin scalar (`Fq`) from the mnemonic for privacy keys

The Aztec address will be **different** from the EVM address, but users only need ONE recovery phrase.

---

## Aztec Key Architecture

### Multiple Key Types

Aztec accounts use **5 different keys**:

| Key Type | Curve | Purpose | Rotatable |
|----------|-------|---------|-----------|
| Nullifier Key (Npk_m) | Grumpkin | Spending notes | No |
| Incoming Viewing (Ivpk) | Grumpkin | Decrypting received notes | No |
| Outgoing Viewing (Ovpk) | Grumpkin | Reserved (future) | No |
| Tagging (Tpk) | Grumpkin | Reserved (future) | No |
| **Signing (Tpk_m)** | **secp256k1 or Grumpkin** | Transaction authorization | **Yes** |

### Account Contract Types

Aztec provides different account contracts with different signature schemes:

| Contract | Curve | Signature | Constructor |
|----------|-------|-----------|-------------|
| `SchnorrAccountContract` | Grumpkin | Schnorr | `signingPrivateKey: Fq` |
| `EcdsaKAccountContract` | secp256k1 | ECDSA | `signingPrivateKey: Buffer` |
| `EcdsaRAccountContract` | secp256r1 (P-256) | ECDSA | `signingPrivateKey: Buffer` |

**Key insight**: `EcdsaKAccountContract` uses **secp256k1** — the **same curve as Ethereum**!

---

## Technical Feasibility Analysis

### Option A: Shared Signing Key (RECOMMENDED)

Use the same secp256k1 private key for both EVM and Aztec.

**How it works**:

```typescript
// 1. Derive EVM private key from mnemonic (existing BIP-44)
const evmPrivateKey = deriveEthBip44V1(mnemonic, index); // 32 bytes

// 2. Use same key for Aztec ECDSA account
const ecdsaAccount = new EcdsaKAccountContract(
  Buffer.from(evmPrivateKey.slice(2), 'hex') // Remove '0x' prefix
);

// 3. Derive Aztec privacy keys from separate derivation path
const aztecSecret = deriveAztecPrivacySecret(mnemonic, index); // Fq (Grumpkin scalar)

// 4. Create account manager with both
const accountManager = AccountManager.create(
  wallet,           // PXE connection
  aztecSecret,      // Fr for privacy keys
  ecdsaAccount,     // ECDSA signing key
  salt
);
```

**Feasibility**: ✅ **CONFIRMED**
- `EcdsaKAccountContract` accepts a `Buffer` of 32 bytes
- secp256k1 signature verification is identical for EVM and Aztec
- Privacy keys are derived separately from the secret key

**Limitation**: Aztec address ≠ EVM address (different derivation)

### Option B: Unified Scalar (More Complex)

Try to use a single scalar for both curves.

**Challenge**: 
- EVM uses secp256k1 curve
- Aztec privacy keys use Grumpkin curve
- These are different curves with different generators
- A single scalar cannot directly derive the same keys on both curves

**Verdict**: ❌ Not feasible without custom crypto implementation

---

## Proposed Derivation Scheme

### BIP-39 Seed → Multiple Keys

```
BIP-39 Mnemonic
       │
       ▼
┌──────────────────┐
│  BIP-39 Seed     │
│  (64 bytes)      │
└──────────────────┘
       │
       ├──────────────────────┐
       ▼                      ▼
┌──────────────────┐   ┌──────────────────┐
│  EVM Derivation  │   │  Aztec Derivation │
│  Path: m/44'/60'│   │  Path: TBD        │
│  '/0'/0/{i}     │   │  (separate path)  │
└──────────────────┘   └──────────────────┘
       │                      │
       ▼                      ▼
┌──────────────────┐   ┌──────────────────┐
│  secp256k1 SK   │   │  Grumpkin SK     │
│  (EVM signing)  │   │  (Aztec privacy)  │
└──────────────────┘   └──────────────────┘
```

### Aztec Account Creation Flow

```typescript
// In the sidecar (Node.js)

import { EcdsaKAccountContract } from '@aztec/accounts/ecdsa';
import { Fr, Fq } from '@aztec/aztec.js/fields';
import { AccountManager } from '@aztec/aztec.js';

async function createAztecAccountFromSeed(
  pxe: PXE,
  evmPrivateKeyHex: string,  // From BIP-44 derivation
  mnemonicEntropy: Buffer,   // BIP-39 entropy for privacy keys
  accountIndex: number
): Promise<CompleteAddress> {
  
  // 1. Create ECDSA account contract with EVM private key
  const signingKey = Buffer.from(evmPrivateKeyHex.slice(2), 'hex');
  const ecdsaAccount = new EcdsaKAccountContract(signingKey);
  
  // 2. Derive Aztec privacy secret from mnemonic
  // Using path: m/44'/60'/0'/0/{i}'/aztec' (BIP-43 style)
  const aztecPrivacySecret = deriveAztecPrivacySecret(
    mnemonicEntropy,
    accountIndex,
    'pacto-aztec-privacy-v1'
  );
  
  // 3. Create account manager
  const salt = Fr.random();
  const accountManager = await AccountManager.create(
    pxe,
    aztecPrivacySecret,  // Fr for privacy keys
    ecdsaAccount,
    salt
  );
  
  // 4. Get address before deployment (counterfactual)
  const completeAddress = await accountManager.getCompleteAddress();
  
  return completeAddress;
}
```

### Rust Side: Key Derivation

The Rust backend will handle BIP-39 to Aztec key derivation:

```rust
// In src-tauri/src/aztec_keys.rs

use k256::elliptic_curve::SecretKey;
use bip39::{Mnemonic, Seed};

const AZTEC_PRIVACY_CONTEXT: &[u8] = b"pacto-aztec-privacy-v1";

/// Derive the EVM secp256k1 private key (existing)
pub fn derive_evm_key(mnemonic: &str, index: u32) -> Result<[u8; 32], String> {
    // ... existing implementation
}

/// Derive the Aztec privacy secret (Fq/Fr scalar)
/// 
/// Uses SHA-256 of BIP-39 seed + context + index to get a Grumpkin scalar
/// Note: Grumpkin curve order is different from secp256k1
pub fn derive_aztec_privacy_secret(
    mnemonic: &str, 
    index: u32
) -> Result<String, String> {
    let seed = Mnemonic::parse_normalized(mnemonic)
        .map_err(|_| "Invalid mnemonic")?
        .to_seed("");
    
    let mut hasher = sha2::Sha256::new();
    hasher.update(&seed);
    hasher.update(AZTEC_PRIVACY_CONTEXT);
    hasher.update(&index.to_le_bytes());
    
    let hash = hasher.finalize();
    
    // Convert to Grumpkin scalar (Fq)
    // Grumpkin order: 0x30644e72e131a029b85045b68181585d2833e84879b970f3d2c23
    // We take the hash modulo the curve order to get a valid scalar
    let grumpkin_order = Fq::from_hex(
        "30644e72e131a029b85045b68181585d2833e84879b970f3d2c23"
    ).unwrap();
    
    let scalar = Fq::from_bytes_mod_order(&hash);
    Ok(hex::encode(scalar.to_bytes()))
}
```

---

## Implementation Requirements

### Database Schema Changes

```sql
-- New table for Aztec accounts
CREATE TABLE IF NOT EXISTS aztec_accounts (
    id TEXT PRIMARY KEY,
    evm_account_id TEXT NOT NULL,  -- Links to EVM account
    aztec_address TEXT NOT NULL,
    privacy_secret_encrypted TEXT NOT NULL,  -- Encrypted Grumpkin scalar
    partial_address TEXT NOT NULL,
    public_keys_hash TEXT NOT NULL,
    is_deployed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (evm_account_id) REFERENCES evm_accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_aztec_address ON aztec_accounts(aztec_address);
CREATE INDEX IF NOT EXISTS idx_aztec_evm ON aztec_accounts(evm_account_id);
```

### Tauri Commands

```rust
// New commands for Aztec wallet

#[tauri::command]
pub async fn get_aztec_account(
    handle: AppHandle<R>,
    evm_account_id: String,
) -> Result<AztecAccountInfo, String>;

#[tauri::command]
pub async fn create_aztec_account(
    handle: AppHandle<R>,
    evm_account_id: String,
) -> Result<AztecAccountInfo, String>;

#[tauri::command]
pub async fn deploy_aztec_account(
    handle: AppHandle<R>,
    aztec_address: String,
) -> Result<AztecDeployResult, String>;

#[tauri::command]
pub async fn get_aztec_balance(
    handle: AppHandle<R>,
    aztec_address: String,
) -> Result<AztecBalance, String>;

#[tauri::command]
pub async fn send_aztec_transfer(
    handle: AppHandle<R>,
    from_address: String,
    to_address: String,
    amount: String,
    asset: String,
) -> Result<AztecTxResult, String>;
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND (Svelte)                    │
│  WalletBar → Network Tabs → Send Modal → Transaction       │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ invoke()
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    RUST BACKEND (Tauri)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐   │
│  │ PIN Gating  │  │ Key Derive  │  │ Sidecar Manager  │   │
│  │             │→ │ BIP-39→Keys │→ │ HTTP Client      │   │
│  └─────────────┘  └─────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ JSON-RPC over HTTP
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   NODE SIDCECAR (Aztec.js + PXE)           │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐   │
│  │ PXE Client  │  │ Account     │  │ Transaction       │   │
│  │             │→ │ Manager     │→ │ Builder          │   │
│  └─────────────┘  └─────────────┘  └──────────────────┘   │
│                              │                              │
│                              ▼                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Aztec Testnet v4.1.0-rc.2 (rpc.testnet.aztec-labs) │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Grumpkin scalar derivation not standard | Medium | Use SHA-256 of BIP-39 seed with context; can be changed if needed |
| Aztec address ≠ EVM address | Low | By design; users share one phrase but have separate addresses |
| Privacy key exposure | High | Encrypt with PIN-derived key; never store plaintext |
| Curve mismatch in derivation | Low | Test vectors needed before implementation |
| PXE state persistence | Medium | Sidecar manages PXE data directory; backup strategy needed |

---

## Test Plan

### 1. Unit Tests

- [ ] BIP-39 mnemonic → EVM key derivation (existing)
- [ ] BIP-39 mnemonic → Aztec privacy secret derivation
- [ ] Verify Grumpkin scalar is valid (mod curve order)

### 2. Integration Tests (Sidecar)

- [ ] Create Aztec account with derived keys
- [ ] Deploy account to testnet
- [ ] Send transfer transaction
- [ ] Verify balance updates

### 3. Key Recovery Tests

- [ ] Export Aztec account data
- [ ] Import on fresh device
- [ ] Verify address matches

---

## Open Questions

1. **Grumpkin curve order**: Need to verify the exact curve parameters for scalar derivation
2. **Derivation path convention**: Should we use BIP-43 style (`m/44'/60'/0'/0/i'/aztec'`) or custom?
3. **Salt for account deployment**: Should this be deterministic or random?
4. **Backup/export format**: How to export Aztec account for recovery?

---

## References

- [Aztec Accounts Documentation](https://docs.aztec.network/developers/testnet/docs/foundational-topics/accounts)
- [Aztec Keys Documentation](https://docs.aztec.network/developers/testnet/docs/foundational-topics/accounts/keys)
- [EcdsaKAccountContract API](https://docs.aztec.network/developers/reference/aztecjs/accounts/classes/ecdsa.EcdsaKAccountContract)
- [AccountManager API](https://docs.aztec.network/typescript-api/testnet/aztec.js.md#accountmanager)
- [BIP-39 Specification](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki)
- [BIP-43 Purpose Field Definition](https://github.com/bitcoin/bips/blob/master/bip-0043.mediawiki)
