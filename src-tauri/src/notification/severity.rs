//! Severity tier resolution (R8, R9, R10; KD6, KTD3, KTD7).
//!
//! Pure lookup only — no globals, no I/O, no app handle. KTD11 requires the
//! notification module to stay a leaf so a later router extraction can lift
//! it out whole; every function here takes its inputs as parameters.

use crate::chat::NotificationLevel;

/// The three notification tiers (R8). Exactly one applies to every event.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tier {
    /// Rendered inline only; never counted, never banners (R9).
    Passive,
    /// Silent but counted and reviewable (R9).
    Record,
    /// Produces an OS banner and sound, subject to burst coalescing (R9, R11).
    Interrupt,
}

/// The event categories the tier table is keyed on. Deliberately coarser
/// than `RumorProcessingResult` — classifying a raw rumor result into one of
/// these (plus authorship and a mention hit) is the caller's job; this
/// module only resolves the already-classified shape.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventKind {
    /// Typing indicator, reaction, or message edit — always ambient,
    /// regardless of authorship or chat level.
    Ambient,
    /// An ordinary message in a group/MLS chat. `mention_hit` on the caller
    /// distinguishes an ordinary message from one that names the member.
    GroupMessage,
    /// A direct message.
    DirectMessage,
    /// Welcome, invite, join outcome, or another needs-action prompt.
    ActionPrompt,
}

/// Resolve the tier for one event. This is KD6's static lookup, not a
/// runtime actionability probe: a direct message always lands in the
/// Interrupt-eligible row regardless of its content.
///
/// `is_own` short-circuits to Passive before anything else — a member's own
/// activity never notifies them. `mention_hit` only changes the outcome for
/// `GroupMessage`; every other kind's row does not vary with it.
pub fn resolve_tier(kind: EventKind, level: NotificationLevel, is_own: bool, mention_hit: bool) -> Tier {
    use EventKind::*;
    use NotificationLevel::*;
    use Tier::*;

    if is_own {
        return Passive;
    }

    match kind {
        Ambient => Passive,
        GroupMessage if mention_hit => match level {
            Nothing => Record,
            Mentions | All => Interrupt,
        },
        GroupMessage => match level {
            All => Interrupt,
            Mentions | Nothing => Record,
        },
        DirectMessage | ActionPrompt => match level {
            Nothing => Record,
            Mentions | All => Interrupt,
        },
    }
}

/// Badge contribution (KTD7): true when the tier is not Passive and the
/// chat's level is not Nothing. This is what makes a Nothing chat silent
/// *and* unbadged while its messages are still recorded (R17).
pub fn contributes_to_badge(tier: Tier, level: NotificationLevel) -> bool {
    tier != Tier::Passive && level != NotificationLevel::Nothing
}

/// Catch up admission (KTD7, R20): true when the event is addressed to the
/// member or needs their action, independent of the chat's level — a
/// needs-action prompt in a chat at Nothing still earns an entry (R24), it
/// just contributes no badge (see `contributes_to_badge`).
pub fn earns_catch_up_entry(kind: EventKind, is_own: bool, mention_hit: bool) -> bool {
    if is_own {
        return false;
    }
    match kind {
        EventKind::Ambient => false,
        EventKind::GroupMessage => mention_hit,
        EventKind::DirectMessage | EventKind::ActionPrompt => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use NotificationLevel::*;
    use Tier::*;

    /// The published tier table (Planning Contract), exercised exhaustively
    /// over every (kind, level, is_own, mention_hit) combination rather than
    /// by sampling.
    #[test]
    fn tier_table_is_exhaustive() {
        let levels = [Nothing, Mentions, All];
        let kinds = [
            EventKind::Ambient,
            EventKind::GroupMessage,
            EventKind::DirectMessage,
            EventKind::ActionPrompt,
        ];

        for &kind in &kinds {
            for &level in &levels {
                for &is_own in &[true, false] {
                    for &mention_hit in &[true, false] {
                        let expected = expected_tier(kind, level, is_own, mention_hit);
                        assert_eq!(
                            resolve_tier(kind, level, is_own, mention_hit),
                            expected,
                            "kind={:?} level={:?} is_own={} mention_hit={}",
                            kind,
                            level,
                            is_own,
                            mention_hit
                        );
                    }
                }
            }
        }
    }

    /// Independent restatement of the published table, so the exhaustive
    /// test above is checking against the spec, not against a copy of the
    /// implementation.
    fn expected_tier(kind: EventKind, level: NotificationLevel, is_own: bool, mention_hit: bool) -> Tier {
        if is_own {
            return Passive;
        }
        match kind {
            EventKind::Ambient => Passive,
            EventKind::GroupMessage => {
                if mention_hit {
                    match level {
                        Nothing => Record,
                        Mentions | All => Interrupt,
                    }
                } else {
                    match level {
                        All => Interrupt,
                        Mentions | Nothing => Record,
                    }
                }
            }
            EventKind::DirectMessage | EventKind::ActionPrompt => match level {
                Nothing => Record,
                Mentions | All => Interrupt,
            },
        }
    }

    #[test]
    fn own_messages_are_passive_at_every_level() {
        for &level in &[Nothing, Mentions, All] {
            for &kind in &[
                EventKind::Ambient,
                EventKind::GroupMessage,
                EventKind::DirectMessage,
                EventKind::ActionPrompt,
            ] {
                assert_eq!(resolve_tier(kind, level, true, false), Passive);
                assert_eq!(resolve_tier(kind, level, true, true), Passive);
            }
        }
    }

    #[test]
    fn ordinary_group_message_is_record_at_mentions_and_interrupt_at_all() {
        // Covers AE3, AE4.
        assert_eq!(resolve_tier(EventKind::GroupMessage, Mentions, false, false), Record);
        assert_eq!(resolve_tier(EventKind::GroupMessage, All, false, false), Interrupt);
    }

    #[test]
    fn mention_of_the_member_is_interrupt_at_mentions_and_record_at_nothing() {
        assert_eq!(resolve_tier(EventKind::GroupMessage, Mentions, false, true), Interrupt);
        assert_eq!(resolve_tier(EventKind::GroupMessage, Nothing, false, true), Record);
    }

    #[test]
    fn badge_contribution_is_false_at_nothing_for_every_tier() {
        for &tier in &[Passive, Record, Interrupt] {
            assert!(!contributes_to_badge(tier, Nothing));
        }
    }

    #[test]
    fn badge_contribution_is_true_for_a_record_tier_event_at_mentions() {
        let tier = resolve_tier(EventKind::GroupMessage, Mentions, false, false);
        assert_eq!(tier, Record);
        assert!(contributes_to_badge(tier, Mentions));
    }

    #[test]
    fn badge_contribution_is_false_for_passive_regardless_of_level() {
        for &level in &[Nothing, Mentions, All] {
            assert!(!contributes_to_badge(Passive, level));
        }
    }

    #[test]
    fn catch_up_admission_is_false_for_ordinary_group_message_at_every_level() {
        // Level is not a parameter (KTD7: admission is level-independent);
        // this asserts the one call site that matters for R20.
        assert!(!earns_catch_up_entry(EventKind::GroupMessage, false, false));
    }

    #[test]
    fn catch_up_admission_is_true_for_a_needs_action_prompt() {
        // Covers AE1: admitted regardless of the chat's level, since this
        // predicate never takes a level.
        assert!(earns_catch_up_entry(EventKind::ActionPrompt, false, false));
    }

    #[test]
    fn catch_up_admission_is_true_for_mentions_and_direct_messages() {
        assert!(earns_catch_up_entry(EventKind::GroupMessage, false, true));
        assert!(earns_catch_up_entry(EventKind::DirectMessage, false, false));
    }

    #[test]
    fn catch_up_admission_is_false_for_own_events_and_ambient_events() {
        assert!(!earns_catch_up_entry(EventKind::ActionPrompt, true, false));
        assert!(!earns_catch_up_entry(EventKind::Ambient, false, false));
    }
}
