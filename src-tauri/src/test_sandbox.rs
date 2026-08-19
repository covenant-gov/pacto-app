use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

/// Subdirectory used for the sandboxed equivalent of `app_data_dir`.
const DATA_SUBPATH: &str = "data";

/// Subdirectory used for the sandboxed equivalent of `app_local_data_dir`.
const LOCAL_SUBPATH: &str = "local";

/// Env var carrying an explicit sandbox root; the single place every
/// sandbox-aware path resolution reads this variable is `sandbox_root()`.
const SANDBOX_ROOT_VAR: &str = "PACTO_TEST_SANDBOX_ROOT";

/// Env var marking a dev-world boot. Set by orchestration, never by a plain
/// `make dev`; startup refuses to proceed under this marker unless a sandbox
/// root also resolved (see `enforce_dev_world_root`).
const DEV_WORLD_MARKER: &str = "PACTO_DEV_WORLD";

/// Filename stamped under `PACTO_TEST_SANDBOX_ROOT` when a recipe-derived /
/// fixture identity was seeded (KD9 / R25). `dev_login` treats its presence
/// like `PACTO_DEV_IDENTITY_SANDBOX_ONLY=1`.
#[cfg(debug_assertions)]
pub const SANDBOX_ONLY_MARKER_FILE: &str = ".pacto_dev_identity_sandbox_only";

/// True when the configured sandbox root carries the sandbox-only identity stamp.
#[cfg(debug_assertions)]
pub fn sandbox_only_identity_stamped() -> bool {
    sandbox_root()
        .map(|root| root.join(SANDBOX_ONLY_MARKER_FILE).is_file())
        .unwrap_or(false)
}

/// Resolve a subpath under the sandbox root, rejecting escapes.
///
/// The root is canonicalized, then the subpath is resolved component-by-component.
/// Any `..`, absolute path, or symlink that escapes the root returns an error.
fn resolve_sandboxed_path(
    root: impl AsRef<Path>,
    subpath: impl AsRef<Path>,
) -> Result<PathBuf, String> {
    let root = root.as_ref();
    if !root.exists() {
        std::fs::create_dir_all(root)
            .map_err(|e| format!("Failed to create sandbox root: {}", e))?;
    }
    let root = root
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize sandbox root: {}", e))?;

    let mut current = root.clone();
    for component in subpath.as_ref().components() {
        match component {
            Component::Normal(part) => {
                current = current.join(part);
                if current.exists() {
                    current = current
                        .canonicalize()
                        .map_err(|e| format!("Failed to canonicalize sandbox subpath: {}", e))?;
                    if !current.starts_with(&root) {
                        return Err("Sandboxed path escapes the root directory".to_string());
                    }
                }
            }
            Component::CurDir => {}
            Component::ParentDir => {
                return Err("Sandboxed subpath must not contain '..'".to_string());
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("Sandboxed subpath must be relative".to_string());
            }
        }
    }

    if !current.starts_with(&root) {
        return Err("Sandboxed path escapes the root directory".to_string());
    }

    Ok(current)
}

/// Returns `PACTO_TEST_SANDBOX_ROOT` when set to a non-blank value, else `None`.
/// A whitespace-only or empty value counts as unset rather than a root of `""`.
pub fn sandbox_root() -> Option<PathBuf> {
    std::env::var(SANDBOX_ROOT_VAR)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

/// True when this process is a dev sandbox and may therefore run beside other
/// instances of the app.
///
/// The single-instance guard is keyed on the app identifier, so it cannot tell
/// two sandboxes apart and would make the second hand its argv to the first and
/// exit. Parallel agent sandboxes are separate accounts in separate data
/// directories, so the guard has to be skipped for them.
///
/// Debug-only by construction: a release build has no sandbox concept to honor
/// here, so it stays single-instance whatever the environment claims.
pub fn multi_instance_allowed() -> bool {
    cfg!(debug_assertions) && sandbox_root().is_some()
}

/// Returns the sandboxed `app_data_dir` when a sandbox root is configured,
/// otherwise delegates to the normal Tauri path.
pub fn test_data_dir<R: Runtime>(handle: &AppHandle<R>) -> Result<PathBuf, String> {
    match sandbox_root() {
        Some(root) => resolve_sandboxed_path(&root, DATA_SUBPATH),
        None => handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {}", e)),
    }
}

/// Returns the sandboxed `app_local_data_dir` when a sandbox root is configured,
/// otherwise delegates to the normal Tauri path.
pub fn test_local_data_dir<R: Runtime>(handle: &AppHandle<R>) -> Result<PathBuf, String> {
    match sandbox_root() {
        Some(root) => resolve_sandboxed_path(&root, LOCAL_SUBPATH),
        None => handle
            .path()
            .app_local_data_dir()
            .map_err(|e| format!("Failed to get app local data dir: {}", e)),
    }
}

/// Refuses a dev-world boot (`PACTO_DEV_WORLD=1`) that has no sandbox root, so it can
/// never fall through to the real OS app-data directory. A no-op when the marker is
/// unset: today's `make dev` behavior, on `main` or any per-branch sandbox, is
/// unchanged whether or not `PACTO_TEST_SANDBOX_ROOT` happens to be set.
///
/// When a root is present, its own placement is validated through the existing
/// `resolve_sandboxed_path` escape check rather than a second validator: the root
/// path is split into its parent and final component, and that pair is fed through
/// `resolve_sandboxed_path` exactly as a subpath would be, so a `..` final component
/// or a symlink whose target escapes the parent is rejected by the same code path
/// `test_data_dir`/`test_local_data_dir` already rely on. A fresh dev-world root
/// legitimately may not exist yet -- `resolve_sandboxed_path` only auto-creates its
/// own `root` argument, never the subpath being checked -- so the directory is
/// created explicitly afterward, once its placement is known to be safe.
pub fn enforce_dev_world_root() -> Result<(), String> {
    if std::env::var(DEV_WORLD_MARKER).unwrap_or_default() != "1" {
        return Ok(());
    }

    let root = sandbox_root().ok_or_else(|| {
        format!(
            "{} is set but {} is not: dev-world refuses to operate on the real OS app-data directory",
            DEV_WORLD_MARKER, SANDBOX_ROOT_VAR
        )
    })?;

    let mut components = root.components();
    let last = components
        .next_back()
        .ok_or_else(|| format!("{} must not be empty", SANDBOX_ROOT_VAR))?;
    let parent = components.as_path();
    let parent = if parent.as_os_str().is_empty() {
        Path::new(".")
    } else {
        parent
    };
    resolve_sandboxed_path(parent, last.as_os_str())?;

    std::fs::create_dir_all(&root)
        .map_err(|e| format!("Failed to create sandbox root {}: {}", root.display(), e))?;

    Ok(())
}

/// Filename of the per-root lockfile that records which live process holds
/// exclusive use of a sandbox root's data.
const LOCK_FILE_NAME: &str = "sandbox.lock";

/// How long a lock is honored after its recorded pid reads as dead, before
/// it is treated as abandoned and reclaimed. Mirrors `isClaimStale` in
/// `scripts/dev-ports.mjs`: a lock is only reclaimed once *both* signals
/// agree it is stale. That script's grace window exists because its typical
/// caller (the Makefile's `dev-ports.mjs --export`) exits within
/// milliseconds, long before the app it kicked off actually binds -- pid
/// liveness alone would reclaim a perfectly live launch. This lock has no
/// such caller: it is acquired directly by the sandbox app's own process
/// and held for its whole run, so a dead pid is already an exact signal;
/// this grace window is a small defensive margin against the read racing
/// the exact instant of process death, not a resolve-to-bind allowance.
const LOCK_STALE_GRACE_MS: u128 = 1_000;

/// Recorded lock-holder identity, the same pid/timestamp shape
/// `scripts/dev-ports.mjs` already uses for its own claim files.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SandboxLockRecord {
    pid: u32,
    #[serde(rename = "acquiredAtMs")]
    acquired_at_ms: u128,
}

/// A live claim on one sandbox root, held for as long as this value stays
/// alive. Drop removes the lockfile, so releasing and relaunching against
/// the same root is immediate and never depends on `LOCK_STALE_GRACE_MS`.
#[derive(Debug)]
pub struct SandboxLaunchLock {
    path: PathBuf,
}

impl Drop for SandboxLaunchLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(unix)]
fn pid_is_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    // SAFETY: signal 0 sends no signal; it only probes existence/permission,
    // the same `kill(pid, 0)` idiom `scripts/dev-ports.mjs` uses.
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    if result == 0 {
        return true;
    }
    // EPERM means the pid exists but is owned by someone else -- still alive.
    std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(not(unix))]
fn pid_is_alive(pid: u32) -> bool {
    // No `kill(pid, 0)`-equivalent probe without an extra dependency on this
    // platform. Treat a recorded holder as alive unless it names this very
    // process, so an unsupported platform fails safe (refuses) instead of
    // guessing at a stranger process's liveness.
    pid != std::process::id()
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

/// True once a recorded lock is safe to reclaim: its pid reads as dead, and
/// it has aged past the grace window.
fn lock_is_stale(record: &SandboxLockRecord, now_ms: u128, grace_ms: u128) -> bool {
    if pid_is_alive(record.pid) {
        return false;
    }
    now_ms.saturating_sub(record.acquired_at_ms) >= grace_ms
}

/// Create `path` and write `record` into it, failing if the file already
/// exists. `O_EXCL`-style atomicity: of any number of processes racing to
/// create the same path, the OS guarantees exactly one `create_new` wins.
fn write_lock_exclusive(path: &Path, record: &SandboxLockRecord) -> std::io::Result<()> {
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    let json = serde_json::to_vec(record).map_err(std::io::Error::other)?;
    file.write_all(&json)
}

/// Missing, unreadable, or mid-write from a racing claimant all read the
/// same as "no live record here".
fn read_lock(path: &Path) -> Option<SandboxLockRecord> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Claims exclusive use of the current sandbox root for this process, so a
/// second launch against a root a live process already holds cannot
/// silently share (and corrupt) its SQLite/MLS store.
///
/// `Ok(None)` in the two cases this guard must never block: no sandbox root
/// is configured (an ordinary, non-sandboxed launch), and a release build --
/// debug-only by construction via `cfg!(debug_assertions)`, exactly like
/// `multi_instance_allowed`, so an environment cannot spoof the guard into
/// existing where the sandbox concept itself does not.
///
/// When a root is configured in a debug build: a live lock refuses, naming
/// the holder pid; a lock whose holder reads as dead (`kill(pid, 0)`,
/// `EPERM` counts as alive) and has aged past the grace window is reclaimed
/// rather than left to wedge the root forever, reusing the exact staleness
/// reasoning `scripts/dev-ports.mjs` already proves out for its own claim
/// files.
pub fn acquire_sandbox_launch_lock() -> Result<Option<SandboxLaunchLock>, String> {
    if !cfg!(debug_assertions) {
        return Ok(None);
    }
    let Some(root) = sandbox_root() else {
        return Ok(None);
    };

    std::fs::create_dir_all(&root)
        .map_err(|e| format!("Failed to create sandbox root {}: {}", root.display(), e))?;
    let root = root
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize sandbox root: {}", e))?;
    let path = root.join(LOCK_FILE_NAME);
    let record = SandboxLockRecord {
        pid: std::process::id(),
        acquired_at_ms: now_ms(),
    };

    if write_lock_exclusive(&path, &record).is_ok() {
        return Ok(Some(SandboxLaunchLock { path }));
    }

    let existing = read_lock(&path);
    let is_live = existing
        .as_ref()
        .map(|r| !lock_is_stale(r, now_ms(), LOCK_STALE_GRACE_MS))
        .unwrap_or(false); // unreadable/corrupt lock is not a live claim: reclaim it
    if let Some(holder) = existing.filter(|_| is_live) {
        return Err(format!(
            "sandbox root {} is already in use by a live process (pid {}) -- stop that process, \
             or delete {} if it is actually gone",
            root.display(),
            holder.pid,
            path.display()
        ));
    }

    // Stale, unreadable, or corrupt: reclaim. The unlink is best-effort --
    // another racer may already have removed it -- the exclusive create
    // right after is what actually decides the single winner.
    let _ = std::fs::remove_file(&path);
    write_lock_exclusive(&path, &record).map_err(|e| {
        format!(
            "sandbox root {} lock contention while reclaiming a stale lock: {}",
            root.display(),
            e
        )
    })?;
    Ok(Some(SandboxLaunchLock { path }))
}

/// Default filename `tauri_plugin_window_state` uses absent an override.
const DEFAULT_WINDOW_STATE_FILENAME: &str = ".window-state.json";

/// FNV-1a, 32-bit -- deterministic and dependency-free, matching the hash
/// `scripts/dev-ports.mjs` already uses to derive its own per-branch values.
fn fnv1a32(input: &str) -> u32 {
    const FNV_OFFSET: u32 = 0x811c_9dc5;
    const FNV_PRIME: u32 = 0x0100_0193;
    input.bytes().fold(FNV_OFFSET, |hash, byte| {
        (hash ^ byte as u32).wrapping_mul(FNV_PRIME)
    })
}

/// Filename to hand `tauri_plugin_window_state::Builder::with_filename`.
///
/// The plugin always saves under the shared `app_config_dir`, which
/// `test_sandbox` does not redirect (only `app_data_dir`/`app_local_data_dir`
/// are sandboxed) -- so, unkeyed, two concurrent sandboxes restore window
/// geometry from the very same file and land stacked on top of each other.
/// Keying the filename itself off the sandbox root fixes that without
/// touching the shared config directory. Debug-only by construction, like
/// `multi_instance_allowed`: a release build has no sandbox root to key on
/// and always gets the plugin's own default.
pub fn window_state_filename() -> String {
    if !cfg!(debug_assertions) {
        return DEFAULT_WINDOW_STATE_FILENAME.to_string();
    }
    match sandbox_root() {
        Some(root) => format!(
            ".window-state-sandbox-{:08x}.json",
            fnv1a32(&root.to_string_lossy())
        ),
        None => DEFAULT_WINDOW_STATE_FILENAME.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Serializes every test below that touches process-global env vars, since the
    /// crate's test binary runs tests on multiple threads.
    static ENV_MUTEX: Mutex<()> = Mutex::new(());

    fn env_lock() -> std::sync::MutexGuard<'static, ()> {
        ENV_MUTEX
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Sets or unsets an env var for the guard's lifetime, restoring whatever was
    /// there beforehand on drop -- including on an early return from a failed assertion.
    struct EnvGuard {
        key: &'static str,
        prev: Option<String>,
    }

    impl EnvGuard {
        fn set(key: &'static str, value: &str) -> Self {
            let prev = std::env::var(key).ok();
            std::env::set_var(key, value);
            Self { key, prev }
        }

        fn unset(key: &'static str) -> Self {
            let prev = std::env::var(key).ok();
            std::env::remove_var(key);
            Self { key, prev }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match &self.prev {
                Some(v) => std::env::set_var(self.key, v),
                None => std::env::remove_var(self.key),
            }
        }
    }

    fn temp_test_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("pacto-test-{}-{}", prefix, nanos));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn redirect_returns_sandboxed_path() {
        let root = temp_test_dir("redirect");
        let resolved = resolve_sandboxed_path(&root, DATA_SUBPATH).unwrap();
        let expected = root.canonicalize().unwrap().join(DATA_SUBPATH);
        assert_eq!(resolved, expected);
    }

    #[test]
    fn rejects_dotdot_in_subpath() {
        let root = temp_test_dir("dotdot");
        let err = resolve_sandboxed_path(&root, "../escape").unwrap_err();
        assert!(err.contains("'..'"), "expected '..' error, got: {}", err);
    }

    #[test]
    #[cfg(unix)]
    fn rejects_symlink_escape() {
        use std::os::unix::fs::symlink;

        let root = temp_test_dir("symlink-root");
        let outside = temp_test_dir("symlink-outside");
        let link = root.join("escape_link");
        symlink(&outside, &link).unwrap();

        let err = resolve_sandboxed_path(&root, "escape_link").unwrap_err();
        assert!(
            err.contains("escapes"),
            "expected escape error, got: {}",
            err
        );
    }

    #[test]
    fn rejects_absolute_subpath() {
        let root = temp_test_dir("absolute");
        let err = resolve_sandboxed_path(&root, "/etc/passwd").unwrap_err();
        assert!(
            err.contains("relative"),
            "expected relative error, got: {}",
            err
        );
    }

    #[test]
    fn sandbox_root_none_when_unset() {
        let _lock = env_lock();
        let _root = EnvGuard::unset(SANDBOX_ROOT_VAR);
        assert_eq!(sandbox_root(), None);
    }

    #[test]
    fn sandbox_root_none_when_blank() {
        let _lock = env_lock();
        let _root = EnvGuard::set(SANDBOX_ROOT_VAR, "   ");
        assert_eq!(sandbox_root(), None);
    }

    #[test]
    fn sandbox_root_some_when_set() {
        let _lock = env_lock();
        let dir = temp_test_dir("sandbox-root-some");
        let _root = EnvGuard::set(SANDBOX_ROOT_VAR, dir.to_str().unwrap());
        assert_eq!(sandbox_root(), Some(PathBuf::from(dir.to_str().unwrap())));
    }

    #[test]
    fn multi_instance_allowed_only_with_a_sandbox_root() {
        let _lock = env_lock();
        let dir = temp_test_dir("multi-instance-allowed");
        let _root = EnvGuard::set(SANDBOX_ROOT_VAR, dir.to_str().unwrap());
        // Mirrors the release posture: the helper may only ever relax the
        // guard in a debug build.
        assert_eq!(multi_instance_allowed(), cfg!(debug_assertions));
    }

    #[test]
    fn multi_instance_refused_without_a_sandbox_root() {
        let _lock = env_lock();
        let _root = EnvGuard::unset(SANDBOX_ROOT_VAR);
        assert!(
            !multi_instance_allowed(),
            "a run with no sandbox root must stay single-instance"
        );
    }

    #[test]
    fn multi_instance_refused_when_root_is_blank() {
        let _lock = env_lock();
        let _root = EnvGuard::set(SANDBOX_ROOT_VAR, "   ");
        assert!(
            !multi_instance_allowed(),
            "a blank root is not a sandbox and must not relax the guard"
        );
    }

    #[test]
    fn enforce_dev_world_root_marker_unset_root_unset_is_ok() {
        let _lock = env_lock();
        let _marker = EnvGuard::unset(DEV_WORLD_MARKER);
        let _root = EnvGuard::unset(SANDBOX_ROOT_VAR);
        assert_eq!(enforce_dev_world_root(), Ok(()));
    }

    #[test]
    fn enforce_dev_world_root_marker_unset_root_set_is_ok() {
        let _lock = env_lock();
        let dir = temp_test_dir("enforce-marker-unset-root-set");
        let _marker = EnvGuard::unset(DEV_WORLD_MARKER);
        let _root = EnvGuard::set(SANDBOX_ROOT_VAR, dir.to_str().unwrap());
        assert_eq!(enforce_dev_world_root(), Ok(()));
    }

    #[test]
    fn enforce_dev_world_root_marker_set_root_unset_names_missing_root() {
        let _lock = env_lock();
        let _marker = EnvGuard::set(DEV_WORLD_MARKER, "1");
        let _root = EnvGuard::unset(SANDBOX_ROOT_VAR);
        let err = enforce_dev_world_root().unwrap_err();
        assert!(
            err.contains(DEV_WORLD_MARKER),
            "expected marker name in error, got: {}",
            err
        );
        assert!(
            err.contains(SANDBOX_ROOT_VAR),
            "expected missing-root name in error, got: {}",
            err
        );
    }

    #[test]
    fn enforce_dev_world_root_marker_set_root_valid_resolves_inside_it() {
        let _lock = env_lock();
        let base = temp_test_dir("enforce-valid-base");
        let fresh_root = base.join("fresh-world-root");
        let _marker = EnvGuard::set(DEV_WORLD_MARKER, "1");
        let _root = EnvGuard::set(SANDBOX_ROOT_VAR, fresh_root.to_str().unwrap());

        assert_eq!(enforce_dev_world_root(), Ok(()));
        assert!(
            fresh_root.is_dir(),
            "expected enforce_dev_world_root to create the fresh root"
        );

        let handle = tauri::test::mock_app().handle().clone();
        let data_dir = test_data_dir(&handle).unwrap();
        assert!(
            data_dir.starts_with(fresh_root.canonicalize().unwrap()),
            "expected test_data_dir to resolve inside the sandbox root, got: {}",
            data_dir.display()
        );
    }

    #[test]
    fn enforce_dev_world_root_rejects_dotdot_root() {
        let _lock = env_lock();
        let base = temp_test_dir("enforce-dotdot-base");
        let escaping = base.join("..");
        let _marker = EnvGuard::set(DEV_WORLD_MARKER, "1");
        let _root = EnvGuard::set(SANDBOX_ROOT_VAR, escaping.to_str().unwrap());

        let err = enforce_dev_world_root().unwrap_err();
        assert!(err.contains("'..'"), "expected '..' error, got: {}", err);
    }

    #[test]
    #[cfg(unix)]
    fn enforce_dev_world_root_rejects_symlink_escape() {
        use std::os::unix::fs::symlink;

        let _lock = env_lock();
        let base = temp_test_dir("enforce-symlink-base");
        let outside = temp_test_dir("enforce-symlink-outside");
        let link = base.join("world-root-link");
        symlink(&outside, &link).unwrap();

        let _marker = EnvGuard::set(DEV_WORLD_MARKER, "1");
        let _root = EnvGuard::set(SANDBOX_ROOT_VAR, link.to_str().unwrap());

        let err = enforce_dev_world_root().unwrap_err();
        assert!(
            err.contains("escapes"),
            "expected escape error, got: {}",
            err
        );
    }

    fn write_lock_record(path: &Path, pid: u32, acquired_at_ms: u128) {
        let record = SandboxLockRecord {
            pid,
            acquired_at_ms,
        };
        std::fs::write(path, serde_json::to_vec(&record).unwrap()).unwrap();
    }

    #[test]
    fn sandbox_launch_lock_none_without_a_sandbox_root() {
        let _lock = env_lock();
        let _root = EnvGuard::unset(SANDBOX_ROOT_VAR);
        assert!(
            acquire_sandbox_launch_lock().unwrap().is_none(),
            "a plain, non-sandboxed launch must never be blocked by the guard"
        );
    }

    #[test]
    fn sandbox_launch_lock_matches_debug_only_posture() {
        let _lock = env_lock();
        let dir = temp_test_dir("launch-lock-debug-only");
        let _root = EnvGuard::set(SANDBOX_ROOT_VAR, dir.to_str().unwrap());
        let guard = acquire_sandbox_launch_lock().unwrap();
        // Mirrors multi_instance_allowed's own posture check: the guard may
        // only ever exist in a debug build.
        assert_eq!(guard.is_some(), cfg!(debug_assertions));
    }

    #[test]
    fn sandbox_launch_lock_refuses_when_holder_is_live_and_names_it() {
        let _lock = env_lock();
        let dir = temp_test_dir("launch-lock-live-holder");
        let _root = EnvGuard::set(SANDBOX_ROOT_VAR, dir.to_str().unwrap());

        let canonical = dir.canonicalize().unwrap();
        let holder_pid = std::process::id();
        write_lock_record(&canonical.join(LOCK_FILE_NAME), holder_pid, now_ms());

        let err = acquire_sandbox_launch_lock().unwrap_err();
        assert!(
            err.contains(&holder_pid.to_string()),
            "expected the holder pid in the refusal, got: {}",
            err
        );
    }

    #[test]
    #[cfg(unix)]
    fn sandbox_launch_lock_refuses_when_foreign_holder_is_live() {
        let _lock = env_lock();
        let dir = temp_test_dir("launch-lock-foreign-live-holder");
        let _root = EnvGuard::set(SANDBOX_ROOT_VAR, dir.to_str().unwrap());

        let mut child = std::process::Command::new("sleep")
            .arg("30")
            .spawn()
            .expect("spawn a live child to hold the lock");
        let holder_pid = child.id();
        let canonical = dir.canonicalize().unwrap();
        write_lock_record(&canonical.join(LOCK_FILE_NAME), holder_pid, now_ms());

        let result = acquire_sandbox_launch_lock();
        let _ = child.kill();
        let _ = child.wait();

        let err = result.expect_err("a live foreign holder must be refused, not reclaimed");
        assert!(
            err.contains(&holder_pid.to_string()),
            "expected the holder pid in the refusal, got: {}",
            err
        );
    }

    #[test]
    #[cfg(not(unix))]
    fn sandbox_launch_lock_refuses_foreign_pid_without_a_liveness_probe() {
        let _lock = env_lock();
        let dir = temp_test_dir("launch-lock-foreign-pid-fail-closed");
        let _root = EnvGuard::set(SANDBOX_ROOT_VAR, dir.to_str().unwrap());

        // A stranger pid past the grace window must still be treated as live
        // when this platform cannot probe it -- otherwise a second Windows
        // launch reclaims a live first instance after 1s.
        let foreign_pid = std::process::id().wrapping_add(1).max(1);
        let canonical = dir.canonicalize().unwrap();
        let old_timestamp = now_ms().saturating_sub(LOCK_STALE_GRACE_MS + 1_000);
        write_lock_record(&canonical.join(LOCK_FILE_NAME), foreign_pid, old_timestamp);

        let err = acquire_sandbox_launch_lock().unwrap_err();
        assert!(
            err.contains(&foreign_pid.to_string()),
            "expected the holder pid in the refusal, got: {}",
            err
        );
    }

    #[test]
    #[cfg(unix)]
    fn sandbox_launch_lock_reclaims_when_holder_is_dead() {
        let _lock = env_lock();
        let dir = temp_test_dir("launch-lock-dead-holder");
        let _root = EnvGuard::set(SANDBOX_ROOT_VAR, dir.to_str().unwrap());

        let mut child = std::process::Command::new("true")
            .spawn()
            .expect("spawn a short-lived child");
        let dead_pid = child.id();
        child.wait().expect("wait for child to exit");

        let canonical = dir.canonicalize().unwrap();
        let old_timestamp = now_ms().saturating_sub(LOCK_STALE_GRACE_MS + 1_000);
        write_lock_record(&canonical.join(LOCK_FILE_NAME), dead_pid, old_timestamp);

        let guard = acquire_sandbox_launch_lock()
            .unwrap()
            .expect("a dead holder must be reclaimed, not wedge the root");
        drop(guard);
    }

    #[test]
    fn sandbox_launch_lock_release_then_relaunch_is_clean() {
        let _lock = env_lock();
        let dir = temp_test_dir("launch-lock-relaunch");
        let _root = EnvGuard::set(SANDBOX_ROOT_VAR, dir.to_str().unwrap());

        let first = acquire_sandbox_launch_lock()
            .unwrap()
            .expect("first launch against a fresh root must succeed");
        let lock_path = dir.canonicalize().unwrap().join(LOCK_FILE_NAME);
        assert!(lock_path.exists());
        drop(first);
        assert!(
            !lock_path.exists(),
            "releasing the lock must remove the lockfile, not leak it"
        );

        let second = acquire_sandbox_launch_lock()
            .unwrap()
            .expect("relaunch against the same root after a clean release must succeed");
        drop(second);
        assert!(!lock_path.exists());
    }

    #[test]
    fn sandbox_launch_lock_different_roots_both_succeed() {
        let _lock = env_lock();
        let dir_a = temp_test_dir("launch-lock-root-a");
        let dir_b = temp_test_dir("launch-lock-root-b");

        let _root = EnvGuard::set(SANDBOX_ROOT_VAR, dir_a.to_str().unwrap());
        let guard_a = acquire_sandbox_launch_lock().unwrap();

        let _root = EnvGuard::set(SANDBOX_ROOT_VAR, dir_b.to_str().unwrap());
        let guard_b = acquire_sandbox_launch_lock().unwrap();

        if cfg!(debug_assertions) {
            assert!(guard_a.is_some(), "sandbox A must launch");
            assert!(guard_b.is_some(), "sandbox B must launch concurrently");
        }
    }

    #[test]
    fn window_state_filename_defaults_without_a_sandbox_root() {
        let _lock = env_lock();
        let _root = EnvGuard::unset(SANDBOX_ROOT_VAR);
        assert_eq!(window_state_filename(), DEFAULT_WINDOW_STATE_FILENAME);
    }

    #[test]
    fn window_state_filename_differs_across_sandbox_roots() {
        let _lock = env_lock();
        let dir_a = temp_test_dir("window-state-root-a");
        let dir_b = temp_test_dir("window-state-root-b");

        let _root = EnvGuard::set(SANDBOX_ROOT_VAR, dir_a.to_str().unwrap());
        let name_a = window_state_filename();

        let _root = EnvGuard::set(SANDBOX_ROOT_VAR, dir_b.to_str().unwrap());
        let name_b = window_state_filename();

        if cfg!(debug_assertions) {
            assert_ne!(
                name_a, name_b,
                "two sandbox roots must not restore window geometry from the same file"
            );
            assert_ne!(name_a, DEFAULT_WINDOW_STATE_FILENAME);
            assert_ne!(name_b, DEFAULT_WINDOW_STATE_FILENAME);
        } else {
            assert_eq!(name_a, DEFAULT_WINDOW_STATE_FILENAME);
            assert_eq!(name_b, DEFAULT_WINDOW_STATE_FILENAME);
        }
    }
}
