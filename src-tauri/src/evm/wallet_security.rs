//! Redacts secrets embedded in RPC URLs and related error strings so logs and UI do not leak
//! credentials (query parameters, userinfo, or provider path segments such as Infura `/v3/...`).
//! Use [`redact_urls_in_text`] on any user-facing or log-bound string that might contain an HTTP(S) URL.

use url::Url;

/// Query parameter names whose values must not appear in logs or error JSON (case-insensitive).
const SENSITIVE_QUERY_KEYS: &[&str] = &[
    "apikey",
    "api_key",
    "key",
    "token",
    "secret",
    "password",
    "auth",
    "access_token",
    "refresh_token",
];

fn redact_query_string(query: &str) -> String {
    if query.is_empty() {
        return String::new();
    }
    query
        .split('&')
        .map(|pair| {
            let mut it = pair.splitn(2, '=');
            let k = it.next().unwrap_or("");
            let v = it.next();
            let kl = k.to_lowercase();
            let sensitive = SENSITIVE_QUERY_KEYS.iter().any(|sk| {
                kl == *sk
                    || kl.ends_with(&format!("_{}", sk))
                    || kl == format!("x-{}", sk)
            });
            if sensitive {
                format!("{}={}", k, "[REDACTED]")
            } else if let Some(val) = v {
                format!("{}={}", k, val)
            } else {
                k.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("&")
}

/// Known hosts that put API material in the path (e.g. `/v3/<projectId>`).
fn redact_provider_path_segment(url: &mut Url) {
    let host = url.host_str().unwrap_or("").to_lowercase();
    if !host.contains("infura.io")
        && !host.contains("alchemy.com")
        && !host.contains("quicknode.com")
        && !host.contains("blastapi.io")
    {
        return;
    }
    let path = url.path();
    for marker in ["/v3/", "/v2/"] {
        if let Some(pos) = path.find(marker) {
            let after = pos + marker.len();
            if after < path.len() {
                let new_path = format!("{}{}", &path[..after], "[REDACTED]");
                let _ = url.set_path(&new_path);
            }
            return;
        }
    }
}

/// Redact credentials and sensitive query/path segments from a single URL string (for logs / errors).
pub fn redact_rpc_url_for_log(raw: &str) -> String {
    let Ok(mut u) = Url::parse(raw) else {
        return redact_unparsed_url_heuristic(raw);
    };
    let _ = u.set_username("");
    let _ = u.set_password(None);
    if u.query().is_some() {
        let q = u.query().unwrap_or("");
        let rq = redact_query_string(q);
        u.set_query(Some(&rq));
    }
    redact_provider_path_segment(&mut u);
    String::from(u.as_str())
}

fn redact_unparsed_url_heuristic(raw: &str) -> String {
    // Strip user:pass@ when scheme is present but full parse failed (e.g. odd characters).
    if let Some(scheme_sep) = raw.find("://") {
        let after = &raw[scheme_sep + 3..];
        if let Some(at) = after.find('@') {
            let host_and_rest = &after[at + 1..];
            return format!("{}://[REDACTED]@{}", &raw[..scheme_sep + 3], host_and_rest);
        }
    }
    "[rpc-url-unparsed]".to_string()
}

/// Replace every `http://` / `https://` URL-like substring with a redacted form.
pub fn redact_urls_in_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        let https_here = i + 8 <= b.len() && &b[i..i + 8] == b"https://";
        let http_here = i + 7 <= b.len() && &b[i..i + 7] == b"http://";
        let (start, is_https) = if https_here {
            (i, true)
        } else if http_here {
            (i, false)
        } else {
            out.push(b[i] as char);
            i += 1;
            continue;
        };
        let mut j = start + if is_https { 8 } else { 7 };
        while j < b.len() {
            let c = b[j];
            if c.is_ascii_whitespace()
                || c == b'"'
                || c == b'\''
                || c == b')'
                || c == b']'
                || c == b'}'
                || c == b','
                || c == b';'
            {
                break;
            }
            j += 1;
        }
        let slice = &s[start..j];
        out.push_str(&redact_rpc_url_for_log(slice));
        i = j;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_query_apikey() {
        let u = "https://eth.llamarpc.com?apikey=supersecret";
        let r = redact_rpc_url_for_log(u);
        assert!(!r.contains("supersecret"));
        assert!(r.contains("[REDACTED]"));
    }

    #[test]
    fn redacts_userinfo() {
        let u = "https://user:pass@mainnet.infura.io/v3/projid";
        let r = redact_rpc_url_for_log(u);
        assert!(!r.contains("user"));
        assert!(!r.contains("pass"));
        assert!(!r.contains("projid"));
    }

    #[test]
    fn redacts_urls_inside_error_string() {
        let e = format!("connect failed: {}", "https://x.com?token=abc");
        let r = redact_urls_in_text(&e);
        assert!(!r.contains("abc"));
    }

    #[test]
    fn redacts_various_sensitive_query_keys() {
        for key in ["key", "token", "secret", "password", "auth", "api_key", "apikey", "access_token", "refresh_token"] {
            let url = format!("https://example.com?{}=leaked", key);
            let r = redact_rpc_url_for_log(&url);
            assert!(!r.contains("leaked"), "key {} should be redacted", key);
            assert!(r.contains("[REDACTED]"));
        }
    }

    #[test]
    fn preserves_non_sensitive_query_values() {
        let u = "https://example.com?foo=bar";
        let r = redact_rpc_url_for_log(u);
        assert!(r.contains("foo=bar"));
        assert!(!r.contains("[REDACTED]"));
    }

    #[test]
    fn redacts_provider_path_segments() {
        let u = "https://eth-mainnet.g.alchemy.com/v2/secret-key";
        let r = redact_rpc_url_for_log(u);
        assert!(!r.contains("secret-key"));
        assert!(r.contains("/v2/[REDACTED]"));
    }

    #[test]
    fn redacts_infura_v3_path_segment() {
        let u = "https://mainnet.infura.io/v3/project-id";
        let r = redact_rpc_url_for_log(u);
        assert!(!r.contains("project-id"));
        assert!(r.contains("/v3/[REDACTED]"));
    }

    #[test]
    fn redact_urls_in_text_handles_multiple_urls() {
        let text = "https://a.com?key=1 https://b.com?token=2";
        let r = redact_urls_in_text(text);
        assert!(!r.contains("key=1"));
        assert!(!r.contains("token=2"));
    }

    #[test]
    fn redact_urls_in_text_handles_http() {
        let text = "http://a.com?secret=x";
        let r = redact_urls_in_text(text);
        assert!(!r.contains("secret=x"));
    }

    #[test]
    fn redact_unparsed_url_heuristic_strips_userinfo() {
        let raw = "https://user:pass@host.com/path";
        let r = redact_unparsed_url_heuristic(raw);
        assert!(!r.contains("user"));
        assert!(!r.contains("pass"));
        assert!(r.contains("[REDACTED]"));
    }

    #[test]
    fn redact_unparsed_url_heuristic_without_scheme_returns_placeholder() {
        assert_eq!(redact_unparsed_url_heuristic("just text"), "[rpc-url-unparsed]");
    }
}
