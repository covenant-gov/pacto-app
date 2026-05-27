//! Minimal Hats Protocol v1 read surface (`IHats` / `IHatsIdUtilities`).

use alloy::sol;

sol! {
    interface IHats {
        function buildHatId(uint256 _admin, uint16 _newHat) external pure returns (uint256 id);

        function getHatLevel(uint256 _hatId) external view returns (uint32 level);

        function isValidHatId(uint256 _hatId) external view returns (bool validHatId);

        function viewHat(uint256 _hatId)
            external
            view
            returns (
                string memory details,
                uint32 maxSupply,
                uint32 supply,
                address eligibility,
                address toggle,
                string memory imageURI,
                uint16 lastHatId,
                bool mutable_,
                bool active
            );

        function isWearerOfHat(address _user, uint256 _hatId) external view returns (bool isWearer);

        function hatSupply(uint256 _hatId) external view returns (uint32 supply);
    }
}
