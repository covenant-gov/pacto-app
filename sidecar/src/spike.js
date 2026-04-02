/**
 * Spike Script: Test Aztec.js + PXE integration
 * 
 * This script validates:
 * 1. Connection to Aztec testnet v4.1.0-rc.2
 * 2. EVM private key → Aztec account creation
 * 3. Account deployment
 * 4. Balance checking
 */

import * as crypto from 'crypto';

// ============================================
// CONFIGURATION
// ============================================

const AZTEC_TESTNET_URL = 'https://rpc.testnet.aztec-labs.com';

// Test mnemonic for development (abandon abandon... about)
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// ============================================
// UTILITIES
// ============================================

function log(level, message, data) {
  const timestamp = new Date().toISOString();
  const prefix = level === 'SUCCESS' ? '✅' : level === 'ERROR' ? '❌' : level === 'WARN' ? '⚠️' : '📋';
  console.log(`${prefix} [${timestamp}] ${message}`);
  if (data !== undefined) {
    console.log(`   └─`, JSON.stringify(data, null, 2));
  }
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// ============================================
// KEY DERIVATION
// ============================================

async function deriveEVMKey(mnemonic, index) {
  // For spike purposes, use deterministic test keys
  const testKeys = {
    0: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  };
  
  if (index === 0) return testKeys[0];
  
  // Derive for other indices
  const encoder = new TextEncoder();
  const data = encoder.encode(mnemonic + index.toString());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hexKey = '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hexKey.slice(0, 66);
}

async function deriveAztecPrivacySecret(mnemonic, index) {
  const encoder = new TextEncoder();
  const context = 'pacto-aztec-privacy-v1';
  
  const data = encoder.encode(mnemonic + context + index.toString());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  
  return Buffer.from(hashArray);
}

// ============================================
// SPIKE TESTS
// ============================================

async function runSpike() {
  log('INFO', '===========================================');
  log('INFO', '  AZTEC SPIKE TEST - Pacto Wallet');
  log('INFO', '  Target: Testnet v4.1.0-rc.2');
  log('INFO', '===========================================');

  const results = {};
  const overallStart = Date.now();

  try {
    // Import Aztec modules dynamically using correct export paths
    log('INFO', 'Loading Aztec modules...');
    
    // @aztec/aztec.js exports
    const { createAztecNodeClient } = await import('@aztec/aztec.js/node');
    const { Fr } = await import('@aztec/aztec.js/fields');
    const { AztecAddress } = await import('@aztec/aztec.js/addresses');
    
    // @aztec/accounts exports
    const { EcdsaKAccountContract } = await import('@aztec/accounts/ecdsa');
    const { getInitialTestAccountsData } = await import('@aztec/accounts/testing');
    
    log('INFO', 'Modules loaded successfully');

    // Spike 1: Connect to testnet
    log('INFO', 'SPIKE 1: Connecting to Aztec testnet');
    const connectStart = Date.now();
    
    try {
      const node = createAztecNodeClient(AZTEC_TESTNET_URL);
      const nodeInfo = await node.getNodeInfo();
      
      log('SUCCESS', 'Connected to testnet', {
        version: nodeInfo.nodeVersion,
        chainId: nodeInfo.l1ChainId,
        rollupVersion: nodeInfo.rollupVersion,
        blockNumber: nodeInfo.blockNumber,
        connectionTime: formatDuration(Date.now() - connectStart)
      });
      
      results.connect = { success: true, nodeInfo };
      
      // Spike 2: Create account with EVM key
      log('INFO', 'SPIKE 2: Creating Aztec account with EVM private key');
      const createStart = Date.now();
      
      const evmKey = await deriveEVMKey(TEST_MNEMONIC, 0);
      log('INFO', 'Using EVM private key', {
        keyPreview: evmKey.slice(0, 10) + '...'
      });
      
      // Convert EVM private key hex to Buffer
      const privateKeyBuffer = Buffer.from(evmKey.slice(2), 'hex');
      
      // Create ECDSA account contract with EVM private key
      log('INFO', 'Creating EcdsaKAccountContract with EVM key...');
      const ecdsaContract = new EcdsaKAccountContract(privateKeyBuffer);
      log('SUCCESS', 'Created EcdsaKAccountContract');
      
      // Derive privacy secret
      const privacySecretBuffer = await deriveAztecPrivacySecret(TEST_MNEMONIC, 0);
      const privacySecret = Fr.fromBuffer(privacySecretBuffer);
      log('INFO', 'Derived privacy secret', {
        secretPreview: privacySecret.toString().slice(0, 20) + '...'
      });
      
      // Create account manager - need to import AccountManager
      log('INFO', 'Checking AccountManager availability...');
      
      // Import AccountManager from wallet module
      const walletModule = await import('@aztec/aztec.js/wallet');
      log('INFO', 'Wallet module exports', Object.keys(walletModule));
      
      if (walletModule.AccountManager) {
        log('INFO', 'Creating AccountManager...');
        
        const salt = Fr.random();
        const accountManager = await walletModule.AccountManager.create(
          node,
          privacySecret,
          ecdsaContract,
          salt
        );
        
        // Get complete address (counterfactual)
        const completeAddress = await accountManager.getCompleteAddress();
        
        log('SUCCESS', 'Created account (counterfactual)', {
          address: completeAddress.address.toString(),
          creationTime: formatDuration(Date.now() - createStart)
        });
        
        results.createAccount = { 
          success: true, 
          address: completeAddress.address.toString(),
          duration: Date.now() - createStart
        };
        
        // Spike 3: Try to deploy
        log('INFO', 'SPIKE 3: Attempting account deployment');
        const deployStart = Date.now();
        
        try {
          const deployMethod = await accountManager.getDeployMethod();
          log('INFO', 'Sending deployment transaction...');
          
          // Deployment requires fee - for testnet, try without first
          // Note: testnet may require Fee Juice
          const receipt = await deployMethod.send({ 
            from: AztecAddress.ZERO 
          }).wait();
          
          log('SUCCESS', 'Account deployed successfully!', {
            txHash: receipt.txHash.toString(),
            blockNumber: receipt.blockNumber,
            deploymentTime: formatDuration(Date.now() - deployStart)
          });
          
          results.deploy = { success: true, txHash: receipt.txHash.toString(), duration: Date.now() - deployStart };
          
        } catch (deployError) {
          const errorStr = deployError.message || String(deployError);
          
          // Check if it's a fee issue
          if (errorStr.includes('balance') || 
              errorStr.includes('fee') || 
              errorStr.includes('Insufficient') ||
              errorStr.includes('FEE')) {
            log('WARN', 'Deployment failed - insufficient fee juice', {
              error: errorStr.slice(0, 300)
            });
            log('INFO', 'Account created but not deployed (counterfactual state)');
            log('INFO', 'This is expected on testnet - need to bridge Fee Juice first');
            results.deploy = { 
              success: false, 
              deployed: false, 
              isCounterfactual: true,
              address: completeAddress.address.toString(),
              note: 'Bridge Fee Juice from L1 Sepolia to deploy'
            };
          } else {
            log('WARN', 'Deployment error (may be expected)', { error: errorStr.slice(0, 300) });
            results.deploy = { 
              success: false, 
              error: errorStr.slice(0, 300),
              address: completeAddress.address.toString()
            };
          }
        }
      } else {
        log('WARN', 'AccountManager not found in wallet module');
        results.createAccount = { 
          success: false, 
          error: 'AccountManager not available in wallet export path'
        };
      }
      
      // Spike 4: Test with known test accounts
      log('INFO', 'SPIKE 4: Testing with built-in test accounts');
      const testStart = Date.now();
      
      try {
        const testAccounts = await getInitialTestAccountsData(node);
        
        log('INFO', 'Got test accounts', {
          count: testAccounts.length,
          addresses: testAccounts.slice(0, 2).map(a => a.address.toString().slice(0, 20) + '...')
        });
        
        results.testAccounts = { success: true, count: testAccounts.length };
        
      } catch (testError) {
        log('WARN', 'Test accounts not available', { error: String(testError).slice(0, 200) });
        results.testAccounts = { success: false, error: String(testError).slice(0, 200) };
      }
      
    } catch (connectError) {
      log('ERROR', 'Failed to connect to testnet', { error: String(connectError).slice(0, 500) });
      results.connect = { success: false, error: String(connectError).slice(0, 500) };
      
      // Try with sandbox/local if testnet fails
      log('INFO', 'Attempting local sandbox connection...');
      try {
        const localNode = createAztecNodeClient('http://localhost:8080');
        const localInfo = await localNode.getNodeInfo();
        log('SUCCESS', 'Connected to local sandbox', { nodeInfo: localInfo });
        results.localSandbox = { success: true, nodeInfo: localInfo };
      } catch (sandboxError) {
        log('WARN', 'Local sandbox not available', { error: String(sandboxError).slice(0, 200) });
        results.localSandbox = { success: false, error: String(sandboxError).slice(0, 200) };
      }
    }
    
  } catch (error) {
    log('ERROR', 'Spike failed', { error: String(error).slice(0, 500), stack: error.stack });
    results.error = { message: String(error).slice(0, 500), stack: error.stack };
  }
  
  // Summary
  log('INFO', '===========================================');
  log('INFO', '  SPIKE COMPLETE');
  log('INFO', '===========================================');
  log('INFO', 'Total duration', { duration: formatDuration(Date.now() - overallStart) });
  
  console.log('\n--- Full Results ---');
  console.log(JSON.stringify(results, null, 2));
  
  return results;
}

// Run
runSpike().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
