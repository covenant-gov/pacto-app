//! Username NFT gas-path selection (account-global; no squad arm).
//! Order: bootstrap → eoa → global_member → fail.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsernameSponsorPath {
    Bootstrap,
    Eoa,
    GlobalMember,
    Fail,
}

/// Select gas path for a username NFT write.
///
/// - `is_first_claim`: `npubOf(member) == 0` and the action is `claim`
/// - `bootstrap_pool_ok`: bootstrap mint pool has spendable headroom
/// - `eoa_can_pay`: roster EOA balance covers the write
/// - `global_member_ok`: `eligibleMember` and global pool headroom
///
/// First-claim without bootstrap does **not** fall through to `global_member`
/// (claim is not on the member policy registry).
pub fn select_username_sponsor_path(
    is_first_claim: bool,
    bootstrap_pool_ok: bool,
    eoa_can_pay: bool,
    global_member_ok: bool,
) -> UsernameSponsorPath {
    if is_first_claim && bootstrap_pool_ok {
        return UsernameSponsorPath::Bootstrap;
    }
    if eoa_can_pay {
        return UsernameSponsorPath::Eoa;
    }
    if !is_first_claim && global_member_ok {
        return UsernameSponsorPath::GlobalMember;
    }
    UsernameSponsorPath::Fail
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_claim_with_bootstrap_pool_selects_bootstrap() {
        assert_eq!(
            select_username_sponsor_path(true, true, false, false),
            UsernameSponsorPath::Bootstrap
        );
    }

    #[test]
    fn first_claim_prefers_bootstrap_over_eoa() {
        assert_eq!(
            select_username_sponsor_path(true, true, true, true),
            UsernameSponsorPath::Bootstrap
        );
    }

    #[test]
    fn first_claim_without_bootstrap_falls_to_eoa() {
        assert_eq!(
            select_username_sponsor_path(true, false, true, true),
            UsernameSponsorPath::Eoa
        );
    }

    #[test]
    fn first_claim_with_no_gas_fails_even_if_global_member_ok() {
        assert_eq!(
            select_username_sponsor_path(true, false, false, true),
            UsernameSponsorPath::Fail
        );
    }

    #[test]
    fn post_mint_with_eth_selects_eoa() {
        assert_eq!(
            select_username_sponsor_path(false, false, true, true),
            UsernameSponsorPath::Eoa
        );
    }

    #[test]
    fn post_mint_without_eth_selects_global_member() {
        assert_eq!(
            select_username_sponsor_path(false, false, false, true),
            UsernameSponsorPath::GlobalMember
        );
    }

    #[test]
    fn post_mint_with_no_path_fails() {
        assert_eq!(
            select_username_sponsor_path(false, false, false, false),
            UsernameSponsorPath::Fail
        );
    }
}
