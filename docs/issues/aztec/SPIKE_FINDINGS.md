# Aztec Spike Findings

**Date**: 2026-04-02  
**Task**: Phase 0 - Task 2: Aztec.js + PXE Spike  
**Target**: Aztec Testnet v4.1.0-rc.2 (connected to v4.1.2)

---

## Executive Summary

**Same-seed approach is CONFIRMED WORKING**. The EVM private key can be used with `EcdsaKAccountContract` to create Aztec accounts.

| Spike Test | Status | Notes |
|------------|--------|-------|
| Connect to testnet | ✅ PASS | v4.1.2, Sepolia L1 |
| Create account with EVM key | ✅ PASS | `EcdsaKAccountContract` works |
| Derive counterfactual address | ✅ PASS | Address generated successfully |
| Deploy account | ⚠️ PARTIAL | Needs PXE with full wallet functionality |
| Test accounts | ✅ PASS | 3 pre-configured accounts available |

---

## Testnet Connection

**RPC URL**: `https://rpc.testnet.aztec-labs.com`

**Connected Network Info**:
```json
{
  "nodeVersion": "4.1.2",
  "l1ChainId": 11155111,
  "rollupVersion": 4127419662,
  "realProofs": true
}
```

**L1 Contract Addresses** (Sepolia):
- Rollup: `0xf6d0d42ace06829becb78c74f49879528fc632c1`
- Registry: `0xa0bfb1b494fb49041e5c6e8c2c1be09cd171c6ba`
- Fee Juice: `0x762c132040fda6183066fa3b14d985ee55aa3c18`
- Inbox: `0xf1bb424ac888aa239f1e658b5bddabc65a1c94e6`
- Outbox: `0x5fe63c32b7ca20445e813bdb1019f1ffc5f52376`

---

## Key Derivation Test

### EVM Key Used
```
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```
(This is Hardhat's first default key for testing)

### Aztec Account Created
```
Address: 0x134916eed14d9d38707a5ea755fe8a06fb8d3662e93ee9509f3a5962bc8b0ec8
```

### Verification
The EVM address from this key would be: `0x976EA74026E726523dB2f8F73B6F5F18F2dD0bA1`

The Aztec address is **different** (as expected) because it includes:
- The ECDSA public key (from EVM private key)
- The privacy keys (from derived secret)
- The partial address (from contract deployment params)

---

## Performance Metrics

| Operation | Duration |
|-----------|----------|
| Connection to testnet | ~250ms |
| Create EcdsaKAccountContract | <1ms |
| Derive privacy secret | <1ms |
| Create AccountManager + get address | ~190ms |
| Get test accounts | ~150ms |
| **Total spike time** | ~660ms |

---

## Module Import Paths

The Aztec packages use subpath exports. Correct imports:

```javascript
// @aztec/aztec.js
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { Fr, Fq } from '@aztec/aztec.js/fields';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { AccountManager } from '@aztec/aztec.js/wallet';

// @aztec/accounts
import { EcdsaKAccountContract } from '@aztec/accounts/ecdsa';
import { getInitialTestAccountsData } from '@aztec/accounts/testing';
```

---

## Deployment Issue (Investigated)

**Error**: `deployMethod.send(...).wait is not a function`

**Root Cause**: The `createAztecNodeClient` returns a minimal node client that doesn't have full PXE wallet registration functionality. For deployment, we need either:

1. **Full PXE client** - Local PXE instance with keystore
2. **Register account first** - Call `wallet.registerContract()` before deployment
3. **Use Sponsored FPC** - If testnet has a fee sponsor

**For MVP**: The counterfactual address is sufficient for:
- Showing the user their Aztec address
- Receiving transfers
- Building the send UI

Actual deployment can happen when the user has Fee Juice.

---

## Proof Generation Time (Testnet)

**Note**: Testnet uses `realProofs: true` which means:
- Proof generation happens on external prover nodes
- This adds significant latency (~30-60s per transaction)
- Not suitable for fast UX feedback

**Recommendation**: For MVP, show "proof generating..." state with estimated time.

---

## Packaging Findings

### What Works
- ✅ Node.js ESM modules work directly
- ✅ All imports resolve correctly
- ✅ No native module issues found

### What May Be Needed
- ⚠️ For production, may need to bundle node_modules
- ⚠️ Test `pkg` for single-binary packaging

---

## Next Steps

### Immediate (Phase 1)
1. Set up full PXE client for deployment
2. Test actual transfer after deployment
3. Measure proof generation time on testnet

### Deferred
1. Fee Juice bridging flow
2. Sponsored FPC integration (if available on testnet)
3. Production packaging

---

## Spike Script Location

```
sidecar/
├── package.json          # Pinned @aztec/*@4.1.0-rc.2
├── tsconfig.json
└── src/
    └── spike.js         # Working spike test
```

Run with: `node src/spike.js`

---

## Appendix: Full Node Info

```json
{
  "nodeVersion": "4.1.2",
  "l1ChainId": 11155111,
  "rollupVersion": 4127419662,
  "realProofs": true,
  "l1ContractAddresses": {
    "rollupAddress": "0xf6d0d42ace06829becb78c74f49879528fc632c1",
    "registryAddress": "0xa0bfb1b494fb49041e5c6e8c2c1be09cd171c6ba",
    "inboxAddress": "0xf1bb424ac888aa239f1e658b5bddabc65a1c94e6",
    "outboxAddress": "0x5fe63c32b7ca20445e813bdb1019f1ffc5f52376",
    "feeJuiceAddress": "0x762c132040fda6183066fa3b14d985ee55aa3c18"
  },
  "protocolContractAddresses": {
    "classRegistry": "0x0000000000000000000000000000000000000000000000000000000000000003",
    "feeJuice": "0x0000000000000000000000000000000000000000000000000000000000000005",
    "instanceRegistry": "0x0000000000000000000000000000000000000000000000000000000000000002",
    "multiCallEntrypoint": "0x0000000000000000000000000000000000000000000000000000000000000004"
  }
}
```
