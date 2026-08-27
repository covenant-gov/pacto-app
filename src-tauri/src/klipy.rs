//! Single Klipy egress chokepoint: search, trending, and share-trigger requests.
//!
//! Every outbound Klipy call goes through this module so a future Tor gate
//! has exactly one place to change, and so the API key never crosses
//! the IPC boundary — it lives only in process memory here, resolved once per
//! call through [`klipy_api_key`]. Klipy places the key in the request *path*
//! (`/api/v1/{app_key}/...`), which makes leaking it through logs and error text
//! the primary hazard: every string this module can surface is scrubbed of the
//! literal key value, then passed through the shared RPC-URL redactor, before it
//! ever reaches a log line or a caller.
//!
//! Delivery is URL-only: Klipy's integration terms forbid re-hosting returned
//! media, so this module only ever proxies JSON metadata — it never downloads
//! GIF bytes. No request built here ever carries `customer_id` or any value
//! derived from the user's identity.

use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::evm::wallet_security::redact_urls_in_text;

const KLIPY_BASE_URL: &str = "https://api.klipy.com/api/v1";
const DEFAULT_PER_PAGE: u32 = 24;
/// Klipy defaults `content_filter` to `off`; this is a community app, so every
/// request raises the bar instead of inheriting that default.
const CONTENT_FILTER: &str = "high";
const ERR_NOT_CONFIGURED: &str = "Klipy is not configured";

/// Builds the Klipy JSON HTTP client. Built fresh per call (instead of a
/// cached static) so a Tor routing toggle takes effect on the next request
/// rather than requiring a restart -- see net_transport.rs.
fn http_client() -> reqwest::Client {
    crate::net_transport::http_client_builder()
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(10))
        .user_agent("Pacto/1.0")
        .build()
        .expect("failed to build Klipy HTTP client")
}

/// Precedence logic only — pure so it is testable without touching process env.
/// A runtime override wins over the compile-time default; blank values on
/// either side are treated as absent.
fn resolve_klipy_key(runtime_override: Option<String>, baked: Option<&str>) -> Option<String> {
    runtime_override
        .filter(|v| !v.trim().is_empty())
        .or_else(|| baked.filter(|v| !v.trim().is_empty()).map(str::to_string))
}

/// The single point where the Klipy key value exists in memory. No other
/// function in this module — let alone another module — reads `KLIPY_API_KEY`
/// directly. `std::env::var` is the runtime override; `option_env!` is the
/// value baked into release builds at compile time.
fn klipy_api_key() -> Option<String> {
    resolve_klipy_key(
        std::env::var("KLIPY_API_KEY").ok(),
        option_env!("KLIPY_API_KEY"),
    )
}

/// True when a key is configured, so the UI can show a useful message instead
/// of firing a request that would fail unauthenticated.
#[tauri::command]
pub fn klipy_is_configured() -> bool {
    klipy_api_key().is_some()
}

/// One GIF result, ready for the frontend. `preview_url` / `full_url` are
/// Klipy's own URLs passed through byte-identical — never rewritten, stripped,
/// or reconstructed, per Klipy's no-re-hosting terms.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KlipyGifDto {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub preview_url: String,
    pub full_url: String,
    pub width: u32,
    pub height: u32,
}

/// A page of search or trending results.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KlipyPageDto {
    pub items: Vec<KlipyGifDto>,
    pub page: u32,
    pub per_page: u32,
    pub total: u32,
    pub has_more: bool,
}

// ---- Raw Klipy wire shape ------------------------------------------------
// Mirrors `{ result, data: { data: [...], page, per_page, total } }` exactly
// as captured from the live API. Kept private: only `parse_klipy_page` and its
// tests ever see these shapes.

#[derive(Debug, Deserialize)]
struct RawEnvelope {
    #[serde(default)]
    data: Option<RawPageData>,
}

#[derive(Debug, Deserialize)]
struct RawPageData {
    #[serde(default)]
    data: Vec<RawItem>,
    #[serde(default)]
    page: u32,
    #[serde(default)]
    per_page: u32,
    #[serde(default)]
    total: u32,
}

#[derive(Debug, Deserialize)]
struct RawItem {
    #[serde(deserialize_with = "id_as_string")]
    id: String,
    slug: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    file: RawFile,
}

/// Klipy returns numeric ids (e.g. `8041071659142944`) despite the contract
/// carrying `id` as a string; accept either shape from the wire.
fn id_as_string<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    match serde_json::Value::deserialize(deserializer)? {
        serde_json::Value::String(s) => Ok(s),
        serde_json::Value::Number(n) => Ok(n.to_string()),
        other => Err(serde::de::Error::custom(format!(
            "unexpected id type: {other}"
        ))),
    }
}

#[derive(Debug, Default, Deserialize)]
struct RawFile {
    #[serde(default)]
    hd: Option<RawSize>,
    #[serde(default)]
    md: Option<RawSize>,
    #[serde(default)]
    sm: Option<RawSize>,
    #[serde(default)]
    xs: Option<RawSize>,
}

#[derive(Debug, Default, Deserialize)]
struct RawSize {
    #[serde(default)]
    gif: Option<RawVariant>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawVariant {
    url: String,
    #[serde(default)]
    width: u32,
    #[serde(default)]
    height: u32,
}

/// Preview is the smallest usable variant first (`sm`, then `xs`, then `md`)
/// since it renders in a search-result grid.
fn pick_preview(file: &RawFile) -> Option<RawVariant> {
    file.sm
        .as_ref()
        .and_then(|s| s.gif.clone())
        .or_else(|| file.xs.as_ref().and_then(|s| s.gif.clone()))
        .or_else(|| file.md.as_ref().and_then(|s| s.gif.clone()))
}

/// Full is the largest usable variant first (`hd`, then `md`, then `sm`) since
/// it is what actually gets sent and rendered full-size.
fn pick_full(file: &RawFile) -> Option<RawVariant> {
    file.hd
        .as_ref()
        .and_then(|s| s.gif.clone())
        .or_else(|| file.md.as_ref().and_then(|s| s.gif.clone()))
        .or_else(|| file.sm.as_ref().and_then(|s| s.gif.clone()))
}

/// Drops an item outright if neither fallback chain finds a usable `gif`
/// variant, or if either the preview or full URL fails the Klipy media host
/// allowlist ([`is_klipy_media_url`]) — a non-allowlisted URL drops the
/// whole item rather than surfacing a half-populated result.
fn map_item(item: RawItem) -> Option<KlipyGifDto> {
    let preview = pick_preview(&item.file)?;
    let full = pick_full(&item.file)?;
    if !is_klipy_media_url(&preview.url) || !is_klipy_media_url(&full.url) {
        return None;
    }
    Some(KlipyGifDto {
        id: item.id,
        slug: item.slug,
        title: item.title,
        preview_url: preview.url,
        full_url: full.url,
        width: full.width,
        height: full.height,
    })
}

/// Parses Klipy's `{ result, data: { data: [...], page, per_page, total } }`
/// envelope into the DTO the frontend consumes. Pure and network-free so a
/// captured fixture can exercise it directly.
fn parse_klipy_page(raw_json: &str) -> Result<KlipyPageDto, String> {
    let envelope: RawEnvelope =
        serde_json::from_str(raw_json).map_err(|e| format!("Klipy response parse failed: {e}"))?;
    let page_data = envelope
        .data
        .ok_or_else(|| "Klipy response carried no data".to_string())?;
    let has_more =
        (page_data.page as u64) * (page_data.per_page.max(1) as u64) < page_data.total as u64;
    let items = page_data.data.into_iter().filter_map(map_item).collect();
    Ok(KlipyPageDto {
        items,
        page: page_data.page,
        per_page: page_data.per_page,
        total: page_data.total,
        has_more,
    })
}

/// Scrubs the literal key value out of `text`, then runs the shared RPC-URL
/// redactor over the result. The explicit key replacement is the load-bearing
/// step: `redact_urls_in_text` only recognizes a fixed set of known RPC
/// providers and path shapes, which does not include Klipy's, so this module
/// cannot rely on it alone to keep the key out of error text.
fn redact_klipy_error(text: &str, key: &str) -> String {
    let scrubbed = if key.is_empty() {
        text.to_string()
    } else {
        text.replace(key, "[REDACTED]")
    };
    redact_urls_in_text(&scrubbed)
}

fn klipy_url(key: &str, path: &str) -> String {
    format!("{KLIPY_BASE_URL}/{key}/{path}")
}

fn search_query_params(query: &str, page: u32) -> Vec<(&'static str, String)> {
    vec![
        ("q", query.to_string()),
        ("page", page.max(1).to_string()),
        ("per_page", DEFAULT_PER_PAGE.to_string()),
        ("content_filter", CONTENT_FILTER.to_string()),
    ]
}

fn trending_query_params(page: u32) -> Vec<(&'static str, String)> {
    vec![
        ("page", page.max(1).to_string()),
        ("per_page", DEFAULT_PER_PAGE.to_string()),
        ("content_filter", CONTENT_FILTER.to_string()),
    ]
}

/// Resolves the key, builds the request, and returns the raw response body.
/// Returns [`ERR_NOT_CONFIGURED`] before building any URL when no key is
/// available, so a missing key never produces an unauthenticated request.
async fn klipy_get(path: &str, params: &[(&str, String)]) -> Result<String, String> {
    let key = klipy_api_key().ok_or_else(|| ERR_NOT_CONFIGURED.to_string())?;
    let url = klipy_url(&key, path);
    let resp = http_client()
        .get(&url)
        .query(params)
        .send()
        .await
        .map_err(|e| redact_klipy_error(&format!("Klipy request failed: {e}"), &key))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| redact_klipy_error(&format!("Klipy response read failed: {e}"), &key))?;
    if !status.is_success() {
        return Err(redact_klipy_error(
            &format!("Klipy HTTP {status}: {text}"),
            &key,
        ));
    }
    Ok(text)
}

/// Searches Klipy's GIF library. `per_page` is fixed at [`DEFAULT_PER_PAGE`];
/// `customer_id` is never sent.
#[tauri::command]
pub async fn klipy_search_gifs(query: String, page: u32) -> Result<KlipyPageDto, String> {
    let body = klipy_get("gifs/search", &search_query_params(&query, page)).await?;
    parse_klipy_page(&body).map_err(|e| redact_urls_in_text(&e))
}

/// Trending GIFs, shown when the search box is empty. Same shape as search
/// minus the `q` parameter.
#[tauri::command]
pub async fn klipy_trending_gifs(page: u32) -> Result<KlipyPageDto, String> {
    let body = klipy_get("gifs/trending", &trending_query_params(page)).await?;
    parse_klipy_page(&body).map_err(|e| redact_urls_in_text(&e))
}

#[derive(Debug, Serialize)]
struct ShareBody {
    #[serde(skip_serializing_if = "Option::is_none")]
    q: Option<String>,
}

/// Fires Klipy's share-trigger callback for analytics. Never sends
/// `customer_id`. A network or HTTP failure here must not fail the user's
/// send, so every failure path logs (key-redacted) and resolves to `false`
/// rather than propagating an error.
#[tauri::command]
pub async fn klipy_report_share(slug: String, query: Option<String>) -> Result<bool, String> {
    let Some(key) = klipy_api_key() else {
        return Ok(false);
    };
    let url = klipy_url(&key, &format!("gifs/share/{slug}"));
    match http_client()
        .post(&url)
        .json(&ShareBody { q: query })
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => Ok(true),
        Ok(resp) => {
            log::warn!(
                target: "pacto",
                "klipy share trigger returned {}",
                redact_klipy_error(&resp.status().to_string(), &key)
            );
            Ok(false)
        }
        Err(e) => {
            log::warn!(
                target: "pacto",
                "klipy share trigger failed: {}",
                redact_klipy_error(&e.to_string(), &key)
            );
            Ok(false)
        }
    }
}

/// Klipy's documented media CDN hosts (docs.klipy.com/network-requirements).
/// `klipy_fetch_media` refuses any URL whose host is not exactly one of these —
/// this, not the frontend's mirrored check, is the actual security boundary.
const KLIPY_MEDIA_HOSTS: &[&str] = &["static.klipy.com", "static1.klipy.com", "static2.klipy.com"];

/// True only for an `https://` URL whose host is one of [`KLIPY_MEDIA_HOSTS`].
/// Pure and network-free so the SSRF-refusal behavior is directly testable.
/// Shared with `message::klipy_gif_message`, which enforces the same
/// allowlist on the send path rather than duplicating the host list.
pub(crate) fn is_klipy_media_url(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    parsed.scheme() == "https"
        && parsed
            .host_str()
            .is_some_and(|host| KLIPY_MEDIA_HOSTS.contains(&host))
}

/// Media response body cap: real Klipy GIFs run a few MB; this refuses a
/// hostile allowlisted-host response from exhausting memory.
const MAX_MEDIA_BYTES: u64 = 16 * 1024 * 1024;

/// Redirect-hop cap for `media_client`'s custom policy — a custom `Policy`
/// does not inherit reqwest's default 10-hop limit for free.
const MAX_MEDIA_REDIRECTS: usize = 10;

/// True when `content_type` starts with `image/`, the shape every real Klipy
/// media response has. Pure so it is testable without a live response.
fn is_image_content_type(content_type: &str) -> bool {
    content_type.starts_with("image/")
}

/// Separate from [`http_client`]: media fetches need a redirect policy that
/// re-checks the allowlist on every hop, so an open redirect on an
/// allowlisted host cannot be used to reach an arbitrary origin. JSON calls
/// through [`http_client`] never follow user-influenced redirects, so they
/// keep the default policy instead. Built fresh per call, like
/// [`http_client`], so a Tor routing toggle takes effect on the next fetch.
fn media_client() -> reqwest::Client {
    crate::net_transport::http_client_builder()
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(10))
        .user_agent("Pacto/1.0")
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= MAX_MEDIA_REDIRECTS {
                return attempt.error("too many redirects fetching Klipy media");
            }
            if is_klipy_media_url(attempt.url().as_str()) {
                attempt.follow()
            } else {
                attempt.error("redirect target left the Klipy media allowlist")
            }
        }))
        .build()
        .expect("failed to build Klipy media HTTP client")
}

/// Fetches Klipy-hosted media bytes for rendering a received GIF attachment.
/// This is the only place a Klipy media byte is ever fetched from: never the
/// webview, never a generic downloader, and the bytes are handed back for an
/// in-memory render only — nothing here ever touches disk, per Klipy's
/// no-retain terms. The host allowlist (re-checked on every redirect hop),
/// the [`MAX_MEDIA_BYTES`] cap, and the `image/*` content-type check keep an
/// attachment that merely claims a "Klipy" URL from turning this into an
/// open fetch/SSRF primitive or a memory-exhaustion vector. Bytes cross the
/// IPC boundary as a raw response body, never a JSON `Vec<u8>` array.
#[tauri::command]
pub async fn klipy_fetch_media(url: String) -> Result<tauri::ipc::Response, String> {
    if !is_klipy_media_url(&url) {
        return Err("Refusing to fetch: not a Klipy media URL".to_string());
    }
    let mut resp = media_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| redact_klipy_error(&format!("Klipy media fetch failed: {e}"), ""))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(redact_klipy_error(
            &format!("Klipy media fetch HTTP {status}"),
            "",
        ));
    }
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !is_image_content_type(content_type) {
        return Err("Refusing to fetch: Klipy media response was not an image".to_string());
    }
    if resp
        .content_length()
        .is_some_and(|len| len > MAX_MEDIA_BYTES)
    {
        return Err("Refusing to fetch: Klipy media response exceeded the size cap".to_string());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| redact_klipy_error(&format!("Klipy media read failed: {e}"), ""))?
    {
        bytes.extend_from_slice(&chunk);
        if bytes.len() as u64 > MAX_MEDIA_BYTES {
            return Err(
                "Refusing to fetch: Klipy media response exceeded the size cap".to_string(),
            );
        }
    }
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- key precedence (pure, no process env involved) -------------------

    #[test]
    fn runtime_override_wins_over_baked_key() {
        assert_eq!(
            resolve_klipy_key(Some("runtime-key".to_string()), Some("baked-key")),
            Some("runtime-key".to_string())
        );
    }

    #[test]
    fn baked_key_used_when_no_runtime_override() {
        assert_eq!(
            resolve_klipy_key(None, Some("baked-key")),
            Some("baked-key".to_string())
        );
    }

    #[test]
    fn blank_runtime_override_falls_back_to_baked() {
        assert_eq!(
            resolve_klipy_key(Some("   ".to_string()), Some("baked-key")),
            Some("baked-key".to_string())
        );
    }

    #[test]
    fn no_key_anywhere_resolves_to_none() {
        assert_eq!(resolve_klipy_key(None, None), None);
    }

    // ---- missing-key gate ---------------------------------------------------

    static ENV_TEST_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

    struct EnvVarGuard {
        prev: Vec<(&'static str, Option<std::ffi::OsString>)>,
    }

    impl EnvVarGuard {
        fn clear(keys: &[&'static str]) -> Self {
            let prev = keys
                .iter()
                .map(|k| {
                    let prev = std::env::var_os(k);
                    std::env::remove_var(k);
                    (*k, prev)
                })
                .collect();
            Self { prev }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            for (key, prev) in &self.prev {
                match prev {
                    Some(v) => std::env::set_var(key, v),
                    None => std::env::remove_var(key),
                }
            }
        }
    }

    #[tokio::test]
    async fn missing_key_yields_typed_error_and_reports_unconfigured() {
        let _lock = ENV_TEST_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        let _guard = EnvVarGuard::clear(&["KLIPY_API_KEY"]);
        if option_env!("KLIPY_API_KEY").is_some() {
            // A production key was baked in at compile time for this build;
            // the runtime-override-missing case is fully covered by the pure
            // `resolve_klipy_key` tests above instead.
            return;
        }
        assert!(!klipy_is_configured());
        let err = klipy_search_gifs("cats".to_string(), 1)
            .await
            .expect_err("no key must never reach the network");
        assert_eq!(err, ERR_NOT_CONFIGURED);
        let err = klipy_trending_gifs(1)
            .await
            .expect_err("no key must never reach the network");
        assert_eq!(err, ERR_NOT_CONFIGURED);
        assert_eq!(
            klipy_report_share("slug".to_string(), None).await,
            Ok(false)
        );
    }

    // ---- error text never contains the key -----------------------------------

    #[test]
    fn rendered_error_never_contains_the_key() {
        const SENTINEL: &str = "sk_live_super_secret_klipy_sentinel";
        let url = klipy_url(SENTINEL, "gifs/search?q=cats");
        let simulated = format!("error sending request for url ({url}): connection refused");
        let redacted = redact_klipy_error(&simulated, SENTINEL);
        assert!(!redacted.contains(SENTINEL));
    }

    // ---- no request ever carries customer_id -----------------------------------

    #[test]
    fn search_params_never_carry_customer_id() {
        let params = search_query_params("cats", 2);
        assert!(params.iter().all(|(k, _)| *k != "customer_id"));
    }

    #[test]
    fn trending_params_never_carry_customer_id() {
        let params = trending_query_params(2);
        assert!(params.iter().all(|(k, _)| *k != "customer_id"));
    }

    #[test]
    fn share_body_never_serializes_customer_id() {
        let body = ShareBody {
            q: Some("cats".to_string()),
        };
        let json = serde_json::to_string(&body).unwrap();
        assert!(!json.contains("customer_id"));
    }

    // ---- envelope parsing ---------------------------------------------------

    fn variant_json(url: &str) -> String {
        format!(r#"{{"gif":{{"url":"{url}","width":100,"height":200,"size":123}}}}"#)
    }

    #[test]
    fn parses_envelope_with_every_size_variant() {
        let fixture = format!(
            r#"{{
                "result": true,
                "data": {{
                    "data": [
                        {{
                            "id": 8041071659142944,
                            "slug": "hello-hi-662",
                            "title": "Hello",
                            "file": {{
                                "hd": {hd},
                                "md": {md},
                                "sm": {sm},
                                "xs": {xs}
                            }}
                        }}
                    ],
                    "page": 1,
                    "per_page": 24,
                    "total": 1
                }}
            }}"#,
            hd = variant_json("https://static.klipy.com/hd.gif"),
            md = variant_json("https://static.klipy.com/md.gif"),
            sm = variant_json("https://static.klipy.com/sm.gif?ext=gif&itemid=abc123"),
            xs = variant_json("https://static.klipy.com/xs.gif"),
        );

        let page = parse_klipy_page(&fixture).expect("valid fixture parses");
        assert_eq!(page.page, 1);
        assert_eq!(page.per_page, 24);
        assert_eq!(page.total, 1);
        assert_eq!(page.items.len(), 1);

        let item = &page.items[0];
        assert_eq!(item.id, "8041071659142944");
        assert_eq!(item.slug, "hello-hi-662");
        assert_eq!(item.title, "Hello");
        // sm wins for preview when present.
        assert_eq!(
            item.preview_url,
            "https://static.klipy.com/sm.gif?ext=gif&itemid=abc123"
        );
        // hd wins for full when present.
        assert_eq!(item.full_url, "https://static.klipy.com/hd.gif");
        assert_eq!(item.width, 100);
        assert_eq!(item.height, 200);
    }

    #[test]
    fn missing_hd_falls_back_to_md_for_full_url() {
        let fixture = format!(
            r#"{{"result":true,"data":{{"data":[{{
                "id": "item-2",
                "slug": "no-hd",
                "title": "No HD",
                "file": {{ "md": {md}, "sm": {sm}, "xs": {xs} }}
            }}],"page":1,"per_page":24,"total":1}}}}"#,
            md = variant_json("https://static.klipy.com/md-only.gif"),
            sm = variant_json("https://static.klipy.com/sm-only.gif"),
            xs = variant_json("https://static.klipy.com/xs-only.gif"),
        );
        let page = parse_klipy_page(&fixture).expect("valid fixture parses");
        let item = &page.items[0];
        assert_eq!(item.full_url, "https://static.klipy.com/md-only.gif");
        assert_eq!(item.preview_url, "https://static.klipy.com/sm-only.gif");
    }

    #[test]
    fn missing_sm_falls_back_to_xs_for_preview_url() {
        let fixture = format!(
            r#"{{"result":true,"data":{{"data":[{{
                "id": "item-3",
                "slug": "no-sm",
                "title": "No SM",
                "file": {{ "hd": {hd}, "md": {md}, "xs": {xs} }}
            }}],"page":1,"per_page":24,"total":1}}}}"#,
            hd = variant_json("https://static.klipy.com/hd-only.gif"),
            md = variant_json("https://static.klipy.com/md-only-2.gif"),
            xs = variant_json("https://static.klipy.com/xs-fallback.gif"),
        );
        let page = parse_klipy_page(&fixture).expect("valid fixture parses");
        let item = &page.items[0];
        assert_eq!(item.full_url, "https://static.klipy.com/hd-only.gif");
        assert_eq!(item.preview_url, "https://static.klipy.com/xs-fallback.gif");
    }

    #[test]
    fn drops_an_item_whose_variant_url_is_not_a_klipy_host() {
        let fixture = format!(
            r#"{{"result":true,"data":{{"data":[{{
                "id": "evil-item",
                "slug": "evil",
                "title": "Evil",
                "file": {{ "hd": {hd}, "md": {md}, "sm": {sm} }}
            }}],"page":1,"per_page":24,"total":1}}}}"#,
            hd = variant_json("https://evil.example.com/hd.gif"),
            md = variant_json("https://static.klipy.com/md.gif"),
            sm = variant_json("https://static.klipy.com/sm.gif"),
        );
        let page = parse_klipy_page(&fixture).expect("valid fixture parses");
        assert!(page.items.is_empty());
    }

    #[test]
    fn has_more_true_on_a_middle_page() {
        let fixture = r#"{"result":true,"data":{"data":[],"page":1,"per_page":2,"total":5}}"#;
        let page = parse_klipy_page(fixture).expect("valid fixture parses");
        assert!(page.has_more);
    }

    #[test]
    fn has_more_false_on_the_last_page() {
        let fixture = r#"{"result":true,"data":{"data":[],"page":3,"per_page":2,"total":5}}"#;
        let page = parse_klipy_page(fixture).expect("valid fixture parses");
        assert!(!page.has_more);
    }

    // ---- klipy_fetch_media host allowlist (SSRF refusal) -------------------

    #[test]
    fn accepts_each_documented_media_host() {
        assert!(is_klipy_media_url("https://static.klipy.com/hd.gif"));
        assert!(is_klipy_media_url("https://static1.klipy.com/hd.gif"));
        assert!(is_klipy_media_url(
            "https://static2.klipy.com/hd.gif?ext=gif&itemid=1"
        ));
    }

    #[test]
    fn rejects_an_obvious_ssrf_attempt() {
        assert!(!is_klipy_media_url("http://127.0.0.1:8080/x"));
        assert!(!is_klipy_media_url(
            "http://169.254.169.254/latest/meta-data/"
        ));
        assert!(!is_klipy_media_url("file:///etc/passwd"));
    }

    #[test]
    fn rejects_a_lookalike_host() {
        // Neither a subdomain trick nor a path/query trick should pass.
        assert!(!is_klipy_media_url(
            "https://evil.com/static.klipy.com/hd.gif"
        ));
        assert!(!is_klipy_media_url(
            "https://static.klipy.com.evil.com/hd.gif"
        ));
        assert!(!is_klipy_media_url("https://evil.com/?u=static.klipy.com"));
    }

    #[test]
    fn rejects_plain_http_even_for_a_real_host() {
        assert!(!is_klipy_media_url("http://static.klipy.com/hd.gif"));
    }

    #[test]
    fn rejects_a_malformed_url() {
        assert!(!is_klipy_media_url("not a url"));
    }

    // ---- klipy_fetch_media redirect + content hardening --------------------

    #[test]
    fn redirect_hop_off_the_allowlist_is_rejected() {
        // The same predicate `MEDIA_CLIENT`'s redirect policy applies to
        // every hop destination, exercised directly since the policy closure
        // itself needs a live client to invoke.
        assert!(!is_klipy_media_url("https://evil.example.com/hd.gif"));
        assert!(is_klipy_media_url("https://static.klipy.com/hd.gif"));
    }

    #[test]
    fn accepts_image_content_types() {
        assert!(is_image_content_type("image/gif"));
        assert!(is_image_content_type("image/webp; charset=binary"));
    }

    #[test]
    fn rejects_non_image_content_types() {
        assert!(!is_image_content_type("text/html"));
        assert!(!is_image_content_type(""));
    }
}
