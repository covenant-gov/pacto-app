//! Thin entry point for the relay-free seeding harness.
//!
//! No Tauri IPC and no window: a `tauri::test` mock app handle serves purely
//! as a path resolver, which the sandbox-root override in
//! `test_sandbox::sandbox_root` already bypasses whenever
//! `PACTO_TEST_SANDBOX_ROOT` is set. All real work lives in
//! `pacto_lib::harness`; see that module for the seeding logic itself.
//!
//! Usage:
//! `relay-free-harness [--sandbox-root PATH] [--pin PIN] [--allow-non-fixture-mnemonic]`
//!
//! Mnemonic resolution prefers `PACTO_DEV_LOGIN_MNEMONIC` (never printed). The
//! `--mnemonic` flag is accepted only for the well-known fixture phrase, or for
//! any phrase when `--allow-non-fixture-mnemonic` /
//! `PACTO_HARNESS_ALLOW_NON_FIXTURE_MNEMONIC=1` is set. Prefer the env var so a
//! real phrase never lands on argv / `ps` / shell history.

use pacto_lib::harness::{self, HarnessConfig, DEFAULT_MNEMONIC};

struct Args {
    sandbox_root: Option<String>,
    config: HarnessConfig,
}

fn env_flag(name: &str) -> bool {
    matches!(
        std::env::var(name).ok().as_deref().map(str::trim),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
    )
}

fn resolve_mnemonic(cli_mnemonic: Option<String>) -> String {
    if let Ok(from_env) = std::env::var("PACTO_DEV_LOGIN_MNEMONIC") {
        let trimmed = from_env.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    cli_mnemonic.unwrap_or_else(|| DEFAULT_MNEMONIC.to_string())
}

fn parse_args() -> Args {
    let mut sandbox_root: Option<String> = None;
    let mut cli_mnemonic: Option<String> = None;
    let mut pin = harness::DEFAULT_PIN.to_string();
    let mut allow_non_fixture_mnemonic = env_flag("PACTO_HARNESS_ALLOW_NON_FIXTURE_MNEMONIC");
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
                cli_mnemonic = Some(args.next().unwrap_or_else(|| {
                    eprintln!("--mnemonic requires a phrase argument");
                    std::process::exit(2);
                }));
            }
            "--pin" => {
                pin = args.next().unwrap_or_else(|| {
                    eprintln!("--pin requires a PIN argument");
                    std::process::exit(2);
                });
            }
            "--allow-non-fixture-mnemonic" => {
                allow_non_fixture_mnemonic = true;
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

    let config = HarnessConfig {
        mnemonic: resolve_mnemonic(cli_mnemonic),
        pin,
        allow_non_fixture_mnemonic,
    };

    Args {
        sandbox_root,
        config,
    }
}

fn print_usage() {
    eprintln!(
        "Usage: relay-free-harness [--sandbox-root PATH] [--pin PIN] [--allow-non-fixture-mnemonic]\n\n\
         Builds populated per-account storage under PATH (or $PACTO_TEST_SANDBOX_ROOT) with zero \
         network calls, through the real ingest path.\n\n\
         Mnemonic: defaults to the public Anvil/Hardhat fixture. Prefer \
         PACTO_DEV_LOGIN_MNEMONIC over --mnemonic so the phrase never appears on argv. \
         A non-fixture phrase requires --allow-non-fixture-mnemonic (or \
         PACTO_HARNESS_ALLOW_NON_FIXTURE_MNEMONIC=1). The phrase is never printed.\n\n\
         Opening a seeded DB in the live app still requires PACTO_TRUSTED_RELAYS \
         (local) and PACTO_DEV_IDENTITY_SANDBOX_ONLY=1 (or the on-disk sandbox-only stamp)."
    );
}

#[tokio::main]
async fn main() {
    let Args {
        sandbox_root,
        config,
    } = parse_args();
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
