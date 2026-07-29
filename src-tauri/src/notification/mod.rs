//! Notification tier resolution, tier-aware emit, burst coalescing, and
//! (later, U8) the Catch up writer.
//!
//! Leaf module per KTD11: no access to `crate::STATE`, `crate::TAURI_APP`,
//! or any other global. The effectful half (`emit`, `coalesce`) takes the
//! app handle as a parameter instead of reaching up for it.

pub mod coalesce;
pub mod emit;
pub mod severity;

pub use emit::{emit, SingleEventNotification};
pub use severity::{contributes_to_badge, earns_catch_up_entry, resolve_tier, EventKind, Tier};
