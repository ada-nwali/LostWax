// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Shared testnet market setup. Keep in sync with frontend/src/config/pools.ts.
library Config {
    struct TokenCfg {
        string name;
        string symbol;
        uint256 drip;
    }

    struct PoolCfg {
        uint8 base;
        uint8 quote;
        uint256 price; // quote per base, whole units
        uint24 fee;
        int24 spacing;
        uint256 churn; // base amount per activity swap
    }

    function tokens() internal pure returns (TokenCfg[5] memory t) {
        t[0] = TokenCfg("LostWax Test WETH", "tWETH", 10e18);
        t[1] = TokenCfg("LostWax Test USDC", "tUSDC", 30_000e18);
        t[2] = TokenCfg("LostWax Test USDT", "tUSDT", 30_000e18);
        t[3] = TokenCfg("LostWax Test WBTC", "tWBTC", 0.3e18);
        t[4] = TokenCfg("LostWax Test UNI", "tUNI", 3_000e18);
    }

    function pools() internal pure returns (PoolCfg[4] memory p) {
        p[0] = PoolCfg(0, 1, 3_000, 3000, 60, 6e18); // tWETH / tUSDC
        p[1] = PoolCfg(3, 1, 95_000, 3000, 60, 0.2e18); // tWBTC / tUSDC
        p[2] = PoolCfg(4, 1, 9, 3000, 60, 2_000e18); // tUNI / tUSDC
        p[3] = PoolCfg(1, 2, 1, 500, 10, 20_000e18); // tUSDC / tUSDT
    }

    function key(address base, address quote, PoolCfg memory cfg, address hook) internal pure returns (PoolKey memory) {
        (address c0, address c1) = base < quote ? (base, quote) : (quote, base);
        return PoolKey(Currency.wrap(c0), Currency.wrap(c1), cfg.fee, cfg.spacing, IHooks(hook));
    }

    /// @dev price is quote per base; v4 price is token1 per token0.
    function sqrtPrice(address base, address quote, uint256 price) internal pure returns (uint160) {
        uint256 q192 = 1 << 192;
        return base < quote ? uint160(Math.sqrt(price * q192)) : uint160(Math.sqrt(q192 / price));
    }
}
