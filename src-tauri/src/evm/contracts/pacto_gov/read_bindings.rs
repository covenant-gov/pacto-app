//! On-chain read bindings for Nave Pirata registry, Treasury Authority, and Squad Admin views.

use alloy::sol;

sol! {
    #[derive(Debug, PartialEq, Eq)]
    enum CrewVoteMode {
        MAJORITY_SNAPSHOT,
        QUORUM_OF_CAST,
    }

    interface INavePirataRegistry {
        struct Deployment {
            address safe;
            address quartermaster;
            address mutinyModule;
            address treasuryAuthority;
            address squadAdminProxy;
            uint256 topHatId;
            uint256 captainHatId;
            uint256 crewHatId;
            uint256 squadAdminHatId;
            uint256 mutinyRoleHatId;
            uint256 quartermasterRoleHatId;
            uint256 treasuryAuthorityRoleHatId;
            uint64 deployedAt;
            address deployer;
        }

        function deployment(uint256 _topHatId) external view returns (Deployment memory _deployment);

        event NavePirataRegistered(
            uint256 indexed _topHatId,
            Deployment _deployment
        );
    }

    interface ITreasuryAuthority {
        enum Operation {
            CALL,
            DELEGATECALL
        }

        function proposal(uint256 _id)
            external
            view
            returns (
                address _proposer,
                address _to,
                uint256 _value,
                Operation _op,
                bytes memory _data,
                uint64 _deadline,
                uint64 _snapshot,
                uint64 _yeas,
                uint64 _nays,
                bool _captainApproved,
                bool _captainDefeated,
                bool _executed
            );

        function hasVoted(uint256 _proposalId, address _voter) external view returns (bool __voted);

        function SAFE() external view returns (address _safe);
    }

    interface ISquadAdminBase {
        function createRole(bytes32 _role) external;

        function enableExecutor(address _executor, bytes32 _role) external;

        function enableFullPermission(address _executor, bool _enable) external;

        function disableExecutor(address _executor, bytes32 _role) external;

        function pauseExecutor(address _executor, bool _pause) external;

        function hasExecutorRole(address _executor, bytes32 _role) external view returns (bool _enabled);

        function isExecutorFullPermission(address _executor) external view returns (bool _fullPermission);

        function isExecutorPaused(address _executor) external view returns (bool _paused);
    }
}
