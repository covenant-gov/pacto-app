use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WalletOpError {
    code: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    npub: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tx_hash: Option<String>,
}

pub fn wallet_err_json(code: &str, message: impl Into<String>, npub: Option<String>) -> String {
    serde_json::to_string(&WalletOpError {
        code: code.to_string(),
        message: message.into(),
        npub,
        tx_hash: None,
    })
    .unwrap_or_else(|_| r#"{"code":"INTERNAL","message":"serialize"}"#.to_string())
}

pub fn wallet_err_json_with_tx_hash(
    code: &str,
    message: impl Into<String>,
    npub: Option<String>,
    tx_hash: String,
) -> String {
    serde_json::to_string(&WalletOpError {
        code: code.to_string(),
        message: message.into(),
        npub,
        tx_hash: Some(tx_hash),
    })
    .unwrap_or_else(|_| r#"{"code":"INTERNAL","message":"serialize"}"#.to_string())
}
