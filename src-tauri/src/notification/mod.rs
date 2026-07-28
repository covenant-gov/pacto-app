//! Notification tier resolution, tier-aware emit, and burst coalescing.
//! The Catch up writer (U8) is the sibling `catch_up` module, which
//! consumes `earns_catch_up_entry` from here rather than living inside it.
//!
//! Leaf module per KTD11: no access to `crate::STATE`, `crate::TAURI_APP`,
//! or any other global. The effectful half (`emit`, `coalesce`) takes the
//! app handle as a parameter instead of reaching up for it.

pub mod coalesce;
pub mod emit;
pub mod severity;

pub use emit::{emit, SingleEventNotification};
pub use severity::{contributes_to_badge, earns_catch_up_entry, resolve_tier, EventKind, Tier};
