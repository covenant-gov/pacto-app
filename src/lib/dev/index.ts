/**
 * Entry point for agent/CLI callers that have an npub and are running in a
 * dev build. Re-exports the dev-only account bootstrap helper.
 */
export { applyLocalDevDefaults } from './local-dev-setup';
