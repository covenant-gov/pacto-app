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

        function propose(address _to, uint256 _value, bytes calldata _data, Operation _op)
            external
            returns (uint256 _proposalId);

        function crewVote(uint256 _proposalId, bool _support) external;

        function captainVote(uint256 _proposalId, bool _support) external;

        function execute(uint256 _proposalId) external;
    }

    interface IMutinyModule {
        function startMutinyToCrewMember(address _proposedCrewMember) external;
        function startMutinyToCommittee(address _proposedMultisigCommittee) external;
        function startMutinyToArbitraryEoa(address _proposedArbitraryEoa) external;
        function startMutinyToArbitraryContract(address _proposedArbitraryContract) external;
        function startMutinyToPauseCaptain() external;
        function castVote(uint256 _mutinyId) external;
        function executeMutiny(uint256 _mutinyId) external;
        function captainResign(address _newCaptain) external;
        function activeMutinyId() external view returns (uint256 _id);
        function mutiny(uint256 _id)
            external
            view
            returns (
                address _proposedNewCaptain,
                uint64 _startedAt,
                uint64 _snapshot,
                uint64 _yeas,
                bool _executed
            );
        function hasVoted(uint256 _mutinyId, address _voter) external view returns (bool _voted);
        function captain() external view returns (address _captain);
        function safe() external view returns (address _safe);
    }

    interface IQuartermaster {
        function requestAddCrew(address _candidate) external;
        function cancelAddCrew(address _candidate) external;
        function executeAddCrew(address _candidate) external;
        function requestRemoveCrew(address _crew) external;
        function cancelRemoveCrew(address _crew) external;
        function executeRemoveCrew(address _crew) external;
        function crewChangeDelay() external view returns (uint256 _delay);
        function mutinyActive() external view returns (bool _active);
        function pendingCrewAddAt(address _candidate) external view returns (uint256 _executableAt);
        function pendingCrewRemoveAt(address _crew) external view returns (uint256 _executableAt);
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
