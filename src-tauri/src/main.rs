// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Marker before any crypto init so a SIGILL in aws-lc (constructors or
    // provider install) is distinguishable from a hang/crash inside `run()`.
    if std::env::var_os("PACTO_TEST_SANDBOX_ROOT").is_some() {
        eprintln!("[sandbox] main");
    }

    // Multiple crates in the dependency graph pull in different rustls crypto
    // backends (aws-lc-rs via alloy's HTTP transport, ring via reqwest/nostr
    // relay connections); rustls can't auto-select one, so pick explicitly
    // before any TLS connection (relay websockets, RPC calls) is attempted.
    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .expect("failed to install default rustls CryptoProvider");

    if std::env::var_os("PACTO_TEST_SANDBOX_ROOT").is_some() {
        eprintln!("[sandbox] rustls provider installed");
    }

    pacto_lib::run()
}
