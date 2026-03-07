// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgoraConstants — protocol-wide numeric bounds
/// @dev Review before mainnet: MIN_DISPUTE_WINDOW_HOURS is 0 for testnet e2e
///      testing. Restore to 168 (7 days) before any production deployment.
library AgoraConstants {
    uint256 internal constant MIN_REWARD_USDC = 1_000_000; // $1 (6 decimals)
    uint256 internal constant MAX_REWARD_USDC = 30_000_000; // $30 (6 decimals)

    /// @dev TESTNET ONLY — set to 0 so e2e tests can finalize without time-travel.
    ///      MUST be restored to 168 (7 days) before mainnet deployment.
    uint64 internal constant MIN_DISPUTE_WINDOW_HOURS = 0;
    uint64 internal constant MAX_DISPUTE_WINDOW_HOURS = 2160; // 90 days
}
