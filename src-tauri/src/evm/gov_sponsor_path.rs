//! Gov write gas-path selection (squad pool → global topHat → EOA).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GovSponsorPath {
    Squad,
    GlobalTopHat,
    Eoa,
    Fail,
}

/// Select gas path for a squad-key governance module write.
///
/// Eligible username NFT holders prefer sponsored pools (squad, then global) before EOA.
/// Non-eligible members keep legacy ordering: EOA when funded, else squad when deployed.
pub fn select_gov_sponsor_path(
    eligible_member: bool,
    squad_path_ok: bool,
    global_tophat_ok: bool,
    eoa_can_pay: bool,
) -> GovSponsorPath {
    if eligible_member {
        if squad_path_ok {
            return GovSponsorPath::Squad;
        }
        if global_tophat_ok {
            return GovSponsorPath::GlobalTopHat;
        }
        if eoa_can_pay {
            return GovSponsorPath::Eoa;
        }
        return GovSponsorPath::Fail;
    }
    if eoa_can_pay {
        return GovSponsorPath::Eoa;
    }
    if squad_path_ok {
        return GovSponsorPath::Squad;
    }
    GovSponsorPath::Fail
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eligible_member_prefers_squad_over_global_and_eoa() {
        assert_eq!(
            select_gov_sponsor_path(true, true, true, true),
            GovSponsorPath::Squad
        );
        assert_eq!(
            select_gov_sponsor_path(true, false, true, true),
            GovSponsorPath::GlobalTopHat
        );
        assert_eq!(
            select_gov_sponsor_path(true, false, false, true),
            GovSponsorPath::Eoa
        );
        assert_eq!(
            select_gov_sponsor_path(true, false, false, false),
            GovSponsorPath::Fail
        );
    }

    #[test]
    fn eligible_member_prefers_sponsored_paths_over_dust_eoa() {
        assert_eq!(
            select_gov_sponsor_path(true, true, true, true),
            GovSponsorPath::Squad
        );
        assert_eq!(
            select_gov_sponsor_path(true, false, true, true),
            GovSponsorPath::GlobalTopHat
        );
    }

    #[test]
    fn non_eligible_member_keeps_eoa_first_then_squad() {
        assert_eq!(
            select_gov_sponsor_path(false, true, true, true),
            GovSponsorPath::Eoa
        );
        assert_eq!(
            select_gov_sponsor_path(false, true, false, false),
            GovSponsorPath::Squad
        );
        assert_eq!(
            select_gov_sponsor_path(false, false, true, false),
            GovSponsorPath::Fail
        );
    }

    #[test]
    fn global_path_never_wins_for_non_eligible_even_when_eoa_broke() {
        assert_eq!(
            select_gov_sponsor_path(false, false, true, false),
            GovSponsorPath::Fail
        );
    }

    /// `squad_path_ok` is parent-scoped. Guest eligibility on parent A's clone must not
    /// enable the squad arm when the write/deploy targets parent B without B sponsor infra.
    #[test]
    fn cross_squad_isolation_parent_b_without_sponsor_uses_global_not_squad_a() {
        assert_eq!(
            select_gov_sponsor_path(true, false, true, true),
            GovSponsorPath::GlobalTopHat
        );
        assert_eq!(
            select_gov_sponsor_path(true, false, true, false),
            GovSponsorPath::GlobalTopHat
        );
        assert_ne!(
            select_gov_sponsor_path(true, false, true, true),
            GovSponsorPath::Squad
        );
        assert_eq!(
            select_gov_sponsor_path(true, false, false, false),
            GovSponsorPath::Fail
        );
    }
}
