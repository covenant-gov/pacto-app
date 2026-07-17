//! `ISquadSponsorFactory` surface for Ext-path deploy and registry reads.
//! Mirrors [covenant-gov/pacto-squad-sponsor](https://github.com/covenant-gov/pacto-squad-sponsor) at a reviewed upstream revision.

use alloy::sol;

sol! {
    #[derive(Debug, PartialEq, Eq)]
    enum SquadVariant {
        NONE,
        SPONSOR,
        EXT,
    }

    interface ISquadSponsorFactory {
        struct SquadRecord {
            address sponsor;
            SquadVariant variant;
            uint256 topHatId;
        }

        function createSquadSponsorExt(bytes32 squadId, address addressOwner)
            external
            payable
            returns (address sponsor);

        function createSquadSponsor(
            bytes32 squadId,
            uint256 topHatId,
            address registry,
            uint256[] calldata customEligibleHats
        ) external payable returns (address sponsor);

        function PAYMASTER() external view returns (address paymaster);

        function squads(bytes32 squadId) external view returns (SquadRecord memory record);

        event SquadCreated(
            bytes32 indexed squadId,
            address sponsor,
            SquadVariant variant,
            address indexed addressOwner
        );
    }

    interface ISquadSponsorBase {
        function deposit() external payable;

        function depositFor(address sponsor) external payable;

        function withdraw() external;

        function squadId() external view returns (bytes32 squadId);

        function paymaster() external view returns (address paymaster);

        function totalShares() external view returns (uint256 totalShares);

        function sponsorShares(address sponsor) external view returns (uint256 shares);

        function withdrawable(address sponsor) external view returns (uint256 amount);

        function isEligible(address member) external view returns (bool eligible);
    }

    /// Ext clone: address-list eligibility until hats are wired.
    interface ISquadSponsorExt {
        function addressOwner() external view returns (address owner);

        function hatsWired() external view returns (bool wired);

        function permittedAddress(address member) external view returns (bool permitted);

        function setPermittedAddress(address member, bool permitted) external;

        function transferAddressOwner(address newOwner) external;
    }
}
