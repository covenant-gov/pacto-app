// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Multiple crates in the dependency graph pull in different rustls crypto
    // backends (aws-lc-rs via alloy's HTTP transport, ring via reqwest/nostr
    // relay connections); rustls can't auto-select one, so pick explicitly
    // before any TLS connection (relay websockets, RPC calls) is attempted.
    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .expect("failed to install default rustls CryptoProvider");
    pacto_lib::run()
}
