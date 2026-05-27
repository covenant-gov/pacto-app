/// <reference types="vite/client" />

/**
 * Operator RPC and optional UI env vars.
 * `ALCHEMY_*` is exposed via `envPrefix` in `vite.config.ts` (same name Rust reads at runtime).
 */
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly MODE: string;
  readonly PROD: boolean;
  readonly SSR: boolean;
  readonly ALCHEMY_RPC_KEY?: string;
  readonly VITE_WALLET_RPC_DOCS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
