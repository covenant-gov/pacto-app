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
export declare function startServer(port?: number): Promise<{
    port: number;
    token: string;
}>;
export declare function stopServer(): void;
export declare function isRunning(): boolean;
