//! URL secrets: the fragment and secret-named query values. Mirrors `src/lib/docs/mask-url.ts`;
//! the tracker matcher mirrors `src/lib/utils/url-tracking.ts`. Both suites assert the same fixtures.

const MASK: &str = "••••";

const SECRET_QUERY_NAMES: &[&str] = &[
    "token",
    "access_token",
    "id_token",
    "refresh_token",
    "api_key",
    "apikey",
    "key",
    "secret",
    "sig",
    "signature",
    "auth",
    "password",
    "code",
];

const TRACKING_PARAM_PREFIXES: &[&str] = &["utm_"];

const TRACKING_PARAM_NAMES: &[&str] = &[
    "fbclid",
    "gclid",
    "dclid",
    "gclsrc",
    "gbraid",
    "wbraid",
    "msclkid",
    "mc_eid",
    "mc_cid",
    "twclid",
    "ttclid",
    "yclid",
    "srsltid",
    "_ga",
    "_gl",
    "_openstat",
    "wickedid",
    "_hsenc",
    "_hsmi",
    "__hsfp",
    "__hssc",
    "__hstc",
    "hsctatracking",
    "mkt_tok",
    "oly_anon_id",
    "oly_enc_id",
    "vero_id",
    "vero_conv",
];

const HOST_SCOPED_TRACKING_PARAMS: &[(&[&str], &[&str])] = &[
    (&["youtube.com", "youtu.be", "open.spotify.com"], &["si"]),
    (&["instagram.com"], &["igsh", "igshid"]),
    (&["threads.net", "threads.com"], &["igshid"]),
    (&["x.com", "twitter.com"], &["ref_src", "ref_url", "refsrc"]),
];

/// Raw slices of an absolute http(s) URL, so rebuilt output keeps the original encoding.
struct Split<'a> {
    prefix: &'a str,
    query: Option<&'a str>,
    fragment: Option<&'a str>,
    host: String,
    path: String,
}

fn split_http(raw: &str) -> Option<Split<'_>> {
    let parsed = url::Url::parse(raw).ok()?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return None;
    }
    let (before, fragment) = match raw.find('#') {
        Some(i) => (&raw[..i], Some(&raw[i + 1..])),
        None => (raw, None),
    };
    let (prefix, query) = match before.find('?') {
        Some(i) => (&before[..i], Some(&before[i + 1..])),
        None => (before, None),
    };
    Some(Split {
        prefix,
        query,
        fragment,
        host: parsed.host_str().unwrap_or_default().to_ascii_lowercase(),
        path: parsed.path().to_string(),
    })
}

/// `name` and `value` of one `&` part; a part without `=` has an empty value.
fn pair(part: &str) -> (&str, &str) {
    part.split_once('=').unwrap_or((part, ""))
}

/// Percent-decoded bytes of a query name; invalid escapes stay literal, as in URL query parsing.
fn decoded_name(name: &str) -> impl Iterator<Item = u8> + '_ {
    let raw = name.as_bytes();
    let mut i = 0;
    std::iter::from_fn(move || {
        let b = *raw.get(i)?;
        if b == b'%' {
            if let Some([hi, lo]) = raw.get(i + 1..i + 3) {
                if let (Some(hi), Some(lo)) =
                    ((*hi as char).to_digit(16), (*lo as char).to_digit(16))
                {
                    i += 3;
                    return Some((hi * 16 + lo) as u8);
                }
            }
        }
        i += 1;
        Some(b)
    })
}

fn is_secret_name(name: &str) -> bool {
    SECRET_QUERY_NAMES.iter().any(|s| {
        decoded_name(name)
            .map(|b| b.to_ascii_lowercase())
            .eq(s.bytes())
    })
}

fn host_matches(host: &str, rule: &str) -> bool {
    host == rule
        || (host.len() > rule.len()
            && host.ends_with(rule)
            && host.as_bytes()[host.len() - rule.len() - 1] == b'.')
}

fn is_tracking_name(name: &str, host: &str, path: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if TRACKING_PARAM_PREFIXES.iter().any(|p| lower.starts_with(p)) {
        return true;
    }
    if TRACKING_PARAM_NAMES.contains(&lower.as_str()) {
        return !(lower == "mkt_tok" && path.to_ascii_lowercase().contains("unsubscribe"));
    }
    HOST_SCOPED_TRACKING_PARAMS.iter().any(|(hosts, names)| {
        names.contains(&lower.as_str()) && hosts.iter().any(|h| host_matches(host, h))
    })
}

/// Display form: non-empty fragment → `#••••`; secret or tracker query values → `••••`.
/// Non-http(s) or unparseable input is returned unchanged.
pub fn mask_doc_url(raw: &str) -> String {
    let Some(s) = split_http(raw) else {
        return raw.to_string();
    };
    let mut out = String::with_capacity(raw.len());
    out.push_str(s.prefix);
    if let Some(query) = s.query {
        out.push('?');
        for (i, part) in query.split('&').enumerate() {
            if i > 0 {
                out.push('&');
            }
            let (name, value) = pair(part);
            if !value.is_empty()
                && (is_secret_name(name) || is_tracking_name(name, &s.host, &s.path))
            {
                out.push_str(name);
                out.push('=');
                out.push_str(MASK);
            } else {
                out.push_str(part);
            }
        }
    }
    match s.fragment {
        Some("") => out.push('#'),
        Some(_) => {
            out.push('#');
            out.push_str(MASK);
        }
        None => {}
    }
    out
}

fn rebuild_without(raw: &str, drop_trackers: bool) -> String {
    let Some(s) = split_http(raw) else {
        return raw.to_string();
    };
    let mut out = String::with_capacity(raw.len());
    out.push_str(s.prefix);
    let kept = s
        .query
        .into_iter()
        .flat_map(|q| q.split('&'))
        .filter(|part| {
            let (name, _) = pair(part);
            !part.is_empty()
                && !is_secret_name(name)
                && !(drop_trackers && is_tracking_name(name, &s.host, &s.path))
        });
    for (i, part) in kept.enumerate() {
        out.push(if i == 0 { '?' } else { '&' });
        out.push_str(part);
    }
    out
}

/// Parity with the TS helper (trackers always stripped); the fetch path uses [`strip_fetch_secrets`].
#[cfg(test)]
fn preview_candidate_url(raw: &str) -> String {
    rebuild_without(raw, true)
}

/// Fragment and secret-named pairs dropped; trackers stay (the caller decides on those).
pub fn strip_fetch_secrets(raw: &str) -> String {
    rebuild_without(raw, false)
}

/// Non-empty fragment, or a secret-named query pair with a non-empty value. Trackers do not count.
/// Parity with the TS Commons warning detector.
#[cfg(test)]
fn has_keyed_secret(raw: &str) -> bool {
    let Some(s) = split_http(raw) else {
        return false;
    };
    if s.fragment.is_some_and(|f| !f.is_empty()) {
        return true;
    }
    s.query.is_some_and(|q| {
        q.split('&').any(|part| {
            let (name, value) = pair(part);
            !value.is_empty() && is_secret_name(name)
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// (input, mask, preview candidate, keyed). Shared with `src/lib/docs/mask-url.test.ts`.
    const FIXTURES: &[(&str, &str, &str, bool)] = &[
        (
            "https://cryptpad.fr/pad/#/2/pad/edit/secret",
            "https://cryptpad.fr/pad/#••••",
            "https://cryptpad.fr/pad/",
            true,
        ),
        (
            "https://example.com/a?token=abc&x=1",
            "https://example.com/a?token=••••&x=1",
            "https://example.com/a?x=1",
            true,
        ),
        (
            "https://docs.google.com/document/d/1AbC/edit",
            "https://docs.google.com/document/d/1AbC/edit",
            "https://docs.google.com/document/d/1AbC/edit",
            false,
        ),
        (
            "https://example.com/a#",
            "https://example.com/a#",
            "https://example.com/a",
            false,
        ),
        (
            "https://example.com/a?Signature=Zz&x=1#frag",
            "https://example.com/a?Signature=••••&x=1#••••",
            "https://example.com/a?x=1",
            true,
        ),
        (
            "https://example.com/a?token=",
            "https://example.com/a?token=",
            "https://example.com/a",
            false,
        ),
        (
            "https://example.com/a",
            "https://example.com/a",
            "https://example.com/a",
            false,
        ),
        (
            "https://example.com/a?to%6Ben=abc&x=1",
            "https://example.com/a?to%6Ben=••••&x=1",
            "https://example.com/a?x=1",
            true,
        ),
        (
            "https://example.com/a?token%zz=abc",
            "https://example.com/a?token%zz=abc",
            "https://example.com/a?token%zz=abc",
            false,
        ),
    ];

    #[test]
    fn shared_fixtures_match() {
        for (input, mask, preview, keyed) in FIXTURES {
            assert_eq!(mask_doc_url(input), *mask, "mask {input}");
            assert_eq!(preview_candidate_url(input), *preview, "preview {input}");
            assert_eq!(has_keyed_secret(input), *keyed, "keyed {input}");
        }
    }

    #[test]
    fn trackers_are_masked_but_not_keyed() {
        let url = "https://example.com/a?utm_source=news&x=1";
        assert_eq!(
            mask_doc_url(url),
            "https://example.com/a?utm_source=••••&x=1"
        );
        assert!(!has_keyed_secret(url));
        assert_eq!(preview_candidate_url(url), "https://example.com/a?x=1");
        assert_eq!(strip_fetch_secrets(url), url);
    }

    #[test]
    fn host_scoped_trackers_follow_the_host() {
        assert_eq!(
            mask_doc_url("https://www.youtube.com/watch?v=1&si=abc"),
            "https://www.youtube.com/watch?v=1&si=••••"
        );
        assert_eq!(
            mask_doc_url("https://example.com/watch?v=1&si=abc"),
            "https://example.com/watch?v=1&si=abc"
        );
        assert_eq!(
            mask_doc_url("https://example.com/unsubscribe?mkt_tok=abc"),
            "https://example.com/unsubscribe?mkt_tok=abc"
        );
    }

    #[test]
    fn non_http_and_garbage_pass_through() {
        for raw in [
            "ftp://example.com/a#frag",
            "not a url",
            "javascript:alert(1)#x",
        ] {
            assert_eq!(mask_doc_url(raw), raw);
            assert_eq!(preview_candidate_url(raw), raw);
            assert!(!has_keyed_secret(raw));
        }
    }

    #[test]
    fn original_encoding_and_order_are_kept() {
        assert_eq!(
            mask_doc_url("https://example.com/a%20b?z=%2F&KEY=v&a=1"),
            "https://example.com/a%20b?z=%2F&KEY=••••&a=1"
        );
    }

    #[test]
    fn bare_secret_name_is_empty_value() {
        let url = "https://example.com/a?token&x=1";
        assert_eq!(mask_doc_url(url), url);
        assert!(!has_keyed_secret(url));
        assert_eq!(preview_candidate_url(url), "https://example.com/a?x=1");
    }
}
