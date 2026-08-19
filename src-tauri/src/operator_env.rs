//! Load repo-root `.env` into the process for local Tauri debug runs.
//! Release builds expect operator secrets via the real process environment.

#[cfg(debug_assertions)]
use std::path::{Path, PathBuf};

/// Best-effort load of root `.env` (debug only). Does not override existing vars.
pub fn load_operator_env() {
    #[cfg(debug_assertions)]
    {
        for path in candidate_env_paths() {
            if !path.is_file() {
                continue;
            }
            match dotenvy::from_path(&path) {
                Ok(()) => {
                    log::info!(
                        target: "pacto",
                        "loaded operator env from {}",
                        path.display()
                    );
                    return;
                }
                Err(e) => {
                    log::warn!(
                        target: "pacto",
                        "failed to load {}: {e}",
                        path.display()
                    );
                }
            }
        }
    }
}

#[cfg(debug_assertions)]
fn candidate_env_paths() -> Vec<PathBuf> {
    let mut paths = Vec::with_capacity(3);
    paths.push(PathBuf::from(".env"));
    paths.push(PathBuf::from("../.env"));
    // CARGO_MANIFEST_DIR is `src-tauri` at compile time → parent is repo root.
    paths.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("../.env"));
    paths
}

#[cfg(test)]
mod tests {
    use super::candidate_env_paths;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn candidates_include_manifest_parent_env() {
        let paths = candidate_env_paths();
        assert!(paths.iter().any(|p| p.ends_with(".env")));
        let manifest_parent = paths
            .iter()
            .find(|p| p.to_string_lossy().contains("src-tauri"))
            .expect("manifest-relative .env candidate");
        assert!(manifest_parent.ends_with("../.env") || manifest_parent.file_name().is_some());
    }

    #[test]
    fn from_path_sets_missing_vars_without_override() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("pacto-dotenv-test-{nanos}.env"));
        let mut f = std::fs::File::create(&path).expect("create");
        writeln!(f, "PACTO_TEST_DOTENV_A=from_file").unwrap();
        writeln!(f, "PACTO_TEST_DOTENV_B=from_file").unwrap();

        std::env::set_var("PACTO_TEST_DOTENV_A", "preexisting");
        std::env::remove_var("PACTO_TEST_DOTENV_B");

        dotenvy::from_path(&path).expect("load temp .env");
        let _ = std::fs::remove_file(&path);

        assert_eq!(
            std::env::var("PACTO_TEST_DOTENV_A").unwrap(),
            "preexisting",
            "dotenvy must not override existing process env"
        );
        assert_eq!(std::env::var("PACTO_TEST_DOTENV_B").unwrap(), "from_file");

        std::env::remove_var("PACTO_TEST_DOTENV_A");
        std::env::remove_var("PACTO_TEST_DOTENV_B");
    }
}
