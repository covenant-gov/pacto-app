//! App-local seam over nostr tag construction and inspection.
//!
//! Every `TagKind` / `TagStandard` reference in the backend lives here, so the
//! symbols the nostr 0.45 line removes stay confined to one file. Callers name
//! the tag shape they want, not the upstream enum variant.

use nostr_sdk::prelude::*;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/// `["d", values...]` — replaceable-event identifier.
pub fn d_tag<I, S>(values: I) -> Tag
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    Tag::custom(TagKind::d(), values)
}

/// `["e", values...]` — event reference, including the reply-marker form.
pub fn e_tag<I, S>(values: I) -> Tag
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    Tag::custom(TagKind::e(), values)
}

/// `[name, values...]` — app-defined tag name.
pub fn custom_tag<'a, N, I, S>(name: N, values: I) -> Tag
where
    N: Into<std::borrow::Cow<'a, str>>,
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    Tag::custom(TagKind::custom(name), values)
}

/// `[letter, values...]` — lowercase single-letter tag (`t`, `h`, `l`, ...).
pub fn letter_tag<I, S>(letter: Alphabet, values: I) -> Tag
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    Tag::custom(
        TagKind::SingleLetter(SingleLetterTag::lowercase(letter)),
        values,
    )
}

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

/// First `d` tag.
pub fn find_d(tags: &Tags) -> Option<&Tag> {
    tags.find(TagKind::d())
}

/// First `e` tag.
pub fn find_e(tags: &Tags) -> Option<&Tag> {
    tags.find(TagKind::e())
}

/// First tag with the given app-defined name.
pub fn find_custom<'t>(tags: &'t Tags, name: &str) -> Option<&'t Tag> {
    tags.find(TagKind::custom(name))
}

/// First lowercase single-letter tag for `letter`.
pub fn find_letter(tags: &Tags, letter: Alphabet) -> Option<&Tag> {
    tags.find(TagKind::SingleLetter(SingleLetterTag::lowercase(letter)))
}

/// First `expiration` tag.
pub fn find_expiration(tags: &Tags) -> Option<&Tag> {
    tags.find(TagKind::Expiration)
}

/// Content of the first `d` tag.
pub fn d_content(tags: &Tags) -> Option<&str> {
    find_d(tags).and_then(|t| t.content())
}

/// Content of the first tag with the given app-defined name.
pub fn custom_content<'t>(tags: &'t Tags, name: &str) -> Option<&'t str> {
    find_custom(tags, name).and_then(|t| t.content())
}

/// Whether `tag` is the lowercase single-letter tag for `letter`.
pub fn is_letter(tag: &Tag, letter: Alphabet) -> bool {
    tag.kind() == TagKind::SingleLetter(SingleLetterTag::lowercase(letter))
}

/// Public key carried by a standardized `p` tag.
pub fn public_key_of(tag: &Tag) -> Option<PublicKey> {
    match tag.as_standardized() {
        Some(TagStandard::PublicKey { public_key, .. }) => Some(*public_key),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags_of(tags: Vec<Tag>) -> Tags {
        Tags::from_list(tags)
    }

    #[test]
    fn d_tag_matches_direct_construction() {
        assert_eq!(d_tag(["general"]), Tag::custom(TagKind::d(), ["general"]));
    }

    #[test]
    fn custom_tag_keeps_every_value() {
        let tag = custom_tag("poll", ["a", "b", "c"]);
        assert_eq!(
            tag.clone().to_vec(),
            vec![
                "poll".to_string(),
                "a".to_string(),
                "b".to_string(),
                "c".to_string()
            ]
        );
        assert_eq!(tag, Tag::custom(TagKind::custom("poll"), ["a", "b", "c"]));
    }

    #[test]
    fn e_tag_preserves_reply_marker() {
        let id = EventId::all_zeros().to_hex();
        let tag = e_tag([id.clone(), String::new(), "reply".to_string()]);
        assert_eq!(
            tag.to_vec(),
            vec![
                "e".to_string(),
                id,
                String::new(),
                "reply".to_string()
            ]
        );
    }

    #[test]
    fn letter_tag_is_found_by_letter_lookup() {
        let tag = letter_tag(Alphabet::T, ["neo"]);
        let tags = tags_of(vec![tag.clone()]);
        assert_eq!(
            find_letter(&tags, Alphabet::T).and_then(|t| t.content()),
            Some("neo")
        );
        assert!(find_letter(&tags, Alphabet::H).is_none());
        assert!(is_letter(&tag, Alphabet::T));
        assert!(!is_letter(&tag, Alphabet::H));
    }

    #[test]
    fn custom_and_d_content_read_back() {
        let tags = tags_of(vec![d_tag(["vector"]), custom_tag("ms", ["417"])]);
        assert_eq!(d_content(&tags), Some("vector"));
        assert_eq!(custom_content(&tags, "ms"), Some("417"));
        assert_eq!(custom_content(&tags, "absent"), None);
    }

    #[test]
    fn expiration_is_read_off_an_event() {
        let ts = Timestamp::from(1_700_000_000);
        let tags = tags_of(vec![Tag::expiration(ts)]);
        assert_eq!(
            find_expiration(&tags).and_then(|t| t.content()),
            Some("1700000000")
        );
    }

    #[test]
    fn public_key_of_reads_standardized_p_tag() {
        let keys = Keys::generate();
        let tag = Tag::public_key(keys.public_key());
        assert_eq!(public_key_of(&tag), Some(keys.public_key()));
        assert_eq!(public_key_of(&d_tag(["x"])), None);
    }
}
