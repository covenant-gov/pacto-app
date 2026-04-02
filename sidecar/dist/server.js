/**
 * Aztec Sidecar HTTP Server
 *
 * Provides a local loopback API for Rust backend to interact with Aztec.js
 *
 * Protocol: JSON-RPC style
 * {
 *   id: string,
 *   method: string,
 *   params: object
 * }
 */
import * as crypto from 'crypto';
import { createServer } from 'http';
// ============================================
// CONFIGURATION
// ============================================
const PORT = 4892; // Aztec in hex-ish
const HOST = '127.0.0.1';
const AUTH_TOKEN_LENGTH = 32;
// ============================================
// STATE
// ============================================
let server = null;
let authToken = null;
let aztecNode = null;
let isShuttingDown = false;
const storedAccounts = new Map();
// ============================================
// UTILITIES
// ============================================
function generateAuthToken() {
    return crypto.randomBytes(AUTH_TOKEN_LENGTH).toString('hex');
}
function log(level, message, data) {
    const timestamp = new Date().toISOString();
    const prefix = level === 'ERROR' ? '❌' : level === 'WARN' ? '⚠️' : level === 'DEBUG' ? '🔍' : '📋';
    console.log(`${prefix} [${timestamp}] [sidecar] ${message}`);
    if (data !== undefined && level !== 'DEBUG') {
        console.log(`   └─`, JSON.stringify(data, null, 2));
    }
}
function sendJson(res, status, body) {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'http://localhost:*',
    });
    res.end(JSON.stringify(body));
}
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}
// ============================================
// AZTEC MODULE
// ============================================
let aztecModules = {};
async function initAztecModules() {
    if (Object.keys(aztecModules).length > 0)
        return aztecModules;
    log('INFO', 'Loading Aztec modules...');
    const [{ createAztecNodeClient, waitForNode }, { Fr, Fq }, { AztecAddress }, { EcdsaKAccountContract }, { AccountManager }, { getInitialTestAccountsData },] = await Promise.all([
        import('@aztec/aztec.js/node'),
        import('@aztec/aztec.js/fields'),
        import('@aztec/aztec.js/addresses'),
        import('@aztec/accounts/ecdsa'),
        import('@aztec/aztec.js/wallet'),
        import('@aztec/accounts/testing'),
    ]);
    aztecModules = {
        createAztecNodeClient,
        waitForNode,
        Fr,
        Fq,
        AztecAddress,
        EcdsaKAccountContract,
        AccountManager,
        getInitialTestAccountsData,
    };
    log('SUCCESS', 'Aztec modules loaded');
    return aztecModules;
}
async function getAztecNode(rpcUrl) {
    if (aztecNode && aztecNode.url === rpcUrl) {
        log('INFO', 'getAztecNode: Returning cached node for', { rpcUrl });
        return aztecNode;
    }
    log('INFO', 'getAztecNode: Creating new node client for', { rpcUrl });
    const { createAztecNodeClient } = aztecModules;
    log('INFO', 'getAztecNode: Calling createAztecNodeClient...');
    const node = createAztecNodeClient(rpcUrl);
    log('INFO', 'getAztecNode: createAztecNodeClient returned (skipping waitForNode)');
    aztecNode = node;
    aztecNode.url = rpcUrl;
    log('INFO', 'getAztecNode: Connected to Aztec node', { rpcUrl });
    return node;
}
// ============================================
// HANDLERS
// ============================================
const handlers = {
    // System
    async 'system.health'(_params) {
        return {
            status: 'ok',
            timestamp: Date.now(),
            uptime: process.uptime(),
            modulesLoaded: Object.keys(aztecModules).length > 0,
        };
    },
    async 'system.ping'(_params) {
        return {
            pong: true,
            timestamp: Date.now(),
            uptime: process.uptime(),
        };
    },
    async 'system.echo'(params) {
        return {
            echo: true,
            params,
            timestamp: Date.now(),
        };
    },
    async 'system.sdkTest'(_params) {
        log('INFO', 'Testing Aztec SDK initialization...');
        try {
            await initAztecModules();
            log('INFO', 'SDK modules loaded successfully');
            return {
                success: true,
                modulesLoaded: Object.keys(aztecModules).length > 0,
                moduleNames: Object.keys(aztecModules),
            };
        }
        catch (error) {
            log('ERROR', 'SDK initialization failed', { error: String(error), stack: error.stack });
            return {
                success: false,
                error: String(error),
                stack: error.stack,
            };
        }
    },
    async 'system.sdkModulesCount'(_params) {
        await initAztecModules();
        return {
            count: Object.keys(aztecModules).length,
            names: Object.keys(aztecModules),
        };
    },
    async 'system.immediateReturn'(_params) {
        return { immediate: true };
    },
    async 'system.generateAuth'(_params) {
        authToken = generateAuthToken();
        return { token: authToken };
    },
    async 'system.shutdown'(_params) {
        isShuttingDown = true;
        if (server) {
            server.close();
        }
        return { shutdown: true };
    },
    // Node
    async 'node.connect'(params) {
        const { rpcUrl } = params;
        if (!rpcUrl) {
            throw new Error('rpcUrl required');
        }
        await getAztecNode(rpcUrl);
        return { connected: true };
    },
    async 'node.getInfo'(params) {
        const { rpcUrl } = params;
        const node = await getAztecNode(rpcUrl || 'https://rpc.testnet.aztec-labs.com');
        const info = await node.getNodeInfo();
        return info;
    },
    // Account
    async 'account.createFromEVMKey'(params) {
        const { evmPrivateKey, privacySecret, salt, rpcUrl } = params;
        log('INFO', 'account.createFromEVMKey called', { evmPrivateKey: evmPrivateKey?.slice(0, 10) + '...' });
        if (!evmPrivateKey)
            throw new Error('evmPrivateKey required');
        try {
            log('INFO', 'Step 1: Initializing Aztec modules...');
            await initAztecModules();
            log('INFO', 'Step 1 complete: Aztec modules initialized');
            log('INFO', 'Step 2: Getting Aztec node connection...');
            const testNode = await getAztecNode(rpcUrl || 'https://rpc.testnet.aztec-labs.com');
            log('INFO', 'Step 2 complete: Got node connection');
            // Simple test - just return success without doing actual account creation
            return {
                success: true,
                message: 'Account creation handler reached successfully',
                evmKeyPrefix: evmPrivateKey.slice(0, 10),
            };
        }
        catch (error) {
            log('ERROR', 'Account creation failed', { error: String(error), stack: error.stack });
            throw error;
        }
    },
    async 'account.getTestAccounts'(params) {
        const { rpcUrl } = params;
        await initAztecModules();
        const node = await getAztecNode(rpcUrl || 'https://rpc.testnet.aztec-labs.com');
        const { getInitialTestAccountsData } = aztecModules;
        const accounts = await getInitialTestAccountsData(node);
        return accounts.map((acc) => ({
            address: acc.address.toString(),
            secret: acc.secret.toString(),
        }));
    },
    async 'account.deploy'(params) {
        const { address } = params;
        // This requires the accountManager instance from createFromEVMKey
        // For now, return a placeholder
        throw new Error('Deploy requires full PXE - implement with stored accountManager');
    },
    async 'account.save'(params) {
        const account = params;
        storedAccounts.set(account.id, account);
        return { saved: true, id: account.id };
    },
    async 'account.get'(params) {
        const { id } = params;
        const account = storedAccounts.get(id);
        if (!account) {
            throw new Error('Account not found');
        }
        return account;
    },
    async 'account.list'(_params) {
        return Array.from(storedAccounts.values());
    },
    async 'account.getDeployed'(params) {
        const { address } = params;
        const account = Array.from(storedAccounts.values()).find(acc => acc.aztecAddress.toLowerCase() === address.toLowerCase());
        return account?.isDeployed ?? false;
    },
    async 'transfer.build'(params) {
        const { fromAddress, toAddress, amount, asset } = params;
        // Return a placeholder transfer request
        // Full implementation would:
        // 1. Get account from storage
        // 2. Create transfer transaction via Aztec.js
        // 3. Return the unsigned transaction
        return {
            from: fromAddress,
            to: toAddress,
            amount,
            asset: asset || 'ETH',
            feeEstimate: '0.0001', // Placeholder
            txRequest: null, // Would contain actual tx request
            note: 'Transfer requires deployed account with Fee Juice'
        };
    },
    async 'transfer.send'(params) {
        const { signedTx } = params;
        // This would broadcast the signed transaction
        // For now, return a placeholder
        return {
            txHash: '0x' + crypto.randomBytes(32).toString('hex'),
            status: 'pending',
            note: 'Broadcast requires deployed account - this is a placeholder'
        };
    },
    async 'balance.get'(params) {
        const { address, asset } = params;
        // Return placeholder balance
        // Full implementation would query the Aztec node
        return {
            address,
            asset: asset || 'ETH',
            balance: '0',
            balanceDecimal: '0.0',
            note: 'Balance check requires deployed account'
        };
    },
};
// ============================================
// REQUEST HANDLER
// ============================================
async function handleRequest(req, res) {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        });
        res.end();
        return;
    }
    // Health check (no auth)
    if (req.url === '/health' && req.method === 'GET') {
        sendJson(res, 200, {
            status: 'ok',
            uptime: process.uptime(),
            ready: Object.keys(aztecModules).length > 0,
        });
        return;
    }
    // JSON-RPC endpoint
    if (req.url === '/rpc' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const request = JSON.parse(body);
            // Auth check (skip for health/methods) - DISABLED for local development
            // const publicMethods = ['system.health', 'system.generateAuth'];
            // if (!publicMethods.includes(request.method)) {
            //   const authHeader = req.headers.authorization;
            //   const token = authHeader?.replace('Bearer ', '');
            //   if (!token || token !== authToken) {
            //     sendJson(res, 401, {
            //       id: request.id,
            //       success: false,
            //       error: { code: -32601, message: 'Unauthorized' }
            //     });
            //     return;
            //   }
            // }
            // Handle method
            const handler = handlers[request.method];
            if (!handler) {
                sendJson(res, 200, {
                    id: request.id,
                    success: false,
                    error: { code: -32601, message: `Method not found: ${request.method}` }
                });
                return;
            }
            const result = await handler(request.params || {});
            sendJson(res, 200, {
                id: request.id,
                success: true,
                result,
            });
        }
        catch (error) {
            log('ERROR', 'Request failed', { error: String(error) });
            sendJson(res, 200, {
                id: req.url,
                success: false,
                error: {
                    code: -32603,
                    message: String(error)
                }
            });
        }
        return;
    }
    // Not found
    sendJson(res, 404, { error: 'Not found' });
}
// ============================================
// SERVER LIFECYCLE
// ============================================
export async function startServer(port = PORT) {
    if (server) {
        log('WARN', 'Server already running');
        return { port, token: authToken || '' };
    }
    await initAztecModules();
    return new Promise((resolve) => {
        server = createServer(handleRequest);
        server.listen(port, HOST, () => {
            authToken = generateAuthToken();
            log('SUCCESS', `Server started on ${HOST}:${port}`);
            log('INFO', `Auth token generated (first 8 chars)`, { token: authToken?.slice(0, 8) + '...' });
            // Parseable format for Rust to capture
            console.log(`Server port: ${port}`);
            console.log(`Auth token: ${authToken}`);
            resolve({ port, token: authToken });
        });
        server.on('error', (err) => {
            log('ERROR', 'Server error', { error: String(err) });
            if (err.message.includes('EADDRINUSE')) {
                log('WARN', `Port ${port} in use, trying ${port + 1}`);
                server?.close();
                server = null;
                startServer(port + 1).then(resolve);
            }
        });
        server.on('close', () => {
            log('INFO', 'Server closed');
            server = null;
        });
    });
}
export function stopServer() {
    if (server) {
        isShuttingDown = true;
        server.close();
    }
}
export function isRunning() {
    return server !== null && !isShuttingDown;
}
// ============================================
// CLI START
// ============================================
if (import.meta.url === `file://${process.argv[1]}`) {
    startServer()
        .then(({ port, token }) => {
        console.log(`Aztec sidecar running on ${HOST}:${port}`);
        console.log(`Auth token: ${token}`);
    })
        .catch((err) => {
        console.error('Failed to start:', err);
        process.exit(1);
    });
}
