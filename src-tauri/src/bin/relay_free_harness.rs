//! Thin entry point for the relay-free seeding harness.
//!
//! No Tauri IPC and no window: a `tauri::test` mock app handle serves purely
//! as a path resolver, which the sandbox-root override in
//! `test_sandbox::sandbox_root` already bypasses whenever
//! `PACTO_TEST_SANDBOX_ROOT` is set. All real work lives in
//! `pacto_lib::harness`; see that module for the seeding logic itself.
//!
//! Usage: `relay-free-harness [--sandbox-root PATH] [--mnemonic PHRASE] [--pin PIN]`
//! (or `PACTO_TEST_SANDBOX_ROOT` / `--mnemonic` default / `--pin` default).

use pacto_lib::harness::{self, HarnessConfig};

struct Args {
    sandbox_root: Option<String>,
    config: HarnessConfig,
}

fn parse_args() -> Args {
    let mut sandbox_root: Option<String> = None;
    let mut config = HarnessConfig::default();
    let mut args = std::env::args().skip(1);

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--sandbox-root" => {
                sandbox_root = Some(args.next().unwrap_or_else(|| {
                    eprintln!("--sandbox-root requires a path argument");
                    std::process::exit(2);
                }));
            }
            "--mnemonic" => {
                config.mnemonic = args.next().unwrap_or_else(|| {
                    eprintln!("--mnemonic requires a phrase argument");
                    std::process::exit(2);
                });
            }
            "--pin" => {
                config.pin = args.next().unwrap_or_else(|| {
                    eprintln!("--pin requires a PIN argument");
                    std::process::exit(2);
                });
            }
            "--help" | "-h" => {
                print_usage();
                std::process::exit(0);
            }
            other => {
                eprintln!("[relay-free-harness] unrecognized argument: {other}");
                print_usage();
                std::process::exit(2);
            }
        }
    }

    Args { sandbox_root, config }
}

fn print_usage() {
    eprintln!(
        "Usage: relay-free-harness [--sandbox-root PATH] [--mnemonic PHRASE] [--pin PIN]\n\n\
         Builds populated per-account storage under PATH (or $PACTO_TEST_SANDBOX_ROOT) with zero \
         network calls, through the real ingest path."
    );
}

#[tokio::main]
async fn main() {
    let Args { sandbox_root, config } = parse_args();
    if let Some(root) = sandbox_root {
        std::env::set_var("PACTO_TEST_SANDBOX_ROOT", root);
    }

    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("failed to build the mock Tauri app for the relay-free harness");
    let handle = app.handle().clone();

    match harness::run(&handle, config).await {
        Ok(report) => {
            if report.already_seeded {
                println!(
                    "[relay-free-harness] {} already seeded; nothing to do.",
                    report.npub
                );
            } else {
                println!(
                    "[relay-free-harness] Seeded npub={} dm_messages={} squad_group_id={:?} \
                     attachments_skip_reason={:?}",
                    report.npub,
                    report.dm_messages_seeded,
                    report.squad_group_id,
                    report.attachments_skip_reason
                );
            }
        }
        Err(e) => {
            eprintln!("[relay-free-harness] FAILED: {e}");
            std::process::exit(1);
        }
    }
}
