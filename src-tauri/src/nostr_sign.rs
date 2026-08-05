//! App-local seam over nostr event signing and event JSON.
//!
//! `EventBuilder::sign_with_keys` and the `JsonUtil` trait both disappear on the
//! nostr 0.45 line. Every backend call to either goes through this module, so
//! the replacement lands in one place. `src-tauri/src/blossom.rs` is the third
//! seam and keeps its own `NostrSigner` usage.

use nostr_sdk::prelude::*;

/// Sign a builder with local keys.
pub fn sign_with(builder: EventBuilder, keys: &Keys) -> Result<Event, String> {
    builder.sign_with_keys(keys).map_err(|e| e.to_string())
}

/// Wire JSON for a signed event.
pub fn event_json(event: &Event) -> String {
    event.as_json()
}

/// Parse an unsigned event from wire JSON.
pub fn unsigned_event_from_json(json: &[u8]) -> Result<UnsignedEvent, String> {
    UnsignedEvent::from_json(json).map_err(|e| format!("{e:?}"))
}

/// Re-encode any serializable value as an [`UnsignedEvent`].
///
/// Used to turn a gift-wrapped rumor back into the shape MDK's welcome
/// processor accepts.
pub fn unsigned_event_from<T: serde::Serialize>(value: &T) -> Result<UnsignedEvent, String> {
    let json = serde_json::to_string(value).map_err(|e| e.to_string())?;
    unsigned_event_from_json(json.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signed_event_verifies_against_the_signing_key() {
        let keys = Keys::generate();
        let event = sign_with(EventBuilder::new(Kind::TextNote, "hi"), &keys).expect("sign");
        assert_eq!(event.pubkey, keys.public_key());
        assert!(event.verify().is_ok());
    }

    #[test]
    fn event_json_round_trips() {
        let keys = Keys::generate();
        let event = sign_with(EventBuilder::new(Kind::TextNote, "round trip"), &keys).expect("sign");
        let json = event_json(&event);
        let parsed = Event::from_json(json.as_bytes()).expect("parse");
        assert_eq!(parsed, event);
    }

    #[test]
    fn malformed_json_is_an_error_not_a_panic() {
        assert!(unsigned_event_from_json(b"{not json").is_err());
        assert!(unsigned_event_from_json(b"{}").is_err());
    }

    #[test]
    fn unsigned_event_from_a_rumor_keeps_kind_and_content() {
        let keys = Keys::generate();
        let rumor = EventBuilder::new(Kind::TextNote, "rumor").build(keys.public_key());
        let unsigned = unsigned_event_from(&rumor).expect("re-encode");
        assert_eq!(unsigned.kind, Kind::TextNote);
        assert_eq!(unsigned.content, "rumor");
        assert_eq!(unsigned.pubkey, keys.public_key());
    }
}
