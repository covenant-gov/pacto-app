//! Shared read-only governance context: network resolution + RPC provider.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use super::rpc::{connect_read_provider, wallet_err_json};
use super::wallet_chain_config;

pub struct GovReadNetwork {
    pub key: String,
    pub chain_id: u64,
    pub rpc_urls: Vec<String>,
}

fn host_without_brackets(host: &str) -> &str {
    host.trim()
        .strip_prefix('[')
        .and_then(|h| h.strip_suffix(']'))
        .unwrap_or(host)
}

fn is_loopback_host(host: &str) -> bool {
    let h = host_without_brackets(host);
    if h.eq_ignore_ascii_case("localhost") {
        return true;
    }
    match h.parse::<IpAddr>() {
        Ok(ip) => ip.is_loopback(),
        Err(_) => false,
    }
}

/// Literal non-loopback IPs that must not be reached (private, link-local, unspecified, etc.).
fn is_restricted_non_loopback_ip(host: &str) -> bool {
    let h = host_without_brackets(host);
    let Ok(ip) = h.parse::<IpAddr>() else {
        return false;
    };
    if ip.is_loopback() {
        return false;
    }
    match ip {
        IpAddr::V4(v4) => {
            v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || is_documentation_v4(v4)
                || is_carrier_grade_nat(v4)
        }
        IpAddr::V6(v6) => {
            v6.is_unspecified() || is_unique_local_v6(v6) || is_link_local_v6(v6) || is_documentation_v6(v6)
        }
    }
}

fn is_carrier_grade_nat(v4: Ipv4Addr) -> bool {
    let o = v4.octets();
    o[0] == 100 && (o[1] & 0xc0) == 64
}

fn is_documentation_v4(v4: Ipv4Addr) -> bool {
    matches!(
        v4.octets(),
        [192, 0, 2, _] | [198, 51, 100, _] | [203, 0, 113, _]
    )
}

fn is_unique_local_v6(v6: Ipv6Addr) -> bool {
    (v6.segments()[0] & 0xfe00) == 0xfc00
}

fn is_link_local_v6(v6: Ipv6Addr) -> bool {
    (v6.segments()[0] & 0xffc0) == 0xfe80
}

fn is_documentation_v6(v6: Ipv6Addr) -> bool {
    let s = v6.segments();
    s[0] == 0x2001 && s[1] == 0xdb8
}

/// https for public/hostname/loopback; http only for loopback. Drops other schemes and SSRF targets.
pub(crate) fn is_allowed_rpc_url(raw: &str) -> bool {
    let Ok(parsed) = url::Url::parse(raw) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    match parsed.scheme() {
        "https" => !is_restricted_non_loopback_ip(host),
        "http" => is_loopback_host(host),
        _ => false,
    }
}

pub(crate) fn sanitize_rpc_urls(raw: Option<Vec<String>>) -> Vec<String> {
    let Some(list) = raw else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for url in list {
        let trimmed = url.trim().to_string();
        if trimmed.is_empty() || !is_allowed_rpc_url(&trimmed) {
            continue;
        }
        let key = trimmed.to_lowercase();
        if !seen.insert(key) {
            continue;
        }
        out.push(trimmed);
    }
    out
}

/// Prefer non-empty FE override list; otherwise curated/operator defaults for `net`.
pub fn rpc_urls_or_default(
    net: &wallet_chain_config::WalletNetworkConfig,
    rpc_urls_override: Option<Vec<String>>,
) -> Vec<String> {
    let override_urls = sanitize_rpc_urls(rpc_urls_override);
    if !override_urls.is_empty() {
        override_urls
    } else {
        wallet_chain_config::rpc_urls_for(net).to_vec()
    }
}

pub fn resolve_gov_read_network(
    network: &str,
    rpc_urls_override: Option<Vec<String>>,
) -> Result<GovReadNetwork, String> {
    let net_key = network.to_lowercase();
    let Some(net) = wallet_chain_config::network_by_key(&net_key) else {
        return Err(wallet_err_json(
            "UNSUPPORTED_NETWORK",
            format!("Unknown network: {}", network),
            None,
        ));
    };
    let urls = rpc_urls_or_default(net, rpc_urls_override);
    if urls.is_empty() {
        return Err(wallet_err_json(
            "RPC_CONFIG",
            "no RPC URL configured",
            None,
        ));
    }
    Ok(GovReadNetwork {
        key: net.key.clone(),
        chain_id: net.chain_id,
        rpc_urls: urls,
    })
}

pub async fn connect_gov_read_provider(
    network: &str,
    rpc_urls_override: Option<Vec<String>>,
) -> Result<(impl alloy::providers::Provider + Clone, GovReadNetwork), String> {
    let ctx = resolve_gov_read_network(network, rpc_urls_override)?;
    let provider = connect_read_provider(&ctx.rpc_urls).await?;
    Ok((provider, ctx))
}

#[cfg(test)]
mod tests {
    use super::{is_allowed_rpc_url, resolve_gov_read_network, sanitize_rpc_urls};

    #[test]
    fn sanitize_dedupes_and_trims() {
        let urls = sanitize_rpc_urls(Some(vec![
            " https://a.example/rpc ".into(),
            "https://a.example/rpc".into(),
            "".into(),
            "https://b.example/rpc".into(),
        ]));
        assert_eq!(urls, vec!["https://a.example/rpc", "https://b.example/rpc"]);
    }

    #[test]
    fn sanitize_rejects_ssrf_and_non_http_schemes() {
        let urls = sanitize_rpc_urls(Some(vec![
            "file:///etc/passwd".into(),
            "http://169.254.169.254/latest/meta-data".into(),
            "https://169.254.169.254/latest/meta-data".into(),
            "http://10.0.0.1:8545".into(),
            "https://10.0.0.1:8545".into(),
            "http://example.com/rpc".into(),
            "ftp://example.com/rpc".into(),
            "http://localhost:8545".into(),
            "https://custom.example/rpc".into(),
        ]));
        assert_eq!(
            urls,
            vec!["http://localhost:8545", "https://custom.example/rpc"]
        );
    }

    #[test]
    fn allowed_rpc_url_rules() {
        assert!(is_allowed_rpc_url("https://eth-sepolia.g.alchemy.com/v2/key"));
        assert!(is_allowed_rpc_url("http://localhost:8545"));
        assert!(is_allowed_rpc_url("http://127.0.0.1:8545"));
        assert!(is_allowed_rpc_url("https://127.0.0.1:8545"));
        assert!(!is_allowed_rpc_url("http://192.168.1.1:8545"));
        assert!(!is_allowed_rpc_url("https://192.168.1.1:8545"));
        assert!(!is_allowed_rpc_url("file://localhost/rpc"));
    }

    #[test]
    fn override_urls_win_over_defaults() {
        let ctx = resolve_gov_read_network(
            "sepolia",
            Some(vec!["https://custom.example/rpc".into()]),
        )
        .expect("resolve");
        assert_eq!(ctx.rpc_urls, vec!["https://custom.example/rpc"]);
    }

    #[test]
    fn override_list_preserves_order() {
        let ctx = resolve_gov_read_network(
            "sepolia",
            Some(vec![
                "https://first.example/rpc".into(),
                "https://second.example/rpc".into(),
            ]),
        )
        .expect("resolve");
        assert_eq!(
            ctx.rpc_urls,
            vec!["https://first.example/rpc", "https://second.example/rpc"]
        );
    }

    #[test]
    fn invalid_override_urls_fall_back_to_defaults() {
        let ctx = resolve_gov_read_network(
            "sepolia",
            Some(vec![
                "http://169.254.169.254/".into(),
                "file:///tmp/x".into(),
            ]),
        )
        .expect("resolve");
        assert!(!ctx.rpc_urls.is_empty());
        assert!(ctx.rpc_urls.iter().all(|u| u.starts_with("http")));
        assert!(!ctx.rpc_urls.iter().any(|u| u.contains("169.254")));
    }
}

pub fn parse_top_hat_id(raw: &str) -> Result<alloy::primitives::U256, String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err("top_hat_id must be non-empty".to_string());
    }
    if s.starts_with("0x") || s.starts_with("0X") {
        alloy::primitives::U256::from_str_radix(s.trim_start_matches("0x").trim_start_matches("0X"), 16)
            .map_err(|e| format!("invalid hex top_hat_id: {e}"))
    } else {
        alloy::primitives::U256::from_str_radix(s, 10)
            .map_err(|e| format!("invalid decimal top_hat_id: {e}"))
    }
}
