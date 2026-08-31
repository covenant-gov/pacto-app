//! Tauri command modules, grouped by domain. Registered in `crate::run()`'s
//! `generate_handler!` list; the IPC command name is the function identifier and is
//! unaffected by which module it lives in.

pub(crate) mod app;
pub(crate) mod auth;
pub(crate) mod chat;
pub(crate) mod invites;
pub(crate) mod media;
pub(crate) mod mls_groups;
pub(crate) mod profile_sync;
pub(crate) mod relays;
pub(crate) mod storage;
pub(crate) mod voice;
