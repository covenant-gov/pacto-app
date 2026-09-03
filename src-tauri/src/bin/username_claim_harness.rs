//! Local-only Sepolia username claim harness (not CI).
//!
//! ```text
//! cargo run --bin username_claim_harness --features username-claim-harness
//! ```
//!
//! Requires `ALCHEMY_RPC_KEY` + `PIMLICO_API_KEY` in pacto-app `.env`.

use pacto_lib::username_claim_harness;

#[tokio::main]
async fn main() {
    if let Err(e) = username_claim_harness::run(std::env::args()).await {
        eprintln!("[username_claim_harness] FAILED: {e}");
        std::process::exit(1);
    }
}
