// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {LostWaxHook} from "../src/LostWaxHook.sol";
import {ILostWax} from "../src/interfaces/ILostWax.sol";
import {Config} from "./Config.sol";

/// @notice Keeper for the demo: round-trip swaps for fees, recenter / cast what's ready,
///         and seed a first deposit into your empty bronze vaults so they have a live record.
contract Activity is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address sender = vm.addr(pk);
        uint256 rounds = vm.envOr("ROUNDS", uint256(3));
        bool castReady = vm.envOr("CAST", true);
        bool seedDeposit = vm.envOr("SEED_DEPOSIT", true);

        string memory json = vm.readFile(string.concat("./deployments/", vm.toString(block.chainid), ".json"));
        LostWaxHook hook = LostWaxHook(vm.parseJsonAddress(json, ".hook"));
        PoolSwapTest router = PoolSwapTest(vm.parseJsonAddress(json, ".swapRouter"));

        Config.TokenCfg[5] memory t = Config.tokens();
        address[5] memory addrs;
        for (uint256 i; i < t.length; ++i) {
            addrs[i] = vm.parseJsonAddress(json, string.concat(".tokens.", t[i].symbol));
        }

        vm.startBroadcast(pk);

        Config.PoolCfg[4] memory cfgs = Config.pools();
        for (uint256 r; r < rounds; ++r) {
            for (uint256 i; i < cfgs.length; ++i) {
                address base = addrs[cfgs[i].base];
                address quote = addrs[cfgs[i].quote];
                PoolKey memory key = Config.key(base, quote, cfgs[i], address(hook));
                bool baseIs0 = base < quote;
                _swap(router, key, baseIs0, cfgs[i].churn);
                _swap(router, key, !baseIs0, cfgs[i].churn * cfgs[i].price);
            }
        }

        uint256 n = hook.strategyCount();
        for (uint256 id; id < n; ++id) {
            ILostWax.StrategyView memory v = hook.getStrategy(id);
            if (v.canRecenter) {
                hook.recenter(id);
                console2.log("recentered", id);
            }
            if (castReady && v.qualified && v.curator == sender) {
                hook.cast(id);
                console2.log("cast", id);
                v = hook.getStrategy(id);
            }
            if (seedDeposit && v.stage == ILostWax.Stage.Bronze && v.totalShares == 0 && v.curator == sender) {
                _seedDeposit(hook, v, addrs, cfgs);
                console2.log("seeded deposit", id);
            }
        }

        vm.stopBroadcast();
    }

    /// @dev Deposit about one churn's worth of each side; the hook takes only what the range needs.
    function _seedDeposit(
        LostWaxHook hook,
        ILostWax.StrategyView memory v,
        address[5] memory addrs,
        Config.PoolCfg[4] memory cfgs
    ) internal {
        for (uint256 i; i < cfgs.length; ++i) {
            address base = addrs[cfgs[i].base];
            address quote = addrs[cfgs[i].quote];
            PoolKey memory key = Config.key(base, quote, cfgs[i], address(hook));
            if (Currency.unwrap(key.currency0) != Currency.unwrap(v.key.currency0) || key.fee != v.key.fee) continue;
            if (Currency.unwrap(key.currency1) != Currency.unwrap(v.key.currency1)) continue;
            (uint256 a0, uint256 a1) = base < quote
                ? (cfgs[i].churn, cfgs[i].churn * cfgs[i].price)
                : (cfgs[i].churn * cfgs[i].price, cfgs[i].churn);
            IERC20(Currency.unwrap(key.currency0)).approve(address(hook), type(uint256).max);
            IERC20(Currency.unwrap(key.currency1)).approve(address(hook), type(uint256).max);
            hook.deposit(v.id, a0, a1, 0);
            return;
        }
    }

    function _swap(PoolSwapTest router, PoolKey memory key, bool zeroForOne, uint256 amountIn) internal {
        router.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }
}
