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

/// Remaining arms to try after a sponsored path fails at runtime (non-soft).
pub fn fallback_paths_after(eligible_member: bool, attempted: GovSponsorPath) -> Vec<GovSponsorPath> {
    match (eligible_member, attempted) {
        (true, GovSponsorPath::Squad) => {
            vec![GovSponsorPath::GlobalTopHat, GovSponsorPath::Eoa]
        }
        (true, GovSponsorPath::GlobalTopHat) => vec![GovSponsorPath::Eoa],
        _ => vec![],
    }
}

/// Primary path plus runtime fallbacks, deduped in priority order.
pub fn gov_path_attempt_order(
    eligible_member: bool,
    squad_path_ok: bool,
    global_tophat_ok: bool,
    eoa_can_pay: bool,
) -> Vec<GovSponsorPath> {
    let primary = select_gov_sponsor_path(
        eligible_member,
        squad_path_ok,
        global_tophat_ok,
        eoa_can_pay,
    );
    if primary == GovSponsorPath::Fail {
        return vec![GovSponsorPath::Fail];
    }
    let mut paths = vec![primary];
    for path in fallback_paths_after(eligible_member, primary) {
        if !paths.contains(&path) {
            paths.push(path);
        }
    }
    paths
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

    #[test]
    fn eligible_fallback_after_squad_includes_global_then_eoa() {
        assert_eq!(
            fallback_paths_after(true, GovSponsorPath::Squad),
            vec![GovSponsorPath::GlobalTopHat, GovSponsorPath::Eoa]
        );
    }

    #[test]
    fn eligible_fallback_after_global_is_eoa_only() {
        assert_eq!(
            fallback_paths_after(true, GovSponsorPath::GlobalTopHat),
            vec![GovSponsorPath::Eoa]
        );
    }

    #[test]
    fn non_eligible_squad_failure_has_no_fallback() {
        assert!(fallback_paths_after(false, GovSponsorPath::Squad).is_empty());
    }

    #[test]
    fn attempt_order_dedupes_primary_with_fallbacks() {
        assert_eq!(
            gov_path_attempt_order(true, true, true, true),
            vec![
                GovSponsorPath::Squad,
                GovSponsorPath::GlobalTopHat,
                GovSponsorPath::Eoa,
            ]
        );
        assert_eq!(
            gov_path_attempt_order(true, false, true, true),
            vec![GovSponsorPath::GlobalTopHat, GovSponsorPath::Eoa]
        );
        assert_eq!(
            gov_path_attempt_order(false, true, false, false),
            vec![GovSponsorPath::Squad]
        );
        assert_eq!(
            gov_path_attempt_order(true, false, false, false),
            vec![GovSponsorPath::Fail]
        );
    }
}
