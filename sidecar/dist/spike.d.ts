/**
 * Spike Script: Test Aztec.js + PXE integration
 *
 * This script validates:
 * 1. Connection to Aztec testnet v4.1.0-rc.2
 * 2. EVM private key → Aztec account creation
 * 3. Account deployment
 * 4. Balance checking
 * 5. Token transfer
 *
 * Run with: node --loader ts-node/esm src/spike.ts
 */
declare function runSpike(): Promise<Record<string, unknown>>;
export { runSpike };
