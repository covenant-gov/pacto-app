//! Kind-15 tag parsing shared by live rumors and history import.

use crate::message::ImageMetadata;
use std::path::Path;

/// SHA-256 of empty input; a URL containing it points at a corrupted upload.
pub(crate) const EMPTY_FILE_HASH: &str =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/// Blank caption tags stay an empty body; other text is kept verbatim.
pub(crate) fn caption_body(value: Option<&str>) -> String {
    value
        .filter(|text| !text.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_default()
}

/// Needs both `blurhash` and a `<width>x<height>` `dim`.
pub(crate) fn image_metadata(blurhash: Option<&str>, dim: Option<&str>) -> Option<ImageMetadata> {
    let (width, height) = dim?.split_once('x')?;
    Some(ImageMetadata {
        blurhash: blurhash?.to_string(),
        width: width.parse().ok()?,
        height: height.parse().ok()?,
    })
}

/// A peer-supplied id or extension must stay one path segment.
fn is_safe_path_segment(segment: &str) -> bool {
    !segment.is_empty() && !segment.contains(['/', '\\', '\0']) && !segment.contains("..")
}

pub(crate) struct ResolvedFile {
    pub id: String,
    pub path: String,
    pub downloaded: bool,
}

/// File id is `ox` when it is a safe segment, else the nonce. `None` when neither is usable.
/// Only an `ox`-named file counts as already downloaded. Without `dir` the path stays empty.
pub(crate) fn resolve_file(
    dir: Option<&Path>,
    ox: Option<&str>,
    nonce: &str,
    extension: &str,
) -> Option<ResolvedFile> {
    let extension = if is_safe_path_segment(extension) {
        extension
    } else {
        "bin"
    };
    let (id, check_exists) = match ox.filter(|id| is_safe_path_segment(id)) {
        Some(id) => (id, true),
        None if is_safe_path_segment(nonce) => (nonce, false),
        None => return None,
    };
    let path = dir.map(|dir| dir.join(format!("{id}.{extension}")));
    Some(ResolvedFile {
        id: id.to_string(),
        downloaded: check_exists && path.as_ref().is_some_and(|path| path.exists()),
        path: path
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caption_body_keeps_text_and_blanks_blank() {
        assert_eq!(caption_body(Some("hi @alice")), "hi @alice");
        assert_eq!(caption_body(Some("   ")), "");
        assert_eq!(caption_body(None), "");
    }

    #[test]
    fn image_metadata_needs_blurhash_and_two_numbers() {
        let meta = image_metadata(Some("LEHV6n"), Some("32x16")).unwrap();
        assert_eq!(
            (meta.blurhash.as_str(), meta.width, meta.height),
            ("LEHV6n", 32, 16)
        );
        assert!(image_metadata(None, Some("32x16")).is_none());
        assert!(image_metadata(Some("LEHV6n"), None).is_none());
        assert!(image_metadata(Some("LEHV6n"), Some("32")).is_none());
        assert!(image_metadata(Some("LEHV6n"), Some("32x16x8")).is_none());
        assert!(image_metadata(Some("LEHV6n"), Some("axb")).is_none());
    }

    #[test]
    fn resolve_file_prefers_ox_and_marks_existing_downloads() {
        let dir = std::env::temp_dir().join("pacto-attachment-tags-test");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("hash.png"), b"x").unwrap();

        let hit = resolve_file(Some(&dir), Some("hash"), "nonce", "png").unwrap();
        assert_eq!(hit.id, "hash");
        assert!(hit.downloaded);
        assert_eq!(Path::new(&hit.path), dir.join("hash.png"));

        let miss = resolve_file(Some(&dir), Some("other"), "nonce", "png").unwrap();
        assert!(!miss.downloaded);
    }

    #[test]
    fn resolve_file_falls_back_to_nonce_and_never_marks_it_downloaded() {
        let dir = std::env::temp_dir().join("pacto-attachment-tags-nonce");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("nonce.png"), b"x").unwrap();

        let resolved = resolve_file(Some(&dir), None, "nonce", "png").unwrap();
        assert_eq!(resolved.id, "nonce");
        assert!(!resolved.downloaded);
    }

    #[test]
    fn resolve_file_rejects_traversal_ids_and_extensions() {
        let dir = Path::new("/tmp/pacto");
        let from_nonce = resolve_file(Some(dir), Some("../../etc/passwd"), "nonce", "png").unwrap();
        assert_eq!(from_nonce.id, "nonce");
        assert!(resolve_file(Some(dir), Some("a/b"), "..", "png").is_none());
        assert!(resolve_file(Some(dir), Some(""), "", "png").is_none());
        let bin = resolve_file(Some(dir), Some("hash"), "nonce", "../x").unwrap();
        assert!(bin.path.ends_with("hash.bin"));
        let no_dir = resolve_file(None, Some("hash"), "nonce", "png").unwrap();
        assert_eq!(
            (no_dir.id.as_str(), no_dir.path.as_str(), no_dir.downloaded),
            ("hash", "", false)
        );
    }
}
