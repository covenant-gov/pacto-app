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
pub const SANDBOX_ONLY_MARKER_FILE: &str = ".pacto_dev_identity_sandbox_only";

/// True when the configured sandbox root carries the sandbox-only identity stamp.
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
}
