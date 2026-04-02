# Aztec Wallet Implementation Spec

**Date**: 2026-04-02  
**Status**: Debugging - RPC communication between Rust and Node.js sidecar  
**Target**: Aztec Testnet v4.1.0-rc.2

---

## Summary

Implementing Aztec wallet support in Pacto application for private ZK transactions. Uses a Node.js sidecar to run Aztec.js (requires Node.js environment), communicated with via JSON-RPC over HTTP from Rust backend.

---

## Architecture

```
┌─────────────────────┐
│   Frontend (Svelte) │
│  AztecWalletView    │
└──────────┬──────────┘
           │ invoke()
           ▼
┌─────────────────────┐
│   Rust Backend      │
│   (Tauri)           │
│   aztec_wallet.rs   │
│   aztec_sidecar.rs   │
└──────────┬──────────┘
           │ JSON-RPC over HTTP
           ▼
┌─────────────────────┐
│   Node.js Sidecar   │
│   (server.ts)       │
│   Aztec.js + PXE    │
└──────────┬──────────┘
           │ HTTPS
           ▼
┌─────────────────────┐
│   Aztec Testnet     │
│   rpc.testnet       │
└─────────────────────┘
```

---

## Files Created/Modified

### New Files

| File | Purpose |
|------|---------|
| `sidecar/` | Node.js sidecar directory |
| `sidecar/package.json` | Dependencies (@aztec/aztec.js@4.1.0-rc.2, etc.) |
| `sidecar/src/server.ts` | HTTP server with JSON-RPC handlers |
| `sidecar/src/spike.ts` | Spike script for testing Aztec.js |
| `sidecar/dist/index.js` | Compiled sidecar entry point |
| `sidecar/dist/server.js` | Compiled server |
| `docs/issues/aztec/KEY_DERIVATION_RESEARCH.md` | Research on same-seed approach |
| `docs/issues/aztec/SPIKE_FINDINGS.md` | Spike test results |
| `src-tauri/src/aztec_sidecar.rs` | Rust sidecar supervisor |
| `src-tauri/src/aztec_wallet.rs` | Tauri commands for Aztec operations |
| `src/lib/wallet/aztec-backend.ts` | TypeScript client for Aztec commands |
| `src/components/wallet/AztecWalletView.svelte` | Aztec wallet UI component |

### Modified Files

| File | Changes |
|------|---------|
| `src-tauri/src/lib.rs` | Added Aztec module registration |
| `src-tauri/tauri.conf.json` | Changed identifier to `com.pacto` |
| `src/lib/wallet/chains.ts` | Added Aztec chain config |
| `src/lib/wallet/index.ts` | Exported Aztec wallet functions |
| `src/components/wallet/WalletView.svelte` | Added Aztec tab |
| `src/components/wallet/WalletBar.svelte` | Added Aztec indicator |

---

## Spike Test Results

### What Works (Direct Node.js)

```
✅ Spike 1: Connect to testnet - v4.1.3, Sepolia L1
✅ Spike 2: Create account from EVM key - Address: 0x1e525bbf3052538eba190f2e3c2b80e5242a0aebfdce4ab454691c2e2acc771e
✅ Spike 3: Test accounts retrieval - 3 accounts available
⚠️  Spike 4: Account deployment - Fails (needs full PXE)
✅ Sidecar health endpoint
✅ Sidecar system.echo RPC
✅ Sidecar system.sdkTest RPC
✅ Sidecar account.createFromEVMKey RPC (with curl)
```

### Key Finding: Same-Seed Approach Works

- EVM private key can be used with `EcdsaKAccountContract`
- Both use secp256k1 curve - compatible
- Aztec address differs from EVM address (as expected)

---

## Errors Encountered

### Error 1: Account Deployment Fails
```
deployMethod.send(...).wait is not a function
```
**Cause**: `createAztecNodeClient` returns minimal client without full PXE functionality  
**Impact**: Low - counterfactual address generation works

### Error 2: Port Conflicts
**Cause**: When sidecar crashes, subsequent runs try ports 4893, 4894, etc.  
**Mitigation**: Port scanning implemented in `start()`

### Error 3: RPC Call Fails from Rust but Works from curl
```
Request failed: error sending request for url (http://127.0.0.1:4892/rpc)
```
**Status**: UNRESOLVED

| Test | From Rust | From curl |
|------|-----------|-----------|
| Health check | ✅ Works | ✅ Works |
| system.echo | ✅ Works | ✅ Works |
| system.sdkTest | ✅ Works | ✅ Works |
| system.sdkModulesCount | ✅ Works | ✅ Works |
| account.createFromEVMKey | ❌ Fails (872ms) | ✅ Works |

**Observations**:
- The failure happens at ~872ms consistently
- `waitForNode()` is suspected but skipping it didn't resolve
- Both use identical reqwest configuration

---

## Current Debugging State

### What Was Tried

1. **Added timing logs** to trace request flow
2. **Simplified client config**: Changed from `Client::builder()...` to `Client::new()`
3. **Added RPC test after health check** when detecting existing sidecar
4. **Skipped waitForNode()** in getAztecNode() - didn't help
5. **Added detailed step logging** to sidecar handler

### Latest Hypothesis

The issue might be:
1. **HTTP connection reuse**: reqwest might be keeping connections open that the sidecar's single-threaded event loop can't handle
2. **Content-Type header differences**: Rust sends explicit header, curl might not
3. **Request body serialization**: Minor differences in JSON formatting

### Next Debugging Steps

1. Add logging in Rust `request()` to show exact request being sent
2. Compare request bodies between working (echo) and failing (create) calls
3. Try adding `Connection: close` header to force new connections
4. Check if sidecar's `initAztecModules()` is being called correctly
5. Add timestamp to verify request/response timing

---

## Implementation Status

### Phase 0 - Research Spike ✅
- [x] Same-seed approach confirmed working
- [x] Key derivation documented
- [x] Spike script validated

### Phase 1 - Sidecar Service ✅
- [x] Node.js HTTP server with JSON-RPC
- [x] Aztec.js module loading
- [x] Health check endpoint
- [x] Account creation handler (stub)
- [x] Rust supervisor with process management
- [x] Health check loop

### Phase 2 - Frontend Integration ✅
- [x] TypeScript client (`aztec-backend.ts`)
- [x] Aztec chain config
- [x] AztecWalletView component
- [x] Tab integration in WalletView

### Phase 3 - Settings Wallet Tab ⚠️
- [x] Component created
- [x] UI layout implemented
- [ ] Debugging RPC communication
- [ ] Full account creation flow
- [ ] Balance checking
- [ ] Transfer functionality

---

## TODOs

### Immediate (Blocking)

- [ ] **Fix RPC communication issue**: `account.createFromEVMKey` fails from Rust but works from curl
  - Compare exact HTTP requests between working and failing cases
  - Try `Connection: close` header
  - Verify sidecar handler is being invoked correctly

### High Priority

- [ ] Complete `account.createFromEVMKey` handler to return actual address
- [ ] Implement account storage (DB integration)
- [ ] Add balance checking functionality
- [ ] Implement transfer flow

### Medium Priority

- [ ] Add proper error handling for network failures
- [ ] Implement sidecar auto-restart
- [ ] Add fee juice balance checking
- [ ] Handle account deployment flow

### Low Priority

- [ ] Production packaging (bundle node_modules)
- [ ] Account recovery/export
- [ ] Multi-account support
- [ ] Gas estimation UI

---

## Configuration

### Aztec Testnet RPC
```
https://rpc.testnet.aztec-labs.com
```

### Sidecar Port
```
4892 (hex-ish for "AZT")
```

### Account Contract
```
EcdsaKAccountContract (secp256k1 ECDSA)
```

---

## References

- [Aztec Documentation](https://docs.aztec.network/)
- [Aztec.js API](https://docs.aztec.network/developers/reference/aztecjs)
- [Account Contracts](https://docs.aztec.network/developers/testnet/docs/foundational-topics/accounts)
