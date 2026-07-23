use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

/// Subdirectory used for the sandboxed equivalent of `app_data_dir`.
const DATA_SUBPATH: &str = "data";

/// Subdirectory used for the sandboxed equivalent of `app_local_data_dir`.
const LOCAL_SUBPATH: &str = "local";

/// Resolve a subpath under the sandbox root, rejecting escapes.
///
/// The root is canonicalized, then the subpath is resolved component-by-component.
/// Any `..`, absolute path, or symlink that escapes the root returns an error.
fn resolve_sandboxed_path(root: impl AsRef<Path>, subpath: impl AsRef<Path>) -> Result<PathBuf, String> {
    let root = root.as_ref();
    if !root.exists() {
        std::fs::create_dir_all(root)
            .map_err(|e| format!("Failed to create sandbox root: {}", e))?;
    }
    let root = root.canonicalize()
        .map_err(|e| format!("Failed to canonicalize sandbox root: {}", e))?;

    let mut current = root.clone();
    for component in subpath.as_ref().components() {
        match component {
            Component::Normal(part) => {
                current = current.join(part);
                if current.exists() {
                    current = current.canonicalize()
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

/// Returns the sandboxed `app_data_dir` when `PACTO_TEST_SANDBOX_ROOT` is set,
/// otherwise delegates to the normal Tauri path.
pub fn test_data_dir<R: Runtime>(handle: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Ok(root) = std::env::var("PACTO_TEST_SANDBOX_ROOT") {
        resolve_sandboxed_path(&root, DATA_SUBPATH)
    } else {
        handle.path().app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {}", e))
    }
}

/// Returns the sandboxed `app_local_data_dir` when `PACTO_TEST_SANDBOX_ROOT` is set,
/// otherwise delegates to the normal Tauri path.
pub fn test_local_data_dir<R: Runtime>(handle: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Ok(root) = std::env::var("PACTO_TEST_SANDBOX_ROOT") {
        resolve_sandboxed_path(&root, LOCAL_SUBPATH)
    } else {
        handle.path().app_local_data_dir()
            .map_err(|e| format!("Failed to get app local data dir: {}", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

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
        assert!(err.contains("escapes"), "expected escape error, got: {}", err);
    }

    #[test]
    fn rejects_absolute_subpath() {
        let root = temp_test_dir("absolute");
        let err = resolve_sandboxed_path(&root, "/etc/passwd").unwrap_err();
        assert!(err.contains("relative"), "expected relative error, got: {}", err);
    }
}
