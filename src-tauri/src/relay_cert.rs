//! Certificate parsing and expiry classification for the relay diagnostics
//! certificate panel, plus the isolated TLS capture path that reaches a
//! certificate a normal handshake would refuse to complete on.
//!
//! Parsing performs no signature or chain validation; a certificate is
//! reported on its own terms here, never vouched for (see
//! docs/plans/2026-08-14-001-feat-relay-diagnostics-plan.md, KTD4). The
//! capture path below exists for exactly one reason: a normally configured
//! TLS client aborts the handshake before an expired or otherwise untrusted
//! certificate's chain is ever readable. Its permissive verifier and the
//! client configuration built around it are private to this file -- the
//! module boundary is the containment mechanism, not a convention, because
//! `src-tauri/src/lib.rs` is the crate root and a private item there would
//! be reachable from every other module via `crate::`. The containment
//! tests at the bottom of this file's `#[cfg(test)]` block enforce that
//! structurally rather than by review.

use parking_lot::RwLock;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::time::Duration;
use x509_parser::prelude::{FromDer, GeneralName, X509Certificate};
use x509_parser::public_key::PublicKey;

/// Parsed metadata from a relay's leaf TLS certificate.
///
/// `trust_not_evaluated` is always `true`: this module never performs
/// signature or chain validation, so no consumer of this type may render it
/// as a verified/trusted result (KTD4, R14).
#[derive(Debug, Clone, serde::Serialize)]
pub(crate) struct RelayCertificate {
    pub(crate) subject: String,
    pub(crate) issuer: String,
    pub(crate) not_before: i64,
    pub(crate) not_after: i64,
    pub(crate) san_dns_names: Vec<String>,
    pub(crate) public_key_algorithm: String,
    pub(crate) public_key_bits: u32,
    pub(crate) sha256_fingerprint: String,
    pub(crate) trust_not_evaluated: bool,
}

/// A DER certificate that could not be parsed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CertParseError(String);

impl std::fmt::Display for CertParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "failed to parse certificate: {}", self.0)
    }
}

impl std::error::Error for CertParseError {}

/// Parse a leaf certificate's raw DER bytes into [`RelayCertificate`].
///
/// Never panics: malformed or truncated input returns [`CertParseError`]
/// rather than unwinding.
pub(crate) fn parse_certificate(der: &[u8]) -> Result<RelayCertificate, CertParseError> {
    let (_, cert) = X509Certificate::from_der(der).map_err(|e| CertParseError(format!("{e:?}")))?;

    let public_key = cert
        .public_key()
        .parsed()
        .map_err(|e| CertParseError(format!("public key: {e:?}")))?;

    let san_dns_names = match cert.subject_alternative_name() {
        Ok(Some(ext)) => ext
            .value
            .general_names
            .iter()
            .filter_map(|name| match name {
                GeneralName::DNSName(dns) => Some((*dns).to_string()),
                _ => None,
            })
            .collect(),
        Ok(None) => Vec::new(),
        Err(e) => return Err(CertParseError(format!("subject alternative name: {e:?}"))),
    };

    Ok(RelayCertificate {
        subject: cert.subject().to_string(),
        issuer: cert.issuer().to_string(),
        not_before: cert.validity().not_before.timestamp(),
        not_after: cert.validity().not_after.timestamp(),
        san_dns_names,
        public_key_algorithm: public_key_algorithm_name(&public_key).to_string(),
        public_key_bits: public_key.key_size() as u32,
        sha256_fingerprint: hex::encode(Sha256::digest(der)),
        trust_not_evaluated: true,
    })
}

fn public_key_algorithm_name(key: &PublicKey<'_>) -> &'static str {
    match key {
        PublicKey::RSA(_) => "RSA",
        PublicKey::EC(_) => "EC",
        PublicKey::DSA(_) => "DSA",
        PublicKey::GostR3410(_) => "GostR3410",
        PublicKey::GostR3410_2012(_) => "GostR3410_2012",
        PublicKey::Unknown(_) => "Unknown",
    }
}

/// The expiring-soon threshold, in seconds. Single authority for the 30-day
/// value used by the certificate panel; nothing else in the crate or the
/// frontend recomputes it (KTD10).
const EXPIRING_SOON_THRESHOLD_SECS: i64 = 30 * 24 * 60 * 60;

/// A certificate's expiry state relative to a reference time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ExpiryVerdict {
    Valid,
    ExpiringSoon,
    Expired,
}

/// Classifies `not_after_unix` relative to `now_unix`. The caller supplies
/// the current time (rather than this function reading the system clock) so
/// boundary cases are deterministic in tests. A certificate exactly at or
/// past its `not_after` is always `Expired`, taking precedence over the
/// expiring-soon window; a certificate with 30 days or less remaining is
/// `ExpiringSoon`; anything further out is `Valid`.
pub(crate) fn expiry_verdict(not_after_unix: i64, now_unix: i64) -> ExpiryVerdict {
    if not_after_unix <= now_unix {
        return ExpiryVerdict::Expired;
    }
    if not_after_unix - now_unix <= EXPIRING_SOON_THRESHOLD_SECS {
        ExpiryVerdict::ExpiringSoon
    } else {
        ExpiryVerdict::Valid
    }
}

/// Deadline covering both the TCP connect and the TLS handshake below,
/// matching the pre-add probe's budget (U3) so a stalled or unresponsive
/// host cannot hang the certificate panel indefinitely.
const HANDSHAKE_DEADLINE: Duration = Duration::from_secs(10);

/// A `rustls` server-certificate verifier that performs no trust validation
/// at all: every certificate chain and every signature is accepted
/// unconditionally. This is what lets the handshake below finish against a
/// self-signed or expired certificate, so the chain can be read back off
/// the connection and handed to [`parse_certificate`], rather than the
/// handshake aborting before that chain is ever reachable (KTD4).
///
/// Deliberately private, along with every function below that builds a TLS
/// client configuration around it: this file's only crate-visible items are
/// [`fetch_certificate`] and [`clear_certificate_cache`], and neither hands
/// the verifier or its configuration out. The containment tests below
/// enforce that no second construction site exists anywhere else in the
/// crate.
#[derive(Debug)]
struct CaptureOnlyVerifier;

impl rustls::client::danger::ServerCertVerifier for CaptureOnlyVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        // Delegates to the process-default provider instead of listing
        // schemes by hand, so this verifier never becomes a second provider.
        rustls::crypto::CryptoProvider::get_default()
            .expect("rustls default crypto provider not installed")
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// Builds the TLS client configuration around [`CaptureOnlyVerifier`].
/// Private for the same containment reason as the verifier itself.
fn capture_only_client_config() -> rustls::ClientConfig {
    rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(std::sync::Arc::new(CaptureOnlyVerifier))
        .with_no_client_auth()
}

/// Parses `url` for a `wss://` host and port. Returns `None` for any other
/// scheme, including a URL that fails to parse at all, before any socket is
/// touched (R10). The default port (443 when the URL carries none) follows
/// the same WHATWG special-scheme rule the `url` crate already applies to
/// `https`.
fn wss_host_port(url: &str) -> Option<(String, u16)> {
    let parsed = url::Url::parse(url).ok()?;
    if parsed.scheme() != "wss" {
        return None;
    }
    let host = parsed.host_str()?.to_string();
    let port = parsed.port_or_known_default()?;
    Some((host, port))
}

/// Connects to `host:port` and completes a TLS handshake under
/// [`capture_only_client_config`], returning the leaf certificate's raw DER
/// on success. TCP connect and the TLS handshake share one
/// [`HANDSHAKE_DEADLINE`]; a host that accepts the TCP connection and then
/// never completes the handshake returns `None` instead of hanging.
async fn capture_leaf_der(host: &str, port: u16) -> Option<Vec<u8>> {
    let attempt = async {
        let tcp = tokio::net::TcpStream::connect((host, port)).await.ok()?;
        let server_name = rustls::pki_types::ServerName::try_from(host.to_string()).ok()?;
        let connector =
            tokio_rustls::TlsConnector::from(std::sync::Arc::new(capture_only_client_config()));
        let tls_stream = connector.connect(server_name, tcp).await.ok()?;
        // The chain rustls actually received during the handshake, read back
        // off the completed connection rather than tracked separately.
        let (_, connection) = tls_stream.get_ref();
        let leaf = connection.peer_certificates()?.first()?;
        Some(leaf.as_ref().to_vec())
    };
    tokio::time::timeout(HANDSHAKE_DEADLINE, attempt)
        .await
        .ok()
        .flatten()
}

/// Certificates already fetched this process, keyed by
/// [`crate::cmds::relays::normalize_relay_url`] -- the same normalization every other
/// diagnostics static in the crate uses (KTD7).
static RELAY_CERTIFICATES: std::sync::LazyLock<RwLock<HashMap<String, RelayCertificate>>> =
    std::sync::LazyLock::new(|| RwLock::new(HashMap::new()));

/// Returns the certificate a `wss://` relay presents, serving a cached
/// result when one exists instead of re-running the handshake. A
/// non-`wss://` URL returns `None` immediately without opening a socket
/// (R10). A handshake that fails, times out, or produces a certificate this
/// module can't parse also returns `None`: the certificate panel has
/// exactly two renderable states -- a certificate, or nothing to show -- so
/// a timeout is treated the same as any other unreachable candidate rather
/// than surfacing as a distinct command error.
pub(crate) async fn fetch_certificate(url: &str) -> Option<RelayCertificate> {
    let (host, port) = wss_host_port(url)?;
    let key = crate::cmds::relays::normalize_relay_url(url);

    if let Some(cached) = RELAY_CERTIFICATES.read().get(&key).cloned() {
        return Some(cached);
    }

    let der = capture_leaf_der(&host, port).await?;
    let cert = parse_certificate(&der).ok()?;

    RELAY_CERTIFICATES.write().insert(key, cert.clone());

    Some(cert)
}

/// Clears every cached certificate. Called on logout (R15) so a certificate
/// captured under one account is never served under the next.
pub(crate) fn clear_certificate_cache() {
    RELAY_CERTIFICATES.write().clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    use rcgen::{CertificateParams, KeyPair};
    use time::{Duration, OffsetDateTime};

    /// Mints a self-signed DER certificate with the given SANs and validity
    /// window, driving `x509-parser` directly against the raw bytes rcgen
    /// produces. No socket involved.
    fn mint(
        subject_alt_names: Vec<String>,
        not_before: OffsetDateTime,
        not_after: OffsetDateTime,
    ) -> Vec<u8> {
        let mut params = CertificateParams::new(subject_alt_names).expect("valid SAN input");
        params.not_before = not_before;
        params.not_after = not_after;
        let key_pair = KeyPair::generate().expect("key pair generation");
        let cert = params.self_signed(&key_pair).expect("self-signed cert");
        cert.der().to_vec()
    }

    #[test]
    fn parses_year_valid_certificate_metadata() {
        let now = OffsetDateTime::now_utc();
        let der = mint(
            vec!["relay.example.com".to_string()],
            now - Duration::days(1),
            now + Duration::days(365),
        );

        let cert = parse_certificate(&der).expect("parse succeeds");

        assert!(cert.subject.contains("rcgen self signed cert"));
        assert_eq!(
            cert.subject, cert.issuer,
            "self-signed cert is its own issuer"
        );
        assert_eq!(cert.san_dns_names, vec!["relay.example.com".to_string()]);
        assert_eq!(cert.public_key_algorithm, "EC");
        assert_eq!(cert.public_key_bits, 256);
        assert!(cert.trust_not_evaluated);
    }

    #[test]
    fn expired_certificate_parses_and_reports_expired_with_populated_metadata() {
        let now = OffsetDateTime::now_utc();
        let der = mint(
            vec!["expired.example.com".to_string()],
            now - Duration::days(2),
            now - Duration::days(1), // validity ended yesterday
        );

        let cert = parse_certificate(&der).expect("parse succeeds even when expired");

        assert!(!cert.subject.is_empty());
        assert!(!cert.issuer.is_empty());
        assert_eq!(cert.san_dns_names, vec!["expired.example.com".to_string()]);
        assert_eq!(cert.public_key_algorithm, "EC");
        assert_eq!(cert.public_key_bits, 256);
        assert_eq!(
            expiry_verdict(cert.not_after, now.unix_timestamp()),
            ExpiryVerdict::Expired
        );
    }

    #[test]
    fn exactly_thirty_days_remaining_is_expiring_soon() {
        let now_unix = 1_700_000_000_i64;
        let not_after = now_unix + EXPIRING_SOON_THRESHOLD_SECS;
        assert_eq!(
            expiry_verdict(not_after, now_unix),
            ExpiryVerdict::ExpiringSoon
        );
    }

    #[test]
    fn one_second_past_thirty_days_remaining_is_valid() {
        let now_unix = 1_700_000_000_i64;
        let not_after = now_unix + EXPIRING_SOON_THRESHOLD_SECS + 1;
        assert_eq!(expiry_verdict(not_after, now_unix), ExpiryVerdict::Valid);
    }

    #[test]
    fn not_after_equal_to_now_is_expired_not_expiring_soon() {
        let now_unix = 1_700_000_000_i64;
        assert_eq!(expiry_verdict(now_unix, now_unix), ExpiryVerdict::Expired);
    }

    #[test]
    fn far_future_expiry_is_valid() {
        let now_unix = 1_700_000_000_i64;
        assert_eq!(
            expiry_verdict(now_unix + 400 * 24 * 60 * 60, now_unix),
            ExpiryVerdict::Valid
        );
    }

    #[test]
    fn long_past_expiry_is_expired() {
        let now_unix = 1_700_000_000_i64;
        assert_eq!(
            expiry_verdict(now_unix - 400 * 24 * 60 * 60, now_unix),
            ExpiryVerdict::Expired
        );
    }

    #[test]
    fn fingerprint_matches_independent_sha256_digest() {
        let now = OffsetDateTime::now_utc();
        let der = mint(
            vec!["fingerprint.example.com".to_string()],
            now - Duration::days(1),
            now + Duration::days(365),
        );

        let cert = parse_certificate(&der).expect("parse succeeds");

        let mut hasher = Sha256::new();
        hasher.update(&der);
        let expected = hex::encode(hasher.finalize());

        assert_eq!(cert.sha256_fingerprint, expected);
    }

    #[test]
    fn certificate_without_san_extension_parses_with_empty_san_list() {
        let now = OffsetDateTime::now_utc();
        // Empty subject_alt_names means rcgen omits the SAN extension
        // entirely, not that it writes an empty one.
        let der = mint(
            Vec::new(),
            now - Duration::days(1),
            now + Duration::days(365),
        );

        let cert = parse_certificate(&der).expect("parse succeeds without SAN extension");

        assert!(cert.san_dns_names.is_empty());
    }

    #[test]
    fn malformed_der_returns_error_without_panicking() {
        let garbage = [0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01, 0x02];
        assert!(parse_certificate(&garbage).is_err());
    }

    #[test]
    fn empty_der_returns_error_without_panicking() {
        assert!(parse_certificate(&[]).is_err());
    }

    #[test]
    fn truncated_der_returns_error_without_panicking() {
        let now = OffsetDateTime::now_utc();
        let der = mint(
            vec!["truncated.example.com".to_string()],
            now - Duration::days(1),
            now + Duration::days(365),
        );
        let truncated = &der[..der.len() / 2];

        assert!(parse_certificate(truncated).is_err());
    }

    #[test]
    fn trust_not_evaluated_marker_is_present_on_every_successful_parse() {
        let now = OffsetDateTime::now_utc();
        let der = mint(
            vec!["marker.example.com".to_string()],
            now - Duration::days(1),
            now + Duration::days(365),
        );

        let cert = parse_certificate(&der).expect("parse succeeds");

        assert!(cert.trust_not_evaluated);
    }

    /// Installs the `aws_lc_rs` crypto provider as the process default,
    /// once per test binary. `main.rs`'s own install never links into
    /// `cargo test --lib`, and with both provider crate features enabled
    /// rustls cannot infer one from crate features alone, so every test
    /// below that builds a TLS client or server configuration calls this
    /// first. A second install attempt in the same process is expected;
    /// its `Err` is ignored deliberately.
    fn ensure_test_crypto_provider() {
        static INSTALL: std::sync::Once = std::sync::Once::new();
        INSTALL.call_once(|| {
            let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
        });
    }

    /// Mints a self-signed identity valid over `[not_before, not_after]`,
    /// ready for `rustls::ServerConfig`'s single-certificate resolver.
    fn mint_server_identity(
        not_before: OffsetDateTime,
        not_after: OffsetDateTime,
    ) -> (
        rustls::pki_types::CertificateDer<'static>,
        rustls::pki_types::PrivateKeyDer<'static>,
    ) {
        let mut params =
            CertificateParams::new(vec!["127.0.0.1".to_string()]).expect("valid SAN input");
        params.not_before = not_before;
        params.not_after = not_after;
        let key_pair = KeyPair::generate().expect("key pair generation");
        let cert = params.self_signed(&key_pair).expect("self-signed cert");
        let key_der = rustls::pki_types::PrivateKeyDer::Pkcs8(
            rustls::pki_types::PrivatePkcs8KeyDer::from(key_pair.serialize_der()),
        );
        (cert.der().clone(), key_der)
    }

    /// Binds a loopback TLS listener presenting an already-expired
    /// self-signed certificate, accepts exactly one connection, completes
    /// the server-side handshake, then exits -- so a second real connection
    /// attempt against the same port is refused immediately rather than
    /// hanging. Shared by the integration, containment-regression, and
    /// cache tests below.
    async fn spawn_expired_cert_listener() -> (u16, tokio::task::JoinHandle<()>) {
        ensure_test_crypto_provider();
        let now = OffsetDateTime::now_utc();
        let (cert_der, key_der) =
            mint_server_identity(now - Duration::days(2), now - Duration::days(1));

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind loopback listener");
        let port = listener.local_addr().expect("local addr").port();

        let server_config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![cert_der], key_der)
            .expect("valid self-signed server identity");
        let acceptor = tokio_rustls::TlsAcceptor::from(std::sync::Arc::new(server_config));

        let handle = tokio::spawn(async move {
            if let Ok((stream, _)) = listener.accept().await {
                if let Ok(mut tls) = acceptor.accept(stream).await {
                    // Hold briefly so the client finishes reading the
                    // handshake before this task exits and the socket
                    // closes.
                    let mut buf = [0u8; 1];
                    let _ = tokio::time::timeout(
                        std::time::Duration::from_millis(500),
                        tokio::io::AsyncReadExt::read(&mut tls, &mut buf),
                    )
                    .await;
                }
            }
        });

        (port, handle)
    }

    /// End-to-end proof of KTD4's core claim: a normally configured TLS
    /// client aborts on an expired self-signed certificate before its
    /// chain is readable, but the capture path here reaches it, parses it,
    /// and reports it as expired with real metadata populated -- something
    /// the byte-level parser tests above, which never open a socket,
    /// cannot exercise.
    #[tokio::test]
    async fn expired_certificate_handshake_completes_and_reports_expired() {
        let (port, _server) = spawn_expired_cert_listener().await;
        let now_unix = OffsetDateTime::now_utc().unix_timestamp();

        let cert = fetch_certificate(&format!("wss://127.0.0.1:{port}"))
            .await
            .expect("handshake against an expired self-signed certificate must still complete");

        assert!(!cert.subject.is_empty());
        assert!(!cert.issuer.is_empty());
        assert_eq!(cert.public_key_algorithm, "EC");
        assert!(cert.trust_not_evaluated);
        assert_eq!(
            expiry_verdict(cert.not_after, now_unix),
            ExpiryVerdict::Expired
        );

        clear_certificate_cache();
    }

    /// Containment regression: the app's normal relay pool, pointed at the
    /// exact same listener and certificate, must still fail. If this ever
    /// passes with `Ok(_)`, the permissive verifier above has leaked into
    /// the real relay connection path.
    #[tokio::test]
    async fn normal_relay_pool_still_rejects_the_same_expired_certificate() {
        let (port, _server) = spawn_expired_cert_listener().await;

        let pool = nostr_sdk::prelude::RelayPool::new();
        let url = format!("wss://127.0.0.1:{port}");
        pool.add_relay(
            &url,
            nostr_sdk::prelude::RelayOptions::new().reconnect(false),
        )
        .await
        .expect("add_relay");
        let relay = pool.relay(&url).await.expect("relay handle");

        let err = relay
            .try_connect(std::time::Duration::from_secs(5))
            .await
            .expect_err("the real relay pool must reject an expired self-signed certificate");

        assert_eq!(
            crate::cmds::relays::classify_relay_error(&err).code,
            crate::cmds::relays::RelayFailureCode::TlsFailed,
            "the permissive verifier in this module must be unreachable from the real relay pool"
        );

        pool.shutdown().await;
    }

    #[tokio::test]
    async fn ws_url_returns_no_certificate_without_opening_a_socket() {
        let start = std::time::Instant::now();
        // A TEST-NET-1 (RFC 5737) address: guaranteed never to route
        // anywhere, so a real connection attempt here would hang for
        // seconds rather than fail fast. Finishing quickly is the cheap
        // proxy for "no socket was opened" -- `wss_host_port` rejects the
        // scheme before any I/O happens.
        let result = fetch_certificate("ws://192.0.2.1:9").await;
        let elapsed = start.elapsed();

        assert!(result.is_none());
        assert!(
            elapsed < std::time::Duration::from_secs(1),
            "a ws:// URL must never open a socket, took {elapsed:?}"
        );
    }

    #[tokio::test]
    async fn handshake_that_never_completes_times_out_within_deadline() {
        ensure_test_crypto_provider();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind loopback listener");
        let port = listener.local_addr().expect("local addr").port();

        tokio::spawn(async move {
            // Accept and hold the raw TCP connection open without ever
            // speaking TLS, so the client's handshake read genuinely blocks
            // until the deadline fires rather than failing fast.
            if let Ok((stream, _)) = listener.accept().await {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                drop(stream);
            }
        });

        let start = std::time::Instant::now();
        let result = capture_leaf_der("127.0.0.1", port).await;
        let elapsed = start.elapsed();

        assert!(result.is_none());
        assert!(
            elapsed < std::time::Duration::from_secs(12),
            "expected the handshake to time out near the 10s deadline, took {elapsed:?}"
        );
    }

    #[tokio::test]
    async fn cached_certificate_is_served_without_a_second_handshake() {
        let (port, _server) = spawn_expired_cert_listener().await;
        let url = format!("wss://127.0.0.1:{port}");

        // The listener above accepts exactly one connection and then
        // exits, so a second real handshake attempt against this port
        // would be refused immediately. A second `fetch_certificate` call
        // that still succeeds and agrees with the first proves it was
        // served from the cache, not a second connection.
        let first = fetch_certificate(&url)
            .await
            .expect("first fetch performs the real handshake");
        let second = fetch_certificate(&url)
            .await
            .expect("second fetch must be served from cache, not a second handshake");

        assert_eq!(first.sha256_fingerprint, second.sha256_fingerprint);

        clear_certificate_cache();
    }

    #[test]
    fn logout_clears_the_certificate_cache() {
        let _guard = crate::cmds::relays::DIAGNOSTICS_TEST_LOCK.lock();
        let url = "wss://logout-clears-relay-cert-cache.example";
        let normalized = crate::cmds::relays::normalize_relay_url(url);
        let fixture = RelayCertificate {
            subject: "CN=fixture".to_string(),
            issuer: "CN=fixture".to_string(),
            not_before: 0,
            not_after: 0,
            san_dns_names: Vec::new(),
            public_key_algorithm: "EC".to_string(),
            public_key_bits: 256,
            sha256_fingerprint: "fixture".to_string(),
            trust_not_evaluated: true,
        };
        RELAY_CERTIFICATES
            .write()
            .insert(normalized.clone(), fixture);
        assert!(RELAY_CERTIFICATES.read().contains_key(&normalized));

        clear_certificate_cache();

        assert!(!RELAY_CERTIFICATES.read().contains_key(&normalized));
    }

    /// Recursively collects every `.rs` file under `dir`. No `walkdir`
    /// dependency exists in this crate, so this is a small manual
    /// recursion rather than a new dependency for one test.
    fn collect_rs_files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_rs_files(&path, out);
            } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
                out.push(path);
            }
        }
    }

    /// Strips every real `#[cfg(test)]`-gated `mod { ... }` block out of `src`
    /// by brace matching, so the counts below reflect only non-test code.
    /// Every `#[cfg(test)]` in this crate gates a whole top-level `mod`
    /// block rather than a single function, which is what makes this a
    /// reliable strip instead of a guess. A `#[cfg(test)]` occurrence not
    /// immediately followed by `mod` (for example this very doc comment,
    /// which mentions the attribute as prose) is left untouched rather
    /// than treated as a block to strip. This does not tokenize Rust, so a
    /// brace inside a string literal could in principle miscount; a brace
    /// that is itself a single-character literal (`'{'` / `'}'`, as this
    /// function's own match arms below use) is excluded from the count
    /// explicitly, since without that exclusion this function would
    /// misparse its own source file.
    fn strip_cfg_test_blocks(src: &str) -> String {
        const ATTR: &str = "#[cfg(test)]";
        let mut out = String::with_capacity(src.len());
        let mut rest = src;
        while let Some(marker_pos) = rest.find(ATTR) {
            let after_attr = &rest[marker_pos + ATTR.len()..];
            let trimmed = after_attr.trim_start();
            if !trimmed.starts_with("mod ") {
                // Not a real attribute on a `mod` item -- most likely a doc
                // comment or string mentioning the literal text. Keep
                // everything through here verbatim and keep scanning.
                let keep_to = rest.len() - after_attr.len();
                out.push_str(&rest[..keep_to]);
                rest = after_attr;
                continue;
            }
            out.push_str(&rest[..marker_pos]);
            let ws_len = after_attr.len() - trimmed.len();
            let Some(brace_offset) = trimmed.find('{') else {
                // `mod` with no block body (shouldn't happen for a real
                // item); keep the attribute text and move past it.
                let keep_to = rest.len() - after_attr.len();
                out.push_str(&rest[marker_pos..keep_to]);
                rest = after_attr;
                continue;
            };
            let block_start = marker_pos + ATTR.len() + ws_len + brace_offset;
            let mut depth = 0usize;
            let mut end = None;
            let segment = &rest[block_start..];
            let segment_bytes = segment.as_bytes();
            for (i, ch) in segment.char_indices() {
                if matches!(ch, '{' | '}')
                    && i > 0
                    && segment_bytes.get(i - 1) == Some(&b'\'')
                    && segment_bytes.get(i + 1) == Some(&b'\'')
                {
                    // A brace wrapped in single quotes is a char literal,
                    // not a structural brace -- see the doc comment above.
                    continue;
                }
                match ch {
                    '{' => depth += 1,
                    '}' => {
                        depth -= 1;
                        if depth == 0 {
                            end = Some(block_start + i + 1);
                            break;
                        }
                    }
                    _ => {}
                }
            }
            let Some(end) = end else {
                // Unbalanced braces after the attribute; keep the
                // remainder unstripped rather than looping forever.
                out.push_str(&rest[marker_pos..]);
                rest = "";
                break;
            };
            rest = &rest[end..];
        }
        out.push_str(rest);
        out
    }

    /// Structural containment: no file other than this one may construct
    /// the permissive verifier's client configuration, and this file's own
    /// non-test code must construct it exactly once. The test module in
    /// this very file is excluded from the once-per-file count (via
    /// `strip_cfg_test_blocks`) because it necessarily repeats these two
    /// literal substrings as search patterns and assertion text below --
    /// counting that text as a second construction site would be a false
    /// positive, and weakening the search to dodge it is exactly the trap
    /// this test exists to avoid.
    #[test]
    fn permissive_verifier_construction_is_confined_to_relay_cert_module() {
        let src_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = Vec::new();
        collect_rs_files(&src_dir, &mut files);
        assert!(!files.is_empty(), "expected to find .rs files under src/");

        const DANGEROUS: &str = ".dangerous()";
        const CUSTOM_VERIFIER: &str = "with_custom_certificate_verifier";

        let mut foreign_hits = Vec::new();
        let mut own_dangerous = 0usize;
        let mut own_verifier = 0usize;

        for path in &files {
            let content = std::fs::read_to_string(path).expect("read source file");
            let is_self = path.file_name().and_then(|n| n.to_str()) == Some("relay_cert.rs");
            if is_self {
                let production_only = strip_cfg_test_blocks(&content);
                own_dangerous += production_only.matches(DANGEROUS).count();
                own_verifier += production_only.matches(CUSTOM_VERIFIER).count();
                continue;
            }
            let dangerous_count = content.matches(DANGEROUS).count();
            let verifier_count = content.matches(CUSTOM_VERIFIER).count();
            if dangerous_count > 0 || verifier_count > 0 {
                foreign_hits.push((path.clone(), dangerous_count, verifier_count));
            }
        }

        assert!(
            foreign_hits.is_empty(),
            "found a dangerous-verifier construction site outside relay_cert.rs: {foreign_hits:?}"
        );
        assert_eq!(
            own_dangerous, 1,
            "expected exactly one `.dangerous()` call in relay_cert.rs's non-test code"
        );
        assert_eq!(
            own_verifier, 1,
            "expected exactly one `with_custom_certificate_verifier` call in relay_cert.rs's non-test code"
        );
    }

    /// Structural containment: the process-default crypto provider is
    /// installed exactly once outside test code, and that call site is
    /// `src/main.rs`. This crate's test-only install helper above lives
    /// inside a `#[cfg(test)]`-gated `mod tests`, so `strip_cfg_test_blocks` removes
    /// it from consideration here.
    #[test]
    fn install_default_call_site_is_singular_and_outside_test_code() {
        let src_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = Vec::new();
        collect_rs_files(&src_dir, &mut files);

        let mut hits: Vec<(std::path::PathBuf, usize)> = Vec::new();
        for path in &files {
            let content = std::fs::read_to_string(path).expect("read source file");
            let stripped = strip_cfg_test_blocks(&content);
            let count = stripped.matches("install_default(").count();
            if count > 0 {
                hits.push((path.clone(), count));
            }
        }

        assert_eq!(
            hits.len(),
            1,
            "expected install_default( in exactly one non-test file, found: {hits:?}"
        );
        assert_eq!(
            hits[0].1, 1,
            "expected exactly one install_default( call in {:?}",
            hits[0].0
        );
        assert_eq!(
            hits[0].0.file_name().and_then(|n| n.to_str()),
            Some("main.rs"),
            "expected the sole non-test install_default( call site to be main.rs"
        );
    }
}
