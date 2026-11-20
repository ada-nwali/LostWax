// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

interface ILostWax {
    enum Stage {
        None,
        Wax,
        Bronze,
        Retired
    }

    enum Rule {
        OutOfRange, // recenter once price leaves the range
        Edge80, // recenter once price is past 80% of the half-width
        Manual // curator only
    }

    /// @notice The curator's published limits. Fixed at sculpt time.
    struct Mandate {
        Rule rule;
        uint32 cooldown;
        int24 maxTickMove;
        uint16 alphaFeeBps;
    }

    struct Snapshot {
        uint40 time;
        uint104 strategyIndex; // 1e18 = start
        uint104 benchIndex; // lazy LP, 1e18 = start
        bool rebalanced;
    }

    /// @notice Flat read model for the app.
    struct StrategyView {
        uint256 id;
        string name;
        address curator;
        Stage stage;
        PoolKey key;
        Mandate mandate;
        int24 tickLower;
        int24 tickUpper;
        int24 currentTick;
        uint160 sqrtPriceX96;
        uint64 createdAt;
        uint64 trialEndsAt;
        uint64 castAt;
        uint64 lastRebalance;
        uint256 strategyIndex;
        uint256 benchIndex;
        int256 alphaBps;
        int256 trialAlphaBps;
        bool qualified;
        bool canRecenter;
        uint128 liquidity;
        uint256 totalShares;
        uint256 tvl; // token1 units
        uint256 pendingFee; // token1 units
    }

    event PoolRegistered(bytes32 indexed poolId);
    event Sculpted(
        uint256 indexed id,
        address indexed curator,
        bytes32 indexed poolId,
        string name,
        int24 tickLower,
        int24 tickUpper
    );
    event Rebalanced(uint256 indexed id, int24 tickLower, int24 tickUpper, bool automatic);
    event Cast(uint256 indexed id, int256 trialAlphaBps);
    event Retired(uint256 indexed id);
    event Deposited(uint256 indexed id, address indexed user, uint256 shares, uint256 amount0, uint256 amount1);
    event Withdrawn(uint256 indexed id, address indexed user, uint256 shares, uint256 amount0, uint256 amount1);
    event AlphaFee(uint256 indexed id, address indexed curator, uint256 shares, uint256 value);

    error NotPoolManager();
    error UnknownPool();
    error NotCurator();
    error WrongStage();
    error BadRange();
    error BadMandate();
    error TooManyStrategies();
    error MoveTooLarge();
    error Cooldown();
    error NotTriggered();
    error TrialRunning();
    error NotQualified();
    error Slippage();
    error ZeroAmount();
    error PriceMoved();
    error Reentrancy();
}
