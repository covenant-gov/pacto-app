//! Machine-readable record of where a sandbox actually landed (U3): its
//! resolved port set, sandbox root, relay/chain endpoints, and identity —
//! so an agent discovers connection details instead of assuming defaults.
//! Written only when a sandbox root is configured; a plain `make dev` on
//! `main` writes nothing.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

const HANDLE_FILE_NAME: &str = "sandbox-handle.json";
const HANDLE_VERSION: u32 = 1;

const DEFAULT_DEV_SERVER_PORT: u16 = 1420;
const DEFAULT_HMR_PORT: u16 = 1421;
const DEFAULT_MCP_BRIDGE_PORT: u16 = 9223;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HandlePorts {
    #[serde(rename = "devServer")]
    dev_server: u16,
    hmr: u16,
    #[serde(rename = "mcpBridge")]
    mcp_bridge: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SandboxHandle {
    version: u32,
    #[serde(rename = "portIndex")]
    port_index: u32,
    ports: HandlePorts,
    #[serde(rename = "sandboxRoot")]
    sandbox_root: String,
    #[serde(rename = "relayEndpoints")]
    relay_endpoints: Vec<String>,
    #[serde(rename = "chainEndpoint")]
    chain_endpoint: Option<String>,
    #[serde(rename = "manifestPath")]
    manifest_path: Option<String>,
    npub: Option<String>,
    pid: u32,
    #[serde(rename = "updatedAt")]
    updated_at: String,
}

fn env_parsed<T: std::str::FromStr>(key: &str, default: T) -> T {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn now_rfc3339() -> Result<String, String> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| format!("Failed to format sandbox handle timestamp: {}", e))
}

fn handle_path(root: &std::path::Path) -> PathBuf {
    root.join(HANDLE_FILE_NAME)
}

/// Write (or overwrite) the sandbox handle for the current sandbox root.
/// Returns `Ok(None)` when no sandbox root is configured — a plain `make
/// dev` on `main` must not write a handle or fail. `bound_bridge_port` is
/// the port the MCP bridge plugin actually bound (it scans forward from its
/// configured base), falling back to `PACTO_MCP_BRIDGE_PORT` / the default
/// when the plugin is not running (e.g. release builds never reach here).
///
/// Called before the Tauri app is built, so an orchestrator finds the handle
/// even when window or webview creation stalls on a headless host.
pub(crate) fn write_handle(bound_bridge_port: Option<u16>) -> Result<Option<PathBuf>, String> {
    let Some(root) = crate::test_sandbox::sandbox_root() else {
        return Ok(None);
    };

    std::fs::create_dir_all(&root)
        .map_err(|e| format!("Failed to create sandbox root {}: {}", root.display(), e))?;

    let mcp_bridge = bound_bridge_port
        .unwrap_or_else(|| env_parsed("PACTO_MCP_BRIDGE_PORT", DEFAULT_MCP_BRIDGE_PORT));

    let handle = SandboxHandle {
        version: HANDLE_VERSION,
        port_index: env_parsed("PACTO_DEV_PORT_INDEX", 0),
        ports: HandlePorts {
            dev_server: env_parsed("PACTO_DEV_PORT", DEFAULT_DEV_SERVER_PORT),
            hmr: env_parsed("PACTO_DEV_HMR_PORT", DEFAULT_HMR_PORT),
            mcp_bridge,
        },
        sandbox_root: root.display().to_string(),
        relay_endpoints: crate::trusted_relays::trusted_relays()
            .iter()
            .map(|r| r.to_string())
            .collect(),
        chain_endpoint: std::env::var("PACTO_CHAIN_RPC_URL").ok(),
        // Wave 2 (U6) introduces the manifest; nothing writes a path yet.
        manifest_path: None,
        npub: None,
        pid: std::process::id(),
        updated_at: now_rfc3339()?,
    };

    let path = handle_path(&root);
    let json = serde_json::to_string_pretty(&handle)
        .map_err(|e| format!("Failed to serialize sandbox handle: {}", e))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("Failed to write sandbox handle {}: {}", path.display(), e))?;

    Ok(Some(path))
}

/// Merge `npub` into the existing handle for the current sandbox root.
/// A no-op `Ok(())` when there is no sandbox root or no handle yet — the
/// identity is recorded once login succeeds, which happens after boot.
#[cfg(debug_assertions)]
pub(crate) fn record_npub(npub: &str) -> Result<(), String> {
    let Some(root) = crate::test_sandbox::sandbox_root() else {
        return Ok(());
    };
    let path = handle_path(&root);

    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => {
            return Err(format!(
                "Failed to read sandbox handle {}: {}",
                path.display(),
                e
            ))
        }
    };

    let mut handle: SandboxHandle = serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse sandbox handle {}: {}", path.display(), e))?;
    handle.npub = Some(npub.to_string());
    handle.updated_at = now_rfc3339()?;

    let json = serde_json::to_string_pretty(&handle)
        .map_err(|e| format!("Failed to serialize sandbox handle: {}", e))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("Failed to write sandbox handle {}: {}", path.display(), e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    static ENV_TEST_MUTEX: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

    struct EnvVarGuard {
        keys: Vec<&'static str>,
    }

    impl EnvVarGuard {
        fn set(keys: &[(&'static str, &str)]) -> Self {
            for (key, value) in keys {
                std::env::set_var(key, value);
            }
            Self {
                keys: keys.iter().map(|(k, _)| *k).collect(),
            }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            for key in &self.keys {
                std::env::remove_var(key);
            }
        }
    }

    fn temp_sandbox_root(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("pacto-sandbox-handle-test-{label}-{nanos}"));
        std::fs::create_dir_all(&root).expect("create temp sandbox root");
        root
    }

    #[test]
    fn handle_round_trips_written_values() {
        let _guard = ENV_TEST_MUTEX.lock();
        let root = temp_sandbox_root("round-trip");
        let _env = EnvVarGuard::set(&[
            ("PACTO_TEST_SANDBOX_ROOT", root.to_str().unwrap()),
            ("PACTO_DEV_PORT_INDEX", "3"),
            ("PACTO_DEV_PORT", "1450"),
            ("PACTO_DEV_HMR_PORT", "1451"),
        ]);

        let written = write_handle(Some(9523))
            .expect("write_handle succeeds")
            .expect("handle written when sandbox root is set");

        let raw = std::fs::read_to_string(&written).expect("read written handle");
        let parsed: SandboxHandle = serde_json::from_str(&raw).expect("parse written handle");

        assert_eq!(parsed.version, 1);
        assert_eq!(parsed.port_index, 3);
        assert_eq!(parsed.ports.dev_server, 1450);
        assert_eq!(parsed.ports.hmr, 1451);
        assert_eq!(parsed.ports.mcp_bridge, 9523);
        assert_eq!(parsed.npub, None);

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn missing_sandbox_root_writes_nothing() {
        let _guard = ENV_TEST_MUTEX.lock();
        std::env::remove_var("PACTO_TEST_SANDBOX_ROOT");

        let result = write_handle(Some(9223)).expect("write_handle succeeds");
        assert!(result.is_none());
    }

    #[test]
    fn record_npub_merges_into_existing_handle_preserving_other_fields() {
        let _guard = ENV_TEST_MUTEX.lock();
        let root = temp_sandbox_root("record-npub");
        let _env = EnvVarGuard::set(&[
            ("PACTO_TEST_SANDBOX_ROOT", root.to_str().unwrap()),
            ("PACTO_DEV_PORT_INDEX", "7"),
            ("PACTO_DEV_PORT", "1490"),
            ("PACTO_DEV_HMR_PORT", "1491"),
        ]);

        write_handle(Some(9923)).expect("write_handle succeeds");

        record_npub("npub1sandboxhandletest").expect("record_npub succeeds");

        let raw = std::fs::read_to_string(handle_path(&root)).expect("read handle after merge");
        let parsed: SandboxHandle = serde_json::from_str(&raw).expect("parse merged handle");

        assert_eq!(parsed.npub, Some("npub1sandboxhandletest".to_string()));
        assert_eq!(parsed.port_index, 7);
        assert_eq!(parsed.ports.dev_server, 1490);
        assert_eq!(parsed.ports.mcp_bridge, 9923);

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn record_npub_is_a_noop_without_a_handle() {
        let _guard = ENV_TEST_MUTEX.lock();
        let root = temp_sandbox_root("record-npub-noop");
        let _env = EnvVarGuard::set(&[("PACTO_TEST_SANDBOX_ROOT", root.to_str().unwrap())]);

        record_npub("npub1shouldnotpersist").expect("no-op when no handle exists");
        assert!(!handle_path(&root).exists());

        std::fs::remove_dir_all(&root).ok();
    }
}
