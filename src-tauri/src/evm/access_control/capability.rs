use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Actions the ACL can authorize for a squad parent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GovCapability {
    ProposeTreasury,
    CrewVote,
    CaptainVote,
    ExecuteTreasury,
    StartMutiny,
    CastMutinyVote,
    ExecuteMutiny,
    CaptainResign,
    QuartermasterMutateCrew,
    QuartermasterExecute,
    MutateTrackedTokens,
    SquadAdminCreateRole,
    SquadAdminEnableExecutor,
    SquadAdminEnableFull,
}

pub const CAPABILITY_KEYS: &[GovCapability] = &[
    GovCapability::ProposeTreasury,
    GovCapability::CrewVote,
    GovCapability::CaptainVote,
    GovCapability::ExecuteTreasury,
    GovCapability::StartMutiny,
    GovCapability::CastMutinyVote,
    GovCapability::ExecuteMutiny,
    GovCapability::CaptainResign,
    GovCapability::QuartermasterMutateCrew,
    GovCapability::QuartermasterExecute,
    GovCapability::MutateTrackedTokens,
    GovCapability::SquadAdminCreateRole,
    GovCapability::SquadAdminEnableExecutor,
    GovCapability::SquadAdminEnableFull,
];

impl GovCapability {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ProposeTreasury => "proposeTreasury",
            Self::CrewVote => "crewVote",
            Self::CaptainVote => "captainVote",
            Self::ExecuteTreasury => "executeTreasury",
            Self::StartMutiny => "startMutiny",
            Self::CastMutinyVote => "castMutinyVote",
            Self::ExecuteMutiny => "executeMutiny",
            Self::CaptainResign => "captainResign",
            Self::QuartermasterMutateCrew => "quartermasterMutateCrew",
            Self::QuartermasterExecute => "quartermasterExecute",
            Self::MutateTrackedTokens => "mutateTrackedTokens",
            Self::SquadAdminCreateRole => "squadAdminCreateRole",
            Self::SquadAdminEnableExecutor => "squadAdminEnableExecutor",
            Self::SquadAdminEnableFull => "squadAdminEnableFull",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityFlagDto {
    pub allowed: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadCapabilitiesDto {
    pub parent_id: String,
    pub roster_address: String,
    pub wears_captain: bool,
    pub wears_crew: bool,
    pub captain_is_safe: bool,
    pub squad_admin_full: bool,
    pub squad_admin_paused: bool,
    pub role_label: String,
    pub capabilities: BTreeMap<String, CapabilityFlagDto>,
}

pub fn deny_reason(capability: GovCapability, ctx: &HatContext) -> &'static str {
    if ctx.roster_address.is_empty() {
        return match capability {
            GovCapability::ExecuteTreasury
            | GovCapability::ExecuteMutiny
            | GovCapability::QuartermasterExecute => "Link a squad EVM address to sign.",
            _ => "Link a squad EVM address to act.",
        };
    }
    match capability {
        GovCapability::ProposeTreasury | GovCapability::MutateTrackedTokens => {
            "Requires Captain or Crew hat."
        }
        GovCapability::CrewVote | GovCapability::StartMutiny | GovCapability::CastMutinyVote => {
            "Requires Crew hat."
        }
        GovCapability::CaptainVote => {
            if ctx.captain_is_safe && !ctx.wears_captain {
                "Captain hat is on the Safe."
            } else {
                "Requires Captain hat."
            }
        }
        GovCapability::CaptainResign
        | GovCapability::QuartermasterMutateCrew
        | GovCapability::SquadAdminCreateRole
        | GovCapability::SquadAdminEnableExecutor
        | GovCapability::SquadAdminEnableFull => {
            if ctx.captain_is_safe && !ctx.wears_captain {
                "Captain hat is on the Safe."
            } else {
                "Requires Captain hat."
            }
        }
        GovCapability::ExecuteTreasury
        | GovCapability::ExecuteMutiny
        | GovCapability::QuartermasterExecute => "Link a squad EVM address to sign.",
    }
}

#[derive(Debug, Clone, Default)]
pub struct HatContext {
    pub roster_address: String,
    pub wears_captain: bool,
    pub wears_crew: bool,
    pub captain_is_safe: bool,
}

pub fn capability_allowed(capability: GovCapability, ctx: &HatContext) -> bool {
    if ctx.roster_address.is_empty() {
        return false;
    }
    match capability {
        GovCapability::ProposeTreasury | GovCapability::MutateTrackedTokens => {
            ctx.wears_captain || ctx.wears_crew
        }
        GovCapability::CrewVote | GovCapability::StartMutiny | GovCapability::CastMutinyVote => {
            ctx.wears_crew
        }
        GovCapability::CaptainVote
        | GovCapability::CaptainResign
        | GovCapability::QuartermasterMutateCrew
        | GovCapability::SquadAdminCreateRole
        | GovCapability::SquadAdminEnableExecutor
        | GovCapability::SquadAdminEnableFull => ctx.wears_captain,
        GovCapability::ExecuteTreasury
        | GovCapability::ExecuteMutiny
        | GovCapability::QuartermasterExecute => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crew_can_propose_and_start_mutiny() {
        let ctx = HatContext {
            roster_address: "0xabc".into(),
            wears_captain: false,
            wears_crew: true,
            captain_is_safe: false,
        };
        assert!(capability_allowed(GovCapability::ProposeTreasury, &ctx));
        assert!(capability_allowed(GovCapability::StartMutiny, &ctx));
        assert!(!capability_allowed(GovCapability::CaptainResign, &ctx));
        assert!(capability_allowed(GovCapability::ExecuteTreasury, &ctx));
    }

    #[test]
    fn unbound_denies_permissionless() {
        let ctx = HatContext::default();
        assert!(!capability_allowed(GovCapability::ExecuteTreasury, &ctx));
        assert_eq!(
            deny_reason(GovCapability::ExecuteTreasury, &ctx),
            "Link a squad EVM address to sign."
        );
    }

    #[test]
    fn safe_captain_blocks_captain_actions() {
        let ctx = HatContext {
            roster_address: "0xabc".into(),
            wears_captain: false,
            wears_crew: true,
            captain_is_safe: true,
        };
        assert!(!capability_allowed(GovCapability::CaptainVote, &ctx));
        assert_eq!(
            deny_reason(GovCapability::CaptainVote, &ctx),
            "Captain hat is on the Safe."
        );
    }
}
