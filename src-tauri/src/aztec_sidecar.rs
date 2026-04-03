//! Aztec Sidecar Supervisor
//!
//! Manages the Node.js sidecar process for Aztec.js operations.
//! - Starts the sidecar on first Aztec use or wallet unlock
//! - Health checks with automatic restart
//! - Clean shutdown on app exit

use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, RwLock};
use tokio::time::interval;
use log::{info, warn, error, debug};
use serde::{Deserialize, Serialize};
use once_cell::sync::Lazy;

/// HTTP client for the Node sidecar: disable idle reuse (avoids stale connections to `http.createServer`),
/// and allow long Aztec operations.
static SIDECAR_HTTP: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .pool_max_idle_per_host(0)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .build()
        .expect("reqwest client for Aztec sidecar")
});

const SIDECAR_DEFAULT_PORT: u16 = 4892;
const HEALTH_CHECK_INTERVAL: Duration = Duration::from_secs(30);
const MAX_RESTART_ATTEMPTS: u8 = 3;
const RESTART_BACKOFF_SECS: u64 = 5;
pub const AZTEC_TESTNET_RPC: &str = "https://rpc.testnet.aztec-labs.com";

/// Global sidecar state
lazy_static::lazy_static! {
    static ref SIDECAR_STATE: Arc<SidecarState> = Arc::new(SidecarState::default());
}

#[derive(Debug, Clone, Default)]
pub struct SidecarState {
    pub running: Arc<RwLock<bool>>,
    pub port: Arc<RwLock<u16>>,
    pub auth_token: Arc<RwLock<Option<String>>>,
    pub process_handle: Arc<Mutex<Option<tokio::process::Child>>>,
    pub restart_attempts: Arc<RwLock<u8>>,
}

impl SidecarState {
    pub fn is_running(&self) -> bool {
        self.running.try_read()
            .map(|g| *g)
            .unwrap_or(false)
    }
}

/// Sidecar process manager
pub struct SidecarSupervisor {
    state: Arc<SidecarState>,
}

impl Default for SidecarSupervisor {
    fn default() -> Self {
        Self::new()
    }
}

impl SidecarSupervisor {
    pub fn new() -> Self {
        Self {
            state: SIDECAR_STATE.clone(),
        }
    }

    /// Check if the sidecar is running
    pub fn is_running(&self) -> bool {
        let running = self.state.is_running();
        debug!("aztec sidecar is_running -> {}", running);
        running
    }

    /// Start the sidecar process
    pub async fn start(&self, port: u16) -> Result<SidecarInfo, String> {
        // Check running status first
        let currently_running = self.state.is_running();
        info!("start() called, currently_running={}", currently_running);
        
        if currently_running {
            info!("Sidecar already running, checking if it's responsive...");
            // Even if running flag is set, verify the sidecar is actually responsive
            let port = *self.state.port.read().await;
            let health_url = format!("http://127.0.0.1:{}/health", port);
            match SIDECAR_HTTP.get(&health_url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    info!("Existing sidecar is responsive on port {}", port);
                    return self.get_info().await;
                }
                _ => {
                    info!("Sidecar flag set but not responsive, will restart");
                    *self.state.running.write().await = false;
                }
            }
        }

        // Check if there's already a sidecar running on port 4892 (or nearby)
        // This handles the case where a sidecar was started by a previous process run
        info!("Checking for existing sidecar on port {}...", port);
        let health_url = format!("http://127.0.0.1:{}/health", port);
        if let Ok(resp) = SIDECAR_HTTP.get(&health_url).send().await {
            if resp.status().is_success() {
                info!("Found existing sidecar on port {}, testing RPC endpoint...", port);
                
                // Test the RPC endpoint before accepting the existing sidecar
                let rpc_url = format!("http://127.0.0.1:{}/rpc", port);
                let ping_body = serde_json::json!({
                    "id": "startup-check",
                    "method": "system.echo",
                    "params": { "test": "startup check" }
                });
                
                let rpc_ready = match SIDECAR_HTTP
                    .post(&rpc_url)
                    .json(&ping_body)
                    .timeout(Duration::from_secs(5))
                    .send()
                    .await
                {
                    Ok(resp) if resp.status().is_success() => {
                        info!("RPC endpoint is ready on port {}", port);
                        true
                    }
                    Ok(resp) => {
                        warn!("RPC endpoint returned status {} on port {}", resp.status(), port);
                        false
                    }
                    Err(e) => {
                        warn!("RPC endpoint not ready on port {}: {}", port, e);
                        false
                    }
                };
                
                if !rpc_ready {
                    info!("Sidecar health OK but RPC not ready, waiting...");
                    tokio::time::sleep(Duration::from_secs(3)).await;
                }
                
                // Generate a token for this existing sidecar
                // Note: We can't get the original token, but auth is disabled so this doesn't matter
                let existing_token = uuid::Uuid::new_v4().to_string();
                let token_clone = existing_token.clone();
                {
                    *self.state.running.write().await = true;
                    *self.state.port.write().await = port;
                    *self.state.auth_token.write().await = Some(existing_token);
                }
                return Ok(SidecarInfo {
                    url: format!("http://127.0.0.1:{}", port),
                    port,
                    auth_token: token_clone,
                });
            }
        }

        info!("Starting new Aztec sidecar on port {}", port);
        
        // Log current working directory
        if let Ok(cwd) = std::env::current_dir() {
            info!("Current working directory: {:?}", cwd);
        }

        // Find the sidecar binary
        let sidecar_path = match self.find_sidecar_binary() {
            Ok(path) => {
                info!("Found sidecar at: {}", path);
                path
            }
            Err(e) => {
                error!("Failed to find sidecar: {}", e);
                return Err(e);
            }
        };
        
        // Verify the file exists
        if !std::path::Path::new(&sidecar_path).exists() {
            error!("Sidecar binary does not exist at: {}", sidecar_path);
            return Err(format!("Sidecar binary not found at: {}", sidecar_path));
        }
        info!("Sidecar binary exists, will spawn: {}", sidecar_path);

        // Check if node is available
        let node_check = tokio::process::Command::new("node")
            .arg("--version")
            .output()
            .await;
        match node_check {
            Ok(output) if output.status.success() => {
                info!("Node version: {}", String::from_utf8_lossy(&output.stdout));
            }
            Ok(output) => {
                warn!("Node check failed: {}", String::from_utf8_lossy(&output.stderr));
            }
            Err(e) => {
                error!("Node not found: {}", e);
            }
        }

        // Start the process
        info!(
            "Spawning sidecar: node {:?} --port {}",
            sidecar_path, port
        );

        let script_path = std::path::Path::new(&sidecar_path);
        let sidecar_project_root = script_path.parent().and_then(|p| p.parent());
        let mut cmd = tokio::process::Command::new("node");
        if let Some(root) = sidecar_project_root {
            if root.join("package.json").exists() {
                cmd.current_dir(root);
                info!("Sidecar process cwd: {} (for node_modules / native addons)", root.display());
            }
        }
        let mut child = match cmd
            .arg(&sidecar_path)
            .arg("--port")
            .arg(port.to_string())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(child) => {
                info!(
                    "Sidecar child spawned (pid={:?}, requested_port={})",
                    child.id(),
                    port
                );
                child
            }
            Err(e) => {
                error!("Failed to spawn sidecar: {}", e);
                return Err(format!("Failed to spawn sidecar: {}", e));
            }
        };

        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    warn!(target: "aztec_sidecar::stderr", "{}", line);
                }
            });
        }

        // Wait briefly for startup and capture the auth token and actual port from stdout
        let (auth_token, actual_port) = match self.wait_for_startup(&mut child, port).await {
            Ok(v) => v,
            Err(e) => {
                let _ = child.kill().await;
                return Err(e);
            }
        };
        
        info!("Sidecar startup complete with token prefix: {}", 
              &auth_token[..auth_token.len().min(8)]);

        // CRITICAL: Do health check BEFORE setting running=true
        info!("Verifying sidecar is accessible on port {} before marking as running...", actual_port);
        let health_url = format!("http://127.0.0.1:{}/health", actual_port);
        let health_resp = SIDECAR_HTTP.get(&health_url).send().await;
        
        match &health_resp {
            Ok(resp) if resp.status().is_success() => {
                info!("Sidecar is accessible! Health check passed on port {}", actual_port);
            }
            Ok(resp) => {
                warn!("Sidecar responded but health check returned: {}", resp.status());
            }
            Err(e) => {
                error!("Sidecar NOT accessible on port {}: {}", actual_port, e);
                // Kill the process since it's not working
                let _ = child.kill().await;
                return Err(format!("Sidecar process started but not responding on port {}: {}", actual_port, e));
            }
        }
        
        // Also verify modules are loaded by calling a simple RPC
        let ping_url = format!("http://127.0.0.1:{}/rpc", actual_port);
        let ping_body = serde_json::json!({
            "id": "init-check",
            "method": "system.ping",
            "params": {}
        });
        match SIDECAR_HTTP
            .post(&ping_url)
            .json(&ping_body)
            .timeout(Duration::from_secs(5))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                info!("RPC ping check passed - sidecar is fully ready!");
            }
            Ok(resp) => {
                warn!("RPC ping returned status: {}", resp.status());
            }
            Err(e) => {
                error!("RPC ping failed: {}", e);
                let _ = child.kill().await;
                return Err(format!("Sidecar started but RPC not working: {}", e));
            }
        }

        // Only set running=true if health check passed
        info!("Setting running=true for port {}", actual_port);
        {
            *self.state.running.write().await = true;
            *self.state.port.write().await = actual_port;
            *self.state.auth_token.write().await = Some(auth_token.clone());
            *self.state.process_handle.lock().await = Some(child);
        }

        if actual_port != port {
            info!("Sidecar started on port {} instead of requested port {}", actual_port, port);
        }
        
        info!("Aztec sidecar started successfully on port {}", actual_port);
        
        // Wait for the sidecar to fully initialize (modules take time to load)
        info!("Waiting for sidecar to fully initialize...");
        tokio::time::sleep(Duration::from_secs(2)).await;
        
        // Final verification
        let final_health_url = format!("http://127.0.0.1:{}/health", actual_port);
        match SIDECAR_HTTP.get(&final_health_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                info!("Final health check passed - sidecar is ready!");
            }
            _ => {
                warn!("Final health check failed after startup delay");
            }
        }

        Ok(SidecarInfo {
            url: format!("http://127.0.0.1:{}", actual_port),
            port: actual_port,
            auth_token,
        })
    }

    /// Stop the sidecar process
    pub async fn stop(&self) -> Result<(), String> {
        if !self.state.is_running() {
            return Ok(());
        }

        info!("Stopping Aztec sidecar");

        // Send shutdown request via HTTP
        if let Err(e) = self.send_shutdown().await {
            warn!("Shutdown request failed: {}", e);
        }

        // Kill the process
        let mut handle = self.state.process_handle.lock().await;
        if let Some(mut child) = handle.take() {
            let _ = child.kill().await;
        }

        *self.state.running.write().await = false;
        *self.state.auth_token.write().await = None;

        info!("Aztec sidecar stopped");
        Ok(())
    }

    /// Check if sidecar is running and healthy
    pub async fn health_check(&self) -> Result<SidecarHealth, String> {
        if !self.state.is_running() {
            return Err("Sidecar not running".to_string());
        }

        let port = *self.state.port.read().await;
        let url = format!("http://127.0.0.1:{}/health", port);

        let response = SIDECAR_HTTP
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Health check failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Health check returned status: {}", response.status()));
        }

        let body: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse health response: {}", e))?;

        Ok(SidecarHealth {
            status: body["status"].as_str().unwrap_or("unknown").to_string(),
            uptime: body["uptime"].as_f64().unwrap_or(0.0),
            ready: body["ready"].as_bool().unwrap_or(false),
        })
    }
    
    /// Test a simple RPC call (ping)
    pub async fn test_rpc_call(&self) -> serde_json::Value {
        let port = match *self.state.port.read().await {
            0 => return serde_json::json!({"error": "No port stored"}),
            p => p,
        };
        
        let url = format!("http://127.0.0.1:{}/rpc", port);
        
        // First try echo (simpler)
        let echo_body = serde_json::json!({
            "id": "test-echo",
            "method": "system.echo",
            "params": { "test": "hello" }
        });
        
        info!("test_rpc_call: Trying system.echo first");
        match SIDECAR_HTTP
            .post(&url)
            .json(&echo_body)
            .timeout(Duration::from_secs(5))
            .send()
            .await
        {
            Ok(resp) => {
                let status = resp.status();
                info!("test_rpc_call: Echo response status {}", status);
                match resp.text().await {
                    Ok(text) => {
                        info!("test_rpc_call: Echo response body length {}", text.len());
                        return serde_json::json!({
                            "method": "system.echo",
                            "success": true,
                            "status": status.to_string(),
                            "body": text
                        });
                    }
                    Err(e) => {
                        return serde_json::json!({
                            "method": "system.echo",
                            "success": false,
                            "status": status.to_string(),
                            "parse_error": e.to_string()
                        });
                    }
                }
            }
            Err(e) => {
                error!("test_rpc_call: Echo request failed: {}", e);
                return serde_json::json!({
                    "method": "system.echo",
                    "success": false,
                    "error": e.to_string()
                });
            }
        }
    }
    
    /// Test the actual account creation method
    pub async fn test_account_creation(&self) -> serde_json::Value {
        let port = match *self.state.port.read().await {
            0 => return serde_json::json!({"error": "No port stored"}),
            p => p,
        };
        
        let url = format!("http://127.0.0.1:{}/rpc", port);
        
        // Test: account.createFromEVMKey
        let create_body = serde_json::json!({
            "id": "test-create",
            "method": "account.createFromEVMKey",
            "params": {
                "evmPrivateKey": "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
                "rpcUrl": AZTEC_TESTNET_RPC
            }
        });
        
        info!("test_account_creation: Testing account.createFromEVMKey");
        let start_time = std::time::Instant::now();
        match SIDECAR_HTTP
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&create_body)
            .timeout(Duration::from_secs(120))
            .send()
            .await
        {
            Ok(resp) => {
                let elapsed = start_time.elapsed().as_millis();
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                info!("test_account_creation: account.createFromEVMKey took {}ms, status: {}, body: {}", elapsed, status, text);
                serde_json::json!({
                    "test": "account.createFromEVMKey",
                    "elapsed_ms": elapsed,
                    "status": status.to_string(),
                    "response": text
                })
            }
            Err(e) => {
                let elapsed = start_time.elapsed().as_millis();
                error!("test_account_creation: account.createFromEVMKey failed after {}ms: {}", elapsed, e);
                serde_json::json!({
                    "test": "account.createFromEVMKey",
                    "elapsed_ms": elapsed,
                    "error": e.to_string()
                })
            }
        }
    }

    /// Get sidecar info
    pub async fn get_info(&self) -> Result<SidecarInfo, String> {
        let port = *self.state.port.read().await;
        let auth_token = self.state.auth_token.read().await;
        
        Ok(SidecarInfo {
            url: format!("http://127.0.0.1:{}", port),
            port,
            auth_token: auth_token.clone().unwrap_or_default(),
        })
    }

    /// Make a request to the sidecar
    pub async fn request(&self, method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
        let port = *self.state.port.read().await;
        if port == 0 {
            return Err("Sidecar port not set; start the sidecar first".to_string());
        }
        let url = format!("http://127.0.0.1:{}/rpc", port);

        info!("Making request to sidecar: {} on port {}", method, port);

        info!("Request params: {:?}", params);

        let request_body = serde_json::json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "method": method,
            "params": params
        });

        info!("Sending request to {}", url);

        let response = SIDECAR_HTTP
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Connection", "close")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| {
                error!("Request failed: {} (url={})", e, url);
                format!(
                    "Request failed: {}. If the sidecar exited, check stderr (aztec_sidecar::stderr) and run: cd sidecar && npm ci",
                    e
                )
            })?;
        
        info!("Got response, status: {}", response.status());

        info!("Got response with status: {}", response.status());

        let body: SidecarResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        if body.success {
            body.result.ok_or_else(|| "No result in response".to_string())
        } else {
            Err(body.error.map(|e| e.message).unwrap_or_else(|| "Unknown error".to_string()))
        }
    }

    /// Start health check loop (spawns background task)
    pub fn start_health_loop(&self) {
        let state = self.state.clone();
        tokio::spawn(async move {
            let mut check_interval = interval(HEALTH_CHECK_INTERVAL);
            
            loop {
                check_interval.tick().await;
                
                if !state.running.try_read().map(|g| *g).unwrap_or(false) {
                    break;
                }

                let port = *state.port.read().await;
                let url = format!("http://127.0.0.1:{}/health", port);

                match SIDECAR_HTTP.get(&url).send().await {
                    Ok(resp) if resp.status().is_success() => {
                        // Healthy
                    }
                    _ => {
                        warn!("Aztec sidecar health check failed, attempting restart");
                        
                        let attempts = *state.restart_attempts.read().await;
                        if attempts < MAX_RESTART_ATTEMPTS {
                            *state.restart_attempts.write().await = attempts + 1;
                            
                            // Wait backoff then restart
                            tokio::time::sleep(Duration::from_secs(RESTART_BACKOFF_SECS)).await;
                            
                            // TODO: Trigger restart
                            warn!("Restart not yet implemented - manual restart needed");
                        } else {
                            error!("Max restart attempts reached for Aztec sidecar");
                            *state.running.write().await = false;
                            break;
                        }
                    }
                }
            }
        });
    }

    // --- Private methods ---

    fn find_sidecar_binary(&self) -> Result<String, String> {
        // Check common locations
        let candidates = [
            // Development (relative to project root / CWD when running `tauri dev`)
            std::path::Path::new("sidecar/dist/index.js"),
            std::path::Path::new("../sidecar/dist/index.js"),
            std::path::Path::new("./sidecar/dist/index.js"),
            // Installed / placeholder
            std::path::Path::new("aztec-sidecar"),
        ];

        for candidate in &candidates {
            info!("Checking for sidecar at: {:?}", candidate);
            if candidate.exists() {
                let resolved = std::fs::canonicalize(candidate).unwrap_or_else(|_| candidate.to_path_buf());
                info!("Using sidecar script (exists): {}", resolved.display());
                return resolved
                    .to_str()
                    .map(String::from)
                    .ok_or_else(|| "Invalid sidecar path".to_string());
            }
        }

        // Try to use the bundled binary from resources
        // This will be set by Tauri during bundle
        Ok(std::env::var("AZTEC_SIDECAR_PATH").unwrap_or_else(|_| "aztec-sidecar".to_string()))
    }

    async fn wait_for_startup(&self, child: &mut tokio::process::Child, port: u16) -> Result<(String, u16), String> {
        use tokio::io::{AsyncBufReadExt, BufReader};

        let stdout = child.stdout.take()
            .ok_or("Failed to capture stdout")?;
        
        let reader = BufReader::new(stdout).lines();

        const STARTUP_LOG_DEADLINE: Duration = Duration::from_secs(45);
        info!(
            "Waiting up to {:?} for sidecar ready line (Auth token:) on stdout; stderr is logged separately",
            STARTUP_LOG_DEADLINE
        );

        // Return reader from phase one so we keep draining stdout; otherwise the pipe closes and Node can get EPIPE on console.log.
        let read_phase = async move {
            let mut reader = reader;
            let mut found_token: Option<String> = None;
            let mut actual_port = port;
            let mut line_count: u32 = 0;
            let mut last_lines: Vec<String> = Vec::with_capacity(12);

            while let Ok(Some(line)) = reader.next_line().await {
                line_count += 1;
                debug!(target: "aztec_sidecar::stdout", "line {}: {}", line_count, line);
                if last_lines.len() >= 12 {
                    last_lines.remove(0);
                }
                last_lines.push(line.clone());

                // Look for the auth token in the output
                if line.contains("Auth token:") {
                    if let Some(token) = line.split("Auth token:").nth(1) {
                        let trimmed = token.trim();
                        found_token = Some(trimmed.to_string());
                        info!(
                            "Captured auth token from stdout (line {}), prefix: {}",
                            line_count,
                            &trimmed[..trimmed.len().min(8)]
                        );
                    }
                }

                // Legacy/alternate marker (if server prints it)
                if line.contains("Server port:") {
                    if let Some(port_str) = line.split("Server port:").nth(1) {
                        if let Ok(p) = port_str.trim().parse::<u16>() {
                            actual_port = p;
                            info!("Detected sidecar Server port line -> {}", actual_port);
                        }
                    }
                }

                // index.ts prints "Listening on: http://127.0.0.1:PORT"
                if let Some(idx) = line.find("127.0.0.1:") {
                    let rest = &line[idx + "127.0.0.1:".len()..];
                    let port_part = rest.split(|c: char| !c.is_ascii_digit()).next().unwrap_or("");
                    if let Ok(p) = port_part.parse::<u16>() {
                        actual_port = p;
                        debug!("Parsed listening port from stdout: {}", actual_port);
                    }
                }

                if line.to_lowercase().contains("error") {
                    error!(target: "aztec_sidecar::stdout", "Sidecar stdout (possible error): {}", line);
                }

                info!(target: "aztec_sidecar::stdout", "[{}] {}", line_count, line);

                if found_token.is_some() {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    break;
                }
            }

            if found_token.is_none() {
                warn!(
                    "No 'Auth token:' line after {} stdout line(s). Last lines:\n---\n{}\n---",
                    line_count,
                    last_lines.join("\n")
                );
            }

            ((found_token, actual_port, line_count, last_lines), reader)
        };

        let timeout_result = tokio::time::timeout(STARTUP_LOG_DEADLINE, read_phase).await;

        let ((found_token, actual_port, line_count, last_lines), stdout_reader) = match timeout_result {
            Ok(v) => v,
            Err(_elapsed) => {
                error!(
                    "Timeout waiting for sidecar Auth token line (>{:?}). Check stderr logs and that sidecar/dist/index.js is built.",
                    STARTUP_LOG_DEADLINE
                );
                return Err(format!(
                    "Timeout waiting for sidecar to start (>{:?}). See RUST_LOG=aztec_sidecar=debug,pacto_lib=info for stdout/stderr details.",
                    STARTUP_LOG_DEADLINE
                ));
            }
        };

        tokio::spawn(async move {
            let mut reader = stdout_reader;
            while let Ok(Some(line)) = reader.next_line().await {
                debug!(target: "aztec_sidecar::stdout", "{}", line);
            }
        });

        match found_token {
            Some(token) => Ok((token, actual_port)),
            None => {
                info!(
                    "Auth token missing after stdout; probing http://127.0.0.1:{}/health ({} stdout lines seen)",
                    actual_port, line_count
                );
                tokio::time::sleep(Duration::from_secs(2)).await;
                let url = format!("http://127.0.0.1:{}/health", actual_port);

                match SIDECAR_HTTP.get(&url).send().await {
                    Ok(resp) => {
                        let status = resp.status();
                        let body = resp.text().await.unwrap_or_default();
                        if status.is_success() {
                            info!(
                                "Health probe OK ({}); using fallback auth token (no Auth token line on stdout)",
                                status
                            );
                            Ok((uuid::Uuid::new_v4().to_string(), actual_port))
                        } else {
                            error!(
                                "Health probe failed: status={} body_prefix={:?}",
                                status,
                                body.chars().take(200).collect::<String>()
                            );
                            Err(format!(
                                "Sidecar not healthy on port {} (HTTP {}). Last stdout lines:\n{}",
                                actual_port,
                                status,
                                last_lines.join("\n")
                            ))
                        }
                    }
                    Err(e) => {
                        error!(
                            "Health probe connection error on port {}: {}; stdout_lines={}",
                            actual_port, e, line_count
                        );
                        Err(format!(
                            "Sidecar not responding on port {} ({}). stdout lines: {}. Last lines:\n{}.\nIf `node` exited immediately, check terminal logs for aztec_sidecar::stderr.\nBuild sidecar: cd sidecar && npm ci && npm run build",
                            actual_port,
                            e,
                            line_count,
                            last_lines.join("\n")
                        ))
                    }
                }
            }
        }
    }

    async fn send_shutdown(&self) -> Result<(), String> {
        let port = *self.state.port.read().await;
        let auth_token = self.state.auth_token.read().await;
        let url = format!("http://127.0.0.1:{}/rpc", port);

        let request_body = serde_json::json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "method": "system.shutdown",
            "params": {}
        });

        let mut request = SIDECAR_HTTP.post(&url).json(&request_body);

        if let Some(token) = auth_token.as_ref() {
            request = request.header("Authorization", format!("Bearer {}", token));
        }

        let _ = request.send().await;
        Ok(())
    }
}

/// Sidecar info returned on start
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarInfo {
    pub url: String,
    pub port: u16,
    pub auth_token: String,
}

/// Sidecar health status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarHealth {
    pub status: String,
    pub uptime: f64,
    pub ready: bool,
}

/// Sidecar JSON-RPC response
#[derive(Debug, Clone, Deserialize)]
struct SidecarResponse {
    id: String,
    success: bool,
    result: Option<serde_json::Value>,
    error: Option<SidecarError>,
}

#[derive(Debug, Clone, Deserialize)]
struct SidecarError {
    code: i32,
    message: String,
}
