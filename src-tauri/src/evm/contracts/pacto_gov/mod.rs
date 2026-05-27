//! `INavePirataFactory` surface required for `deployNavePirata` and receipt decoding.
//! Mirrors [covenant-gov/pacto-gov](https://github.com/covenant-gov/pacto-gov) `INavePirataFactory` at a reviewed upstream revision (see `docs/wallet/PACTO_GOV.md`).

pub mod read_bindings;

use alloy::sol;

sol! {
    interface INavePirataFactory {
        enum CrewVoteMode {
            MAJORITY_SNAPSHOT,
            QUORUM_OF_CAST
        }

        struct SquadParams {
            uint256 crewChangeDelay;
            uint256 proposalExpiry;
            CrewVoteMode crewVoteMode;
            uint256 quorumBps;
        }

        struct DeployParams {
            address captain;
            string metadataURI;
            SquadParams squadParams;
            address quartermasterMasterCopy;
            address mutinyMasterCopy;
            address treasuryAuthorityMasterCopy;
            address squadAdminImplementation;
            uint256 saltNonce;
        }

        function deployNavePirata(DeployParams calldata _params) external returns (
            uint256 _topHatId,
            address _safe,
            address _quartermaster,
            address _mutinyModule,
            address _treasuryAuthority,
            address _squadAdminProxy
        );

        event NavePirataDeployed(
            uint256 indexed _topHatId,
            address indexed _captain,
            address _safe,
            address _quartermaster,
            address _mutinyModule,
            address _treasuryAuthority,
            address _squadAdminProxy
        );

        function deploySquadAdminExtStandalone(
            address squadAdminExtImplementation,
            address owner
        ) external returns (address clone);

        function deploySquadAdminStandaloneCaptainHat(
            address squadAdminImplementation,
            uint256 captainHatId
        ) external returns (address clone);

        event SquadAdminExtStandaloneDeployed(
            address indexed clone,
            address indexed owner,
            address indexed implementation
        );

        event SquadAdminStandaloneDeployed(
            address indexed clone,
            address indexed implementation,
            uint256 captainHatId
        );
    }
}
