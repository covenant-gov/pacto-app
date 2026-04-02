/**
 * Aztec Sidecar Entry Point
 * 
 * Starts the HTTP server for Rust backend communication
 * 
 * Usage:
 *   node dist/index.js [--port 4892]
 */

import { startServer, stopServer } from './server.js';

const args = process.argv.slice(2);
let port = 4892;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
  }
  if (args[i] === '--help') {
    console.log('Usage: node index.js [--port <port>] [--help]');
    console.log('Default port: 4892');
    process.exit(0);
  }
}

console.log('========================================');
console.log('  Aztec Sidecar');
console.log('  Local loopback API for Aztec.js');
console.log('========================================');

startServer(port)
  .then(({ port: actualPort, token }) => {
    console.log(`\nListening on: http://127.0.0.1:${actualPort}`);
    console.log(`Health endpoint: http://127.0.0.1:${actualPort}/health`);
    console.log(`RPC endpoint: http://127.0.0.1:${actualPort}/rpc`);
    console.log(`Auth token: ${token}`);
    console.log('\nReady to accept requests...\n');
  })
  .catch((err) => {
    console.error('Failed to start sidecar:', err);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  stopServer();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  stopServer();
  process.exit(0);
});
