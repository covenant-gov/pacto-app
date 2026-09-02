//! Username NFT + global/bootstrap sponsor surfaces.
//! Mirrors covenant-gov/pacto-username-nft at the Sepolia full-system pin.

use alloy::sol;

sol! {
    #[derive(Debug, PartialEq, Eq)]
    struct UsernameRecord {
        string name;
        address evmAddress;
        address pendingAddress;
        uint256 tokenId;
    }

    interface IPactoUsernameNFT {
        function nameAvailable(string calldata name) external view returns (bool available);

        function npubOf(address evmAddress) external view returns (bytes32 npubHash);

        function eligibleMember(address member) external view returns (bytes32 npubHash, uint256 tokenId);

        function isPendingTransfer(bytes32 npubHash) external view returns (bool pending);

        function recordOf(bytes32 npubHash) external view returns (UsernameRecord memory record);

        function canBootstrapClaim(address member, bytes32 npubHash) external view returns (bool canClaim);

        function mintFee() external view returns (uint256 fee);

        function usedNonce(bytes32 npubHash) external view returns (uint256 nonce);

        function hashClaimBinding(
            bytes32 npubHash,
            address evmAddress,
            string calldata name,
            uint256 nonce,
            uint256 issuedAt,
            bytes32 salt
        ) external view returns (bytes32 digest);

        function claim(
            string calldata name,
            bytes32 npubHash,
            bytes32 pubkey,
            uint256 nonce,
            uint256 issuedAt,
            bytes32 salt,
            bytes calldata nostrSignature,
            bytes calldata evmSignature
        ) external payable;

        function initiateAddressTransfer(bytes32 npubHash, address newAddress) external;

        function claimAddressTransfer(bytes32 npubHash) external;

        function cancelAddressTransfer(bytes32 npubHash) external;
    }

    interface IPactoGlobalPaymaster {
        function PAYMASTER_DATA_VERSION() external view returns (uint8 version);

        function ALLOWED_7702_IMPLEMENTATION() external view returns (address implementation);
    }

    interface IGlobalSponsorPool {
        function spendablePoolWei() external view returns (uint256 amount);

        function deposit() external payable;

        function depositFor(address sponsor) external payable;
    }

    interface IBootstrapMintPool {
        function spendablePoolWei() external view returns (uint256 amount);

        function deposit() external payable;

        function depositFor(address sponsor) external payable;
    }

    interface ISponsorPolicyRegistry {
        function policyVersion() external view returns (uint256 policyVersion);

        function isContractAllowed(address target) external view returns (bool allowed);

        function isSelectorAllowed(address target, bytes4 selector) external view returns (bool allowed);

        function isSponsorable(
            address target,
            bytes calldata callData,
            address member,
            uint256 value
        ) external view returns (bool sponsorable);
    }
}
