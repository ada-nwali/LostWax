// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @notice Position maths used to value real and shadow liquidity in token1 terms.
library ShadowMath {
    uint256 internal constant Q96 = 1 << 96;
    uint256 internal constant Q128 = 1 << 128;
    uint128 internal constant UNIT = 1e18;

    error EmptyRange();
    error LiquidityOverflow();

    function amountsFor(uint160 sqrtP, int24 tickLower, int24 tickUpper, uint128 liquidity)
        internal
        pure
        returns (uint256 amount0, uint256 amount1)
    {
        if (liquidity == 0) return (0, 0);
        uint160 sa = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sb = TickMath.getSqrtPriceAtTick(tickUpper);
        if (sqrtP <= sa) {
            amount0 = SqrtPriceMath.getAmount0Delta(sa, sb, liquidity, false);
        } else if (sqrtP < sb) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtP, sb, liquidity, false);
            amount1 = SqrtPriceMath.getAmount1Delta(sa, sqrtP, liquidity, false);
        } else {
            amount1 = SqrtPriceMath.getAmount1Delta(sa, sb, liquidity, false);
        }
    }

    /// @dev amount0 priced at spot, plus amount1.
    function value(uint160 sqrtP, uint256 amount0, uint256 amount1) internal pure returns (uint256) {
        return FullMath.mulDiv(FullMath.mulDiv(amount0, sqrtP, Q96), sqrtP, Q96) + amount1;
    }

    /// @dev token1 value -> token0 amount at spot.
    function toToken0(uint160 sqrtP, uint256 value1) internal pure returns (uint256) {
        return FullMath.mulDiv(FullMath.mulDiv(value1, Q96, sqrtP), Q96, sqrtP);
    }

    function positionValue(uint160 sqrtP, int24 tickLower, int24 tickUpper, uint128 liquidity)
        internal
        pure
        returns (uint256)
    {
        (uint256 a0, uint256 a1) = amountsFor(sqrtP, tickLower, tickUpper, liquidity);
        return value(sqrtP, a0, a1);
    }

    /// @dev Value is linear in liquidity, so size off a unit position.
    function liquidityForValue(uint160 sqrtP, int24 tickLower, int24 tickUpper, uint256 targetValue)
        internal
        pure
        returns (uint128)
    {
        uint256 unitValue = positionValue(sqrtP, tickLower, tickUpper, UNIT);
        if (unitValue == 0) revert EmptyRange();
        uint256 l = FullMath.mulDiv(targetValue, UNIT, unitValue);
        if (l > type(uint128).max) revert LiquidityOverflow();
        return uint128(l);
    }

    function feesFor(uint128 liquidity, uint256 growthDelta) internal pure returns (uint256) {
        return FullMath.mulDiv(liquidity, growthDelta, Q128);
    }
}
